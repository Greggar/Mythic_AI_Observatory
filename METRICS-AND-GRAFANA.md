# Metrics, Prometheus & Grafana — Integration Guide

This document explains how the Mythic AI Observatory's monitoring stack works and how a future OpenCode session can extend it.

## Current Topology

```
BackOffice (100.100.179.99)                    primary-server (192.168.0.237)
┌──────────────────────────────┐               ┌──────────────────────────────────┐
│  Prometheus :9090 (Snap)     │               │  Grafana :3030                   │
│  Node Exporter :9100         │◄──Tailscale──►│  Node Exporter :9100             │
│  Docker Model Runner :12434  │               │  FastAPI :8001 (Conductor)       │
│  HTTP File Server :9999      │               │    └── /metrics (Prometheus)     │
└──────────────────────────────┘               │  Next.js :3001 (Solar Interface) │
                                               └──────────────────────────────────┘
```

## Grafana

- **URL:** http://localhost:3030 (login: `admin`/`admin`)
- **Data source:** Prometheus at `http://100.100.179.99:9090`
- **Dashboard imported:** "Multi-PC Resource Monitor" (UID: `multi-pc-monitor`)

The dashboard has three sections:
1. **Overview** — CPU/RAM/GPU/VRAM stat panels averaged across all node-exporter instances
2. **Per-PC Status** — colour-coded table by instance
3. **Time Series** — CPU & Memory, GPU & VRAM over time

## Backend Prometheus Endpoint

The FastAPI server already exposes `/metrics` at `http://localhost:8001/metrics` with these custom metrics:

| Metric | Type | Description |
|--------|------|-------------|
| `system_cpu_percent` | Gauge | CPU usage % |
| `system_memory_percent` | Gauge | Memory usage % |
| `gpu_memory_percent` | Gauge | GPU memory usage % |
| `gpu_util_percent` | Gauge | GPU compute utilization % |
| `ollama_models_count` | Gauge | Number of Ollama models available |
| `openclaw_uptime_seconds` | Gauge | OpenClaw gateway uptime (seconds) |

**These metrics are NOT currently scraped by Prometheus.** To add them:

1. SSH into BackOffice or edit its Prometheus config directly
2. Add a scrape target to `/var/snap/prometheus/current/prometheus.yml`:
   ```yaml
   - job_name: "conductor"
     static_configs:
       - targets: ["100.69.155.86:8001"]   # primary-server Tailscale IP
   ```
3. Restart Prometheus: `sudo snap restart prometheus`

## What the Frontend Uses

The frontend (`useWebSocket.ts`) currently polls `http://192.168.0.237:8001/api/telemetry` every 1.5s — this is the backend's structured JSON telemetry (CPU, memory, GPU, remotes, etc.). It does **not** query Prometheus directly.

The frontend visualises telemetry via:
- `ResourceConstellation.tsx` — SVG celestial bodies for CPU/Memory/GPU/Network
- `TrendChart.tsx` — SVG bezier trend lines over ~90s window
- `SystemVitals.tsx` — gauge bars

## Next Steps for Future Sessions

### 1. Add Conductor to Prometheus Scrape Targets
Add the backend's `/metrics` endpoint to Prometheus so Grafana can show Conductor-specific metrics alongside node-exporter data.

### 2. Create a Grafana Dashboard for Conductor
Import or create a new dashboard showing `system_cpu_percent`, `ollama_models_count`, trace latency, etc. — metrics only the Conductor exposes.

### 3. Use Prometheus Data in the Frontend
Add a new frontend hook (`usePromQL`) that queries Prometheus's HTTP API:
```
GET http://100.100.179.99:9090/api/v1/query?query=node_cpu_seconds_total
```
This would give the frontend richer historical data than the 90-second telemetry window.

### 4. Grafana Embedding
Grafana supports panel embedding via `<iframe>` or direct image rendering. Could embed Grafana panels directly in the Solar Interface.

### 5. Alerting
Grafana has built-in alerting. Could trigger notifications when CPU > 90%, backoffice unreachable, or Ollama model count drops to zero.

## Credentials
- Grafana: `admin` / `admin` (http://localhost:3030)
- Prometheus: no auth (LAN only — BackOffice at 100.100.179.99:9090)
- SSH to BackOffice: `ssh 1337greggar@100.100.179.99`

## Config File Locations
- Prometheus: `/var/snap/prometheus/current/prometheus.yml` (BackOffice)
- Grafana: `/etc/grafana/grafana.ini` (primary-server)
- Dashboard JSON: `/home/loki/monitoring-system/grafana-dashboard.json`

## Gotchas & Unwritten Knowledge

### 1. Prometheus Scrape Targets May Be Incomplete
The Prometheus instance runs on BackOffice (`100.100.179.99:9090`) as a Snap package. Its config likely only scrapes localhost. **It may NOT be scraping:**
- `primary-server`'s node-exporter at `100.69.155.86:9100` (Tailscale IP)
- The Conductor's `/metrics` at `100.69.155.86:8001`

Verify with `curl http://100.100.179.99:9090/api/v1/targets` before assuming data is flowing.

### 2. Grafana v13 CLI Syntax Change
The old `grafana-cli` binary is deprecated. All admin commands use the new syntax:
```bash
sudo grafana cli --homepath /usr/share/grafana admin reset-admin-password <pw>
```
Running the old `grafana-cli` without `--homepath` will fail with "Could not find config defaults".

### 3. BackOffice Has an HTTP File Server on Port 9999
BackOffice runs a simple HTTP file server on port 9999 (not SSH, not documented elsewhere). Files can be fetched from it:
```bash
curl -O http://100.100.179.99:9999/<filename>
```
SSH to BackOffice is not available (no sshd running). Use this HTTP server or Tailscale for file transfers.

### 4. Verify the Conductor's `/metrics` Route
The backend imports `generate_latest` and `REGISTRY` from `prometheus_client` in `backend/main.py`, but the FastAPI route `GET /metrics` needs to be verified as registered. Test it:
```bash
curl http://localhost:8001/metrics
```
If it returns a 404, a route decorator needs to be added to `main.py`.

### 5. Port Conflicts
Several services occupy non-standard ports due to past conflicts:
| Port | Service | Why not standard |
|------|---------|-----------------|
| 3000 | RocketChat | Pre-installed, blocks default Grafana/Next.js |
| 3001 | Next.js (Solar Interface) | Moved from 3000 due to RocketChat |
| 3030 | Grafana | Moved from 3000 due to RocketChat |
| 8001 | FastAPI Conductor | Standard 8000 avoided if conflicted |

Always check `ss -tlnp` before adding new services.

### 6. Tailscale IPs Are Stable
- primary-server: `100.69.155.86`
- backoffice: `100.100.179.99`
- loungeroom: `100.89.142.70`

Use Tailscale IPs for cross-machine communication — they're stable and encrypted. LAN IPs (`192.168.0.x`) may change depending on DHCP. Tailscale is authenticated and active.
