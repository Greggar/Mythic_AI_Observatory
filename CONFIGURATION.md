# Configuration Guide

## Overview

The system uses a layered configuration strategy:

1. **`network.json`** (`backend/data/network.json`) — runtime-editable via Settings UI. Survives restarts.
2. **Environment variables** — override defaults at startup. See `.env` files for documented values.
3. **Python source defaults** — last-resort fallbacks when neither env var nor config file is set.

No code changes are needed to reconfigure the system for a new network.

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `CONDUCTOR_HOST` | `127.0.0.1` | IP to bind the FastAPI server |
| `CONDUCTOR_PORT` | `8001` | Port for the FastAPI server |
| `OLLAMA_MODEL` | `qwen2.5:3b` | Local (CPU) inference model |
| `ORCHESTRATOR_MODEL` | `local` | Provider: `local` or `backoffice` |
| `CLASSIFIER_MODEL` | `qwen2.5:1.5b` | Model for background synesthesia classifier |
| `CLASSIFIER_POLL_INTERVAL` | `45` | Seconds between classifier agent cycles |
| `EMBEDDING_MODEL` | `all-minilm:22m` | Model for DDC/LCC embedding similarity |
| `MODEL_PROFILES_DIR` | `backend/data/model_profiles` | Directory for diagnostic probe profiles (per-model) |

### Frontend (`frontend/.env`)

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8001` | Backend API URL (must be reachable from browser) |
| `ALLOWED_ORIGINS` | *(empty)* | Comma-separated IPs allowed in dev mode (e.g. `198.51.100.1,198.51.100.2`) |
| `FRONTEND_PORT` | `3001` | Port for the Next.js server (used by `restart.sh`) |

---

## `network.json` — Runtime Configuration

Located at `backend/data/network.json`. Editable through **Settings → Services** and **Settings → Models** tabs. Changes take effect immediately — no restart required.

### Services (`settings > Services tab`)

```json
{
  "services": {
    "ollama": {
      "label": "Ollama",
      "host": "127.0.0.1",
      "port": 11434,
      "enabled": true
    },
    "backoffice_llm": {
      "label": "Worker Node 1 LLM",
      "host": "198.51.100.2",
      "port": 12434,
      "model": "qwen2.5:7b",
      "enabled": true
    },
    "openclaw": { ... },
    "prometheus": { ... },
    "hermes": { ... },
    "comfyui": { ... }
  }
}
```

Each service has:
- `label` — human-readable name
- `host` — IP or hostname
- `port` — TCP port
- `model` — (optional) default model for this service
- `enabled` — if `false`, the service is skipped during health checks

### Machines (`Settings > Machines tab`)

```json
{
  "machines": {
    "primary-server": {
      "name": "Primary Server",
      "host": "127.0.0.1",
      "desc": "Primary orchestration server",
      "insight": "The conductor. All orchestration originates here.",
      "services": ["ollama", "openclaw"]
    }
  }
}
```

### Analysis Model (`Settings > Models tab`)

```json
{
  "analysis": {
    "model": "qwen2.5:7b",
    "provider": "backoffice"
  }
}
```

Set independently of the execution model. Can be a larger/remote model while the execution model stays small and local.

### Embedding Model (`Settings > Models tab — new`)

```json
{
  "embeddings": {
    "model": "all-minilm:22m",
    "cache_dir": "/tmp"
  }
}
```

Used by DDC and LCC embedding classifiers. The model must support the `/api/embeddings` endpoint.

### Classifier Model (`Settings > Models tab — new`)

```json
{
  "classifier": {
    "model": "qwen2.5:1.5b",
    "poll_interval": 45
  }
}
```

Used by the background synesthesia classification agent. Keep small — it runs every 45 seconds on unclassified traces.

### Diagnostic Probe Profiles (`backend/data/model_profiles/`)

Results from `tools/run_diagnostic.py` are saved per model:

```
backend/data/model_profiles/
├── qwen2.5_3b.json
└── llama3.2_3b.json
```

Each file contains:

```json
{
  "model": "qwen2.5:3b",
  "model_slug": "qwen2.5_3b",
  "provider": "local",
  "created_at": "2026-06-20T01:25:00",
  "updated_at": "2026-06-20T01:25:00",
  "probes": {
    "default-tone": {
      "category": "tone",
      "prompt": "Explain black holes...",
      "description": "Reveals default tone...",
      "trace_id": "abc123",
      "response": "full output...",
      "response_summary": "first 300 chars...",
      "completed_at": "2026-06-20T01:25:00",
      "duration_seconds": 45.3,
      "steps_count": 7,
      "error": null
    }
  },
  "summary": {
    "total_probes": 12,
    "completed": 12,
    "errors": 0,
    "timeouts": 0,
    "by_category": {
      "tone": {"total": 1, "completed": 1},
      "structure": {"total": 2, "completed": 2}
    }
  }
}
```

Override the directory with `MODEL_PROFILES_DIR` env var (default: `backend/data/model_profiles/`). Each model gets its own file, so profiles for different models coexist and can be compared.

---

## Key Architecture: How Config Flows

```
network.json  ──→  config_manager.py  ──→  services/*.py
     ↑                    │
     │              (cached in memory)
     │                    │
Settings UI ──→  PUT /api/network-config
```

- `config_manager.py` loads `network.json` on first access and caches it
- Service modules (DDC, LCC, classifier agent) query `config_manager` at call time
- The Settings UI reads via `GET /api/network-config` and writes via `PUT /api/network-config`
- No hot-reload mechanism needed — `config_manager` checks its in-memory cache which is invalidated on save

## Adding a New Configurable Value

1. Add the key to `config_manager.py` with a getter function and default
2. Update the consuming service to call the getter (with env var override if needed)
3. Add the field to the `NetworkConfig` TypeScript interface in `SettingsModal.tsx`
4. Add a UI input in the appropriate Settings tab
