import asyncio
import json
import logging
import os
import socket
import subprocess
from collections import defaultdict, deque
from time import time
from typing import Any

import httpx
import psutil

logger = logging.getLogger("conductor")

from services import config_manager

LOCAL_HOSTNAME = socket.gethostname().split(".")[0].lower()

_GPU_AVAILABLE: bool = False
try:
    subprocess.run(["nvidia-smi"], capture_output=True, timeout=5, check=True)
    _GPU_AVAILABLE = True
except Exception:
    pass


def _load_machine_config() -> dict[str, dict[str, str]]:
    return config_manager.get_machines_config()


async def _discover_instances() -> dict[str, dict[str, str]]:
    """Query Prometheus for all node-exporter instances and return {hostname: {instance, ...}}."""
    prometheus_url = config_manager.get_prometheus_url()
    instances: dict[str, dict[str, str]] = {}
    if prometheus_url:
        results = await _promql(prometheus_url, 'node_uname_info')
        for r in results:
            inst = r["metric"].get("instance", "")
            hostname = r["metric"].get("nodename", inst.split(":")[0])
            if hostname not in instances:
                instances[hostname] = {"instance": inst}
    # Fallback using the machines config so all known machines appear
    if not instances:
        for mid, cfg in _load_machine_config().items():
            host = cfg.get("host", "127.0.0.1")
            instances[mid] = {"instance": f"{host}:9100"}
    return instances

def _build_machine_map(instances: dict[str, dict[str, str]]) -> dict[str, dict[str, str]]:
    machines = _load_machine_config()
    machine_map: dict[str, dict[str, str]] = {}
    for hostname, info in instances.items():
        mid = hostname
        friendly = machines.get(hostname)
        if friendly:
            mid = hostname
        else:
            # Try to match by instance IP
            for key, cfg in machines.items():
                if cfg.get("host") and cfg["host"] in info.get("instance", ""):
                    mid = key
                    friendly = cfg
                    break
        machine_map[info["instance"]] = {
            "id": mid,
            "name": friendly.get("name", hostname.capitalize()) if friendly else hostname.capitalize(),
            "desc": friendly.get("desc", f"Auto-discovered node — {hostname}") if friendly else f"Auto-discovered node — {hostname}",
        }
    return machine_map

def _build_machine_insights(machine_map: dict[str, dict[str, str]]) -> dict[str, str]:
    machines = _load_machine_config()
    insights: dict[str, str] = {}
    for inst, info in machine_map.items():
        mid = info["id"]
        cfg = machines.get(mid, {})
        insights[mid] = cfg.get("insight", f"Auto-discovered node at {inst}. No description configured.")
    return insights

_history: dict[str, dict[str, deque[float]]] = defaultdict(
    lambda: defaultdict(lambda: deque(maxlen=30))
)


_PROMQL_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_PROM_DEADLINE: float = 0.0  # skip Prometheus until this timestamp

async def _prom_reachable(url: str) -> bool:
    global _PROM_DEADLINE
    if time() < _PROM_DEADLINE:
        return False
    try:
        async with httpx.AsyncClient(timeout=2.0) as c:
            r = await c.get(f"{url}/api/v1/status/buildinfo")
        ok = r.status_code < 500
        if not ok:
            _PROM_DEADLINE = time() + 30
        return ok
    except Exception:
        _PROM_DEADLINE = time() + 30
        return False

async def _promql(base_url: str, query: str) -> list[dict[str, Any]]:
    ts = time()
    cached = _PROMQL_CACHE.get(query)
    if cached and (ts - cached[0]) < 5:
        return cached[1]
    results: list[dict[str, Any]] = []
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(
                f"{base_url}/api/v1/query",
                params={"query": query},
            )
            resp.raise_for_status()
            results = resp.json().get("data", {}).get("result", [])
    except Exception as e:
        logger.debug("PromQL failed: %s", e)
    _PROMQL_CACHE[query] = (time(), results)
    return results


def _by_instance(results: list[dict[str, Any]]) -> dict[str, float]:
    return {r["metric"]["instance"]: float(r["value"][1]) for r in results}


def _vital_status(value: float, warn: float, crit: float) -> str:
    if value >= crit:
        return "red"
    if value >= warn:
        return "yellow"
    return "green"


def _machine_status(vitals: list[dict[str, Any]]) -> str:
    for v in vitals:
        if v["status"] == "unavailable":
            return "unavailable"
    for v in vitals:
        if v["status"] == "red":
            return "critical"
    for v in vitals:
        if v["status"] == "yellow":
            return "warning"
    return "healthy"


def _fmt_bytes(bps: float) -> str:
    if bps > 1_000_000_000:
        return f"{bps / 1_000_000_000:.1f} GB/s"
    if bps > 1_000_000:
        return f"{bps / 1_000_000:.1f} MB/s"
    if bps > 1_000:
        return f"{bps / 1_000:.0f} KB/s"
    return f"{bps:.0f} B/s"


def _get_gpu_stats_local() -> dict[str, float]:
    try:
        out = subprocess.check_output(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu",
             "--format=csv,noheader,nounits"],
            timeout=5, text=True,
        ).strip()
        parts = out.split(",")
        util = float(parts[0].strip())
        mem_used = float(parts[1].strip())
        mem_total = float(parts[2].strip())
        mem_pct = round((mem_used / mem_total) * 100, 1) if mem_total else 0.0
        temp = float(parts[3].strip())
        return {"gpu_util": util, "gpu_mem_pct": mem_pct, "gpu_temp": temp}
    except Exception:
        return {"gpu_util": 0.0, "gpu_mem_pct": 0.0, "gpu_temp": 0.0}


async def collect_vitals() -> list[dict[str, Any]]:
    now = time()

    prometheus_url = config_manager.get_prometheus_url()

    cpu_q = '(1 - avg by(instance)(rate(node_cpu_seconds_total{mode="idle"}[1m]))) * 100'
    mem_q = '(1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes) * 100'
    disk_q = 'sum by(instance)(rate(node_disk_read_bytes_total{device!~"loop.*|snap.*"}[1m])) + sum by(instance)(rate(node_disk_written_bytes_total{device!~"loop.*|snap.*"}[1m]))'
    net_q = 'sum by(instance)(rate(node_network_receive_bytes_total{device!~"lo"}[1m]) + rate(node_network_transmit_bytes_total{device!~"lo"}[1m]))'
    load_q = 'node_load15'
    disk_space_q = '(node_filesystem_size_bytes{mountpoint="/"} - node_filesystem_avail_bytes{mountpoint="/"}) / node_filesystem_size_bytes{mountpoint="/"} * 100'
    uptime_q = 'time() - node_boot_time_seconds'

    loop = asyncio.get_event_loop()
    gpu_local = await loop.run_in_executor(None, _get_gpu_stats_local)
    cpu_local = await loop.run_in_executor(None, lambda: psutil.cpu_percent(interval=0))
    mem_local = await loop.run_in_executor(None, lambda: psutil.virtual_memory().percent)

    # Also get remote CPU/mem via Prometheus
    prom_ok = prometheus_url and await _prom_reachable(prometheus_url)
    if prom_ok:
        cpu_res, mem_res, disk_res, net_res, load_res, ds_res, up_res = await asyncio.gather(
            _promql(prometheus_url, cpu_q), _promql(prometheus_url, mem_q),
            _promql(prometheus_url, disk_q), _promql(prometheus_url, net_q),
            _promql(prometheus_url, load_q), _promql(prometheus_url, disk_space_q),
            _promql(prometheus_url, uptime_q),
        )
    else:
        cpu_res = mem_res = disk_res = net_res = load_res = ds_res = up_res = []

    cpu_map = _by_instance(cpu_res)
    mem_map = _by_instance(mem_res)
    disk_map = _by_instance(disk_res)
    net_map = _by_instance(net_res)
    load_map = _by_instance(load_res)
    ds_map = _by_instance(ds_res)
    up_map = _by_instance(up_res)

    discovered = await _discover_instances()
    machine_map = _build_machine_map(discovered)
    insights = _build_machine_insights(machine_map)

    machines = []

    for instance, info in machine_map.items():
        mid = info["id"]
        is_remote = not prom_ok and mid != LOCAL_HOSTNAME

        if is_remote:
            vitals = [
                {"id": "cpu",  "label": "CPU",     "value": "—", "status": "unavailable"},
                {"id": "mem",  "label": "RAM",     "value": "—", "status": "unavailable"},
                {"id": "disk", "label": "Disk I/O","value": "—", "status": "unavailable"},
                {"id": "net",  "label": "Network",  "value": "—", "status": "unavailable"},
                {"id": "diskSpace", "label": "Disk /", "value": "—", "status": "unavailable"},
            ]
        else:
            cpu_val = cpu_map.get(instance, cpu_local)
            mem_val = mem_map.get(instance, mem_local)
            disk_val = disk_map.get(instance, 0.0)
            net_val = net_map.get(instance, 0.0)
            load_val = load_map.get(instance, 0.0)
            ds_pct = ds_map.get(instance, 0.0)
            uptime_val = up_map.get(instance, 0.0)

            vitals = [
                {"id": "cpu",  "label": "CPU",     "value": f"{cpu_val:.0f}%",          "status": _vital_status(cpu_val, 80, 90)},
                {"id": "mem",  "label": "RAM",     "value": f"{mem_val:.0f}%",          "status": _vital_status(mem_val, 80, 90)},
                {"id": "disk", "label": "Disk I/O","value": _fmt_bytes(disk_val),       "status": _vital_status(disk_val, 500_000_000, 2_000_000_000)},
                {"id": "net",  "label": "Network",  "value": _fmt_bytes(net_val),        "status": "green"},
                {"id": "diskSpace", "label": "Disk /", "value": f"{ds_pct:.0f}%",       "status": _vital_status(ds_pct, 85, 95)},
            ]

            if _GPU_AVAILABLE:
                vitals.append({"id": "gpu", "label": "GPU Util", "value": f"{gpu_local['gpu_util']:.0f}%",
                               "status": _vital_status(gpu_local['gpu_util'], 70, 90)})
                vitals.append({"id": "gpuMem", "label": "GPU Mem", "value": f"{gpu_local['gpu_mem_pct']:.0f}%",
                               "status": _vital_status(gpu_local['gpu_mem_pct'], 80, 95)})
                vitals.append({"id": "gpuTemp", "label": "GPU Temp", "value": f"{gpu_local['gpu_temp']:.0f}°C",
                               "status": _vital_status(gpu_local['gpu_temp'], 80, 90)})

            raw_map: dict[str, float] = {
                "cpu": cpu_val, "mem": mem_val, "disk": disk_val, "net": net_val,
                "diskSpace": ds_pct,
                "gpu": gpu_local['gpu_util'], "gpuMem": gpu_local['gpu_mem_pct'], "gpuTemp": gpu_local['gpu_temp'],
            }

            for v in vitals:
                raw = raw_map.get(v["id"], 0.0)
                _history[mid][v["id"]].append(raw)
                v["spark"] = [
                    round(vv, 1) if isinstance(vv, float) else vv
                    for vv in list(_history[mid][v["id"]])
                ]

        machines.append({
            "id": mid,
            "name": info["name"],
            "desc": info["desc"],
            "insight": insights.get(mid, ""),
            "status": _machine_status(vitals),
            "vitals": vitals,
        })

    return {"machines": machines}
