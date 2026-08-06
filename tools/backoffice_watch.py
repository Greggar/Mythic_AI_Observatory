#!/usr/bin/env python3
"""Backoffice freeze watcher.

Samples, on an interval, the backoffice GPU/host metrics from Prometheus plus
the worker (DMR) endpoint latency, and writes a timestamped CSV. Use it while
running a live orchestration to distinguish slow generation (GPU saturated,
latency fine) from a genuinely frozen worker (endpoint stalls) or a seizing
host (load pegged).

Config:
  PROMETHEUS_URL  Prometheus base URL (default http://localhost:9090). Point
                  it at the backoffice Prometheus for backoffice metrics. The
                  instance label is derived from this URL's host (host:9100),
                  so point it at the backoffice host that also runs its node
                  exporter.
  BACKOFFICE_INSTANCE  Explicit Prometheus instance label override (e.g.
                  "198.51.100.50:9100"). Use when the node exporter label does
                  not match the PROMETHEUS_URL host.
  WORKER_URL      Overrides the worker URL read from network.json.

Usage:
  PROMETHEUS_URL=http://<backoffice>:9090 python3 tools/backoffice_watch.py \
      --seconds 180 --out /tmp/backoffice_watch.csv
"""

import argparse
import csv
import os
import sys
import time
import urllib.request
import urllib.parse
import json
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))


def prom_instant(prom_url: str, query: str) -> dict[str, float]:
    """Return {instance: value} for an instant vector query."""
    url = prom_url.rstrip("/") + "/api/v1/query?" + urllib.parse.urlencode({"query": query})
    try:
        with urllib.request.urlopen(url, timeout=3) as r:
            data = json.load(r)
    except Exception:
        return {}
    out: dict[str, float] = {}
    for res in data.get("data", {}).get("result", []):
        try:
            out[res["metric"].get("instance", "")] = float(res["value"][1])
        except (KeyError, TypeError, ValueError):
            continue
    return out


def dmr_latency_ms(worker_url: str) -> float:
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(worker_url.rstrip("/") + "/v1/models", timeout=1.5) as r:
            r.read()
        return round((time.monotonic() - t0) * 1000, 1)
    except Exception:
        return -1.0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--seconds", type=float, default=120.0)
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--out", default="/tmp/backoffice_watch.csv")
    args = ap.parse_args()

    prom_url = os.environ.get("PROMETHEUS_URL", "http://localhost:9090")
    worker_url = os.environ.get("WORKER_URL", "")
    if not worker_url:
        from services.config_manager import service_url
        worker_url = service_url("worker_llm")

    instance = os.environ.get("BACKOFFICE_INSTANCE", "")
    if not instance:
        host = urllib.parse.urlsplit(prom_url).hostname or ""
        instance = f"{host}:9100" if host else ""

    def pick(vals: dict[str, float]) -> float | None:
        if instance and instance in vals:
            return vals[instance]
        return next(iter(vals.values())) if vals else None

    fieldnames = [
        "ts", "gpu_util", "gpu_mem_util", "load1", "load5",
        "mem_avail_gb", "dmr_latency_ms",
    ]
    print(f"prom={prom_url} worker={worker_url} instance={instance or '(first match)'} -> {args.out}")
    deadline = time.monotonic() + args.seconds
    with open(args.out, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        while time.monotonic() < deadline:
            gpu_util = prom_instant(prom_url, "gpu_usage_percent")
            gpu_mem = prom_instant(prom_url, "gpu_memory_usage_percent")
            load1 = prom_instant(prom_url, "node_load1")
            load5 = prom_instant(prom_url, "node_load5")
            mem_avail = prom_instant(prom_url, "node_memory_MemAvailable_bytes")
            lat = dmr_latency_ms(worker_url)
            row = {
                "ts": datetime.now(timezone.utc).strftime("%H:%M:%S"),
                "gpu_util": pick(gpu_util),
                "gpu_mem_util": pick(gpu_mem),
                "load1": pick(load1),
                "load5": pick(load5),
                "mem_avail_gb": round(pick(mem_avail) / 1e9, 2) if pick(mem_avail) is not None else None,
                "dmr_latency_ms": lat,
            }
            w.writerow(row)
            f.flush()
            print(f"{row['ts']} gpu={row['gpu_util']}% mem={row['gpu_mem_util']}% "
                  f"load1={row['load1']} dmr={row['dmr_latency_ms']}ms")
            time.sleep(args.interval)
    print("done:", args.out)


if __name__ == "__main__":
    main()
