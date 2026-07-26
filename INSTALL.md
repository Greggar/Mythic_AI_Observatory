# Installing Mythic AI Observatory

Step-by-step guide for getting the Observatory running on a fresh machine.

## Prerequisites

The following must be installed before starting:

| Dependency | Check command | Install |
|-----------|--------------|---------|
| Python 3.11+ | `python3 --version` | `sudo apt install python3 python3-venv python3-pip` |
| Node.js 20+ | `node --version` | [nvm](https://github.com/nvm-sh/nvm) or `sudo apt install nodejs` |
| pnpm | `pnpm --version` | `npm install -g pnpm` |
| Ollama | `ollama --version` | [ollama.com](https://ollama.com) |

If any of these are missing, install them first and verify with the check commands above.

## Install

```bash
git clone https://github.com/Greggar/Mythic_AI_Observatory.git
cd Mythic_AI_Observatory
bash install.sh
```

`install.sh` will:
- Detect which Ollama models you have available
- Create `.env` files with appropriate model defaults
- Set up a Python virtual environment and install dependencies
- Install Node.js dependencies

If Ollama is not running, the script will use fallback model names. You can pull models later with `ollama pull <model-name>`.

## Start

```bash
bash restart.sh
```

This starts both the backend (FastAPI on port 8001) and frontend (Next.js on port 3001).

## Verify

Check the backend is running:

```bash
curl http://localhost:8001/health
```

Expected output:
```json
{"status":"ok","service":"conductor-api"}
```

Then open **http://localhost:3001** in a browser. On first launch, a setup wizard will walk through provider configuration.

## Troubleshooting

**`pnpm: command not found`** — install pnpm: `npm install -g pnpm`

**`ollama list` fails / no models** — start Ollama first: `ollama serve` (or it may be running as a systemd service). Then pull a model: `ollama pull qwen2.5:3b`

**Backend won't start** — check if port 8001 is already in use: `ss -tlnp | grep 8001`. Kill any conflicting process or change the port in `backend/.env` (`CONDUCTOR_PORT=8002`).

**Frontend shows "connection refused"** — the frontend is trying to reach the backend. Ensure the backend is running (`curl http://localhost:8001/health`) and that `NEXT_PUBLIC_API_URL` in `frontend/.env.local` matches.

**`restart.sh` says "uvicorn not found"** — the Python venv may not be set up. Run: `cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`

**First trace is slow (~30s)** — the model is loading into memory. Subsequent traces are fast.

**Using Docker Model Runner instead of Ollama?** — DMR doesn't serve embeddings (`/api/embeddings`). After install, edit `backend/data/network.json` and set `embeddings.url` to an Ollama instance with `all-minilm:22m` (can be Docker Ollama on the same machine). Also update `services.ollama` to point at DMR's port (12434) if using it for completions.

## Optional Services

These are not required. The Observatory works without them — they just add extra features.

| Service | What it adds | How to enable |
|---------|-------------|---------------|
| **OpenClaw** | Agent gateway integration | Configure in `backend/data/network.json` under `services.openclaw` |
| **Prometheus** | External metrics collection | Add the backend as a scrape target (see [METRICS-AND-GRAFANA.md](METRICS-AND-GRAFANA.md)) |
| **Grafana** | Metric dashboards and alerting | Connect to Prometheus data source (see [METRICS-AND-GRAFANA.md](METRICS-AND-GRAFANA.md)) |

## Multi-Machine Setup

To run the frontend and backend on different machines, or to access the dashboard from another computer on your LAN:

1. Set `CONDUCTOR_HOST=0.0.0.0` in `backend/.env` (already the default)
2. Set `NEXT_PUBLIC_API_URL=http://<backend-ip>:8001` in `frontend/.env.local`
3. Start the backend, then the frontend
4. Open `http://<frontend-ip>:3001` from any machine on the network
