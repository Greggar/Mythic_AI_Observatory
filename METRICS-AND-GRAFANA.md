# Monitoring, Prometheus & Grafana

This document explains how the Observatory's monitoring stack works and how to integrate it with Prometheus and Grafana on your own network.

## Architecture Overview

The Observatory exposes telemetry via two channels:

1. **Internal telemetry API** — `GET /api/telemetry` returns structured JSON (CPU, memory, GPU, remotes) polled by the frontend every 1.5s
2. **Prometheus metrics** — `GET /metrics` returns Prometheus-compatible metrics for external monitoring

```
Frontend (:3001) ──polls──► Backend (:8001) ──scraped by──► Prometheus ──queried by──► Grafana
                                        │
                                        └── /api/telemetry (JSON, for frontend)
                                        └── /metrics        (Prometheus exposition format)
```

The frontend does **not** query Prometheus directly. It uses the internal `/api/telemetry` JSON endpoint for its visualisations (ResourceConstellation, TrendChart, SystemVitals).

## Custom Prometheus Metrics

The backend exposes these metrics at `GET /metrics`:

| Metric | Type | Description |
|--------|------|-------------|
| `system_cpu_percent` | Gauge | CPU usage % |
| `system_memory_percent` | Gauge | Memory usage % |
| `gpu_memory_percent` | Gauge | GPU memory usage % |
| `gpu_util_percent` | Gauge | GPU compute utilization % |
| `ollama_models_count` | Gauge | Number of Ollama models available |
| `openclaw_uptime_seconds` | Gauge | OpenClaw gateway uptime (seconds) |

Verify the endpoint is working:

```bash
curl http://localhost:8001/metrics
```

If it returns a 404, the Prometheus route may not be registered. Check `backend/main.py` for the `/metrics` route decorator.

## Configuring Prometheus Scrape Targets

Add the Observatory backend as a Prometheus scrape target so Grafana can query its metrics alongside node-exporter data.

Edit your Prometheus config (`prometheus.yml`):

```yaml
scrape_configs:
  # Node Exporter (one per machine you want to monitor)
  - job_name: "node-exporter"
    static_configs:
      - targets: ["your-server-ip:9100"]

  # Observatory Backend
  - job_name: "observatory"
    static_configs:
      - targets: ["your-server-ip:8001"]
```

Restart Prometheus after changes:

```bash
# Snap
sudo snap restart prometheus

# Docker
docker restart prometheus

# Systemd
sudo systemctl restart prometheus
```

Verify targets are being scraped:

```bash
curl http://your-prometheus-ip:9090/api/v1/targets
```

## Querying the Prometheus API

The Prometheus HTTP API lets you query metrics programmatically:

```bash
# Instant query — current value
curl 'http://your-prometheus-ip:9090/api/v1/query?query=system_cpu_percent'

# Range query — over time
curl 'http://your-prometheus-ip:9090/api/v1/query_range?query=system_cpu_percent&start=2026-01-01T00:00:00Z&end=2026-01-01T01:00:00Z&step=60'

# List all available metrics
curl 'http://your-prometheus-ip:9090/api/v1/label/__name__/values'
```

This could be used to give the frontend richer historical data than the 90-second telemetry window — see "Next Steps" below.

## Grafana Setup

### Installation

Follow the [official Grafana installation guide](https://grafana.com/docs/grafana/latest/setup/install/) for your platform.

### Adding Prometheus as a Data Source

1. Open Grafana (`http://your-grafana-ip:3000`)
2. Go to **Connections → Data Sources → Add data source**
3. Select **Prometheus**
4. Set the URL to `http://your-prometheus-ip:9090`
5. Click **Save & Test**

### Creating a Dashboard

1. Go to **Dashboards → New Dashboard**
2. Add panels and use PromQL queries against your metrics:
   - `system_cpu_percent` — CPU usage over time
   - `system_memory_percent` — Memory usage over time
   - `gpu_util_percent` — GPU utilization (if NVIDIA GPU present)
   - `ollama_models_count` — Number of available models

### Embedding Grafana in the Frontend

Grafana supports panel embedding via `<iframe>` or direct image rendering. You could embed specific panels directly in the Observatory interface for a unified view.

### Alerting

Grafana has built-in alerting. Common alerts for the Observatory:

- CPU > 90% for 5 minutes
- Backend unreachable (metric scrape failing)
- Ollama model count drops to zero
- GPU memory > 95%

## Next Steps

### Use Prometheus Data in the Frontend

Add a new frontend hook (e.g. `usePromQL`) that queries the Prometheus HTTP API directly:

```typescript
const response = await fetch(
  `http://your-prometheus-ip:9090/api/v1/query?query=system_cpu_percent`
);
const data = await response.json();
```

This would give the frontend access to historical data beyond the 90-second telemetry window.

### Conductor Metrics in Grafana

Create a dedicated Grafana dashboard for Observatory-specific metrics (`system_cpu_percent`, `ollama_models_count`, etc.) to monitor model health and system load over time.

### Cross-Machine Monitoring

If running Prometheus on a separate machine from the Observatory, use stable network addresses (e.g. Tailscale IPs, static LAN IPs, or DNS names) for scrape targets. Avoid DHCP-assigned addresses that may change.

## Gotchas

### Prometheus Scrape Targets May Be Incomplete

A default Prometheus installation often only scrapes `localhost`. If your Observatory runs on a different machine than Prometheus, you must explicitly add its address to `scrape_targets`. Verify with the `/api/v1/targets` endpoint.

### Port Conflicts

Check for existing services before assigning ports:

```bash
ss -tlnp
```

Common conflicts: port 3000 (often occupied by other tools), port 8000 (common default for Python servers).

### No Auth on Prometheus

Prometheus typically runs without authentication. If exposed beyond localhost, ensure it's only accessible on a trusted network or behind a reverse proxy with auth.

### GPU Metrics Require nvidia-smi

GPU metrics (`gpu_memory_percent`, `gpu_util_percent`) require `nvidia-smi` to be installed and working. On systems without NVIDIA GPUs, these metrics return 0.
