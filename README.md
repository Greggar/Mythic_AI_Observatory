<img width="1145" height="832" alt="observatory" src="https://github.com/user-attachments/assets/45575741-1732-457b-a797-d3f9b274c95e" />

# Mythic AI Observatory (Alpha)

A distributed agentic AI monitoring and orchestration platform. Observes, classifies, and visualises LLM inference traces across a local or LAN-connected network of models. This is in the Alpha testing phase.

- **Backend** — FastAPI conductor that runs orchestration traces against Ollama models, classifies them (DDC, LCC, synesthesia), and serves telemetry
- **Frontend** — Next.js 16 dashboard with glassmorphic UI: real-time system vitals, trace replay, classification maps, and comparative analysis

## Quick Start

See [INSTALL.md](INSTALL.md) for detailed step-by-step instructions.

**Requirements:** Python 3.11+, Node.js 20+, pnpm 9+, Ollama (local or LAN)

**Optional:** OpenClaw (agent gateway), Prometheus + Grafana (external monitoring)

```bash
# 1. Clone and set up the backend
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env .env.local        # edit if your Ollama is not on localhost

# 2. Set up the frontend
cd ../frontend
pnpm install
cp .env.example .env.local  # edit NEXT_PUBLIC_API_URL if needed

# 3. Start both servers
cd ..
./restart.sh
```

Open http://localhost:3001. On first launch a setup wizard walks through provider config.

## Architecture

```
┌──────────┐  ┌──────────┐  ┌──────────┐
│  Ollama   │  │ FastAPI  │  │ Next.js  │
│ :11434    │←→│ :8001    │←→│ :3001    │
│ (model)   │  │(conductor)│  │(dashboard)│
└──────────┘  └──────────┘  └──────────┘
```

The **Conductor** (FastAPI) polls system telemetry, manages orchestration traces (7-stage pipeline), and runs background classifiers (DDC, LCC, synesthesia). The **Solar Interface** (Next.js) renders everything in real time.

## Features

- **Orchestration pipeline** — 7-stage agentic trace (Intent Classification → Memory Retrieval → Agent Selection → Context Synthesis → Response Generation → Final Response) against any Ollama model
- **DDC/LCC classification** — embedding-based Dewey Decimal / Library of Congress categorisation for every prompt and response
- **Synesthesia schema** — LLM-powered 6-ring grammar analysis (Depth → Mood → Syntax → Action → Tone → Form)
- **System vitals** — real-time CPU, memory, process health, LAN service discovery
- **Memory Constellation** — interactive dot map of all traces, grouped by DDC, LCC, keyword clusters, or multi-label
- **Radar fingerprint** — multi-trace comparative overlay on 7 axes (Confidence, Context, Constraints, Substance, Honesty, Safety, Adaptability)
- **Synthesis Bridge** — sentence-level linking between retrieved chunks and final output
- **Ghost references** — bidirectional cross-highlighting between LLM self-rationale and system metrics
- **Dual-Timeline** — side-by-side system-recorded vs LLM-stated reasoning for every pipeline stage

## Configuration

Three-layer fallback: **env vars → `network.json` → source defaults**.

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONDUCTOR_PORT` | `8001` | Backend port |
| `OLLAMA_MODEL` | Auto-detected (`qwen2.5:3b` fallback) | Local inference model |
| `ORCHESTRATOR_MODEL` | `local` | Provider (`local`/`worker`) |
| `CLASSIFIER_MODEL` | Auto-detected (`qwen2.5:1.5b` fallback) | Background classifier model |
| `NEXT_PUBLIC_API_URL` | `http://localhost:8001` | Backend URL from browser |

See [CONFIGURATION.md](CONFIGURATION.md) for the full reference.

## Project Structure

```
backend/
├── main.py              # FastAPI app, REST + WebSocket endpoints
├── models/trace.py      # Pydantic models (TraceSession, TraceStep, ...)
├── services/
│   ├── orchestrator.py  # 7-stage trace pipeline
│   ├── config_manager.py# Three-layer config resolver
│   ├── ddc_embeddings.py# DDC classification via embedding similarity
│   ├── lcc_embeddings.py# LCC classification
│   ├── classifier_agent.py # Background synesthesia classifier
│   ├── synesthesia_schema.md # Editable classification schema
│   └── vitals.py        # System telemetry collector
├── data/
│   ├── network.json     # Runtime config (services, providers, models)
│   └── traces.jsonl     # Trace persistence
└── requirements.txt

frontend/
├── src/
│   ├── app/page.tsx     # Main dashboard layout
│   ├── components/      # UI components
│   │   ├── charts/      # D3-based charts (Sunburst, Sankey, Heatmap, ...)
│   │   ├── MemoryConstellation.tsx  # Trace dot map
│   │   ├── IntelligencePanel.tsx    # Trace detail panel
│   │   ├── SynthesisBridge.tsx      # Chunk-to-output linking
│   │   ├── TraceRadar.tsx           # Radar fingerprint
│   │   └── SetupWizard.tsx          # First-run wizard
│   └── types/trace.ts   # TypeScript interfaces
├── next.config.ts
└── package.json
```

## Troubleshooting

**Backend won't start** — ensure Ollama is running (`ollama list`). If on a different host, set `OLLAMA_BASE_URL` in `network.json`.

**Frontend shows "connection refused"** — check `NEXT_PUBLIC_API_URL` matches the backend's reachable address (not `localhost` if browsing from another machine).

**Slow first trace** — the first inference loads the model into memory (~30s). Subsequent traces are instant.

## Testing

```bash
cd backend
source .venv/bin/activate
pip install -r requirements.txt   # includes pytest
python -m pytest tests/ -v
```

See [DEVELOPMENT.md](DEVELOPMENT.md) for the dev workflow and [ARCHITECTURE.md](ARCHITECTURE.md) for the deep dive.
