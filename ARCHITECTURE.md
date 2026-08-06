# Mythic AI Observatory — Architecture & Operations Guide

---

## 1. Project Overview

The Mythic AI Observatory is a distributed agentic AI monitoring and orchestration platform. It consists of a FastAPI backend (the "Conductor") that polls system telemetry and runs orchestration traces backed by real LLM inference, a Next.js frontend (the "Solar Interface") that visualises everything with an elegant glassmorphic UI, and a Prometheus stack for long-term metrics.

**Core philosophy:** calm, intelligent, observability-first. The UI avoids game/cyberpunk/cluttered aesthetics in favour of sacred geometry, subtle glow effects, and negative space.

### Design Values

**Truth over polish** — A beautiful lie is worse than an honest blemish. Stage names, descriptions, and visual metaphors must match what the code actually does. When the implementation changes, the representation changes with it.

**Beauty is not a lie** — Dramatic emphasis, visual hierarchy, and aesthetic craft are not the enemies of accuracy. They serve it by directing attention to what matters. The model gets the sun position not because it's a god, but because it's the operational centre of gravity.

**Flares, not falsehoods** — Animation, glow, and ornament are welcome as long as they don't imply behaviour that doesn't exist. A pulsing node says "this is active," not "this is an autonomous intelligence."

---

## 2. System Topology

```
┌─────────────────────────────────────────────────────────────────┐
│                        Ubuntu Server                             │
│                    198.51.100.1 (primary-server)              │
│                                                                  │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────────┐ │
│  │  Ollama   │  │ llama.cpp    │  │ OpenClaw │  │ FastAPI  │  │   Next.js 16    │ │
│  │ :11434    │  │ :12435       │  │ :18789   │  │ :8001    │  │   :3001         │ │
│  │ (local)   │  │ (exec model, │  │(systemd) │  │ (uvicorn)│  │   (pnpm dev)    │ │
│  │           │  │  logprobs)   │  │          │  │          │  │                 │ │
│  └──────────┘  └──────────────┘  └──────────┘  └──────────┘  └─────────────────┘ │
│                                       │                         │
│  ┌────────────────────────────────────┘                         │
│  │  Prometheus Snap :9090    Node Exporter :9100                │
│  │  (currently down — see §6 Troubleshooting)                    │
│  └──────────────────────────────────────────────────────────────┘
│                           │
│                           ▼ LAN
│              ┌──────────────────────────┐
│              │   Worker Node 1           │
│              │   198.51.100.100           │
│              │                           │
│              │  Docker Model Runner      │
│              │  :12434                   │
│              │  ┌─ qwen2.5:7b (11GB)   │
│              │  └─ qwen2.5:7b (5.5GB)   │
│              │                           │
│              │  Hermes Bridge :9119      │
│              │  ComfyUI :8188            │
│              └──────────────────────────┘
```

### Port Allocation

| Service | Port | Binding | Status |
|---|---|---|---|---|
| Ollama (local) | 11434 | 127.0.0.1 | Running |
| Local LLM (llama.cpp-server, exec model) | 12435 | 127.0.0.1 | Running |
| OpenClaw Gateway | 18789 | 0.0.0.0 | Running (systemd user service) |
| FastAPI Conductor | 8001 | 0.0.0.0 | Manual start |
| Next.js Solar Interface | 3001 | 0.0.0.0 | Manual start (next start — production mode) |
| Docker Model Runner | 12434 | (worker) | Running |
| Prometheus | 9090 | 0.0.0.0 | Running (fix applied) |
| Node Exporter | 9100 | 0.0.0.0 | Running |

---

## 3. Backend Architecture

### Entry Point: `backend/main.py`

- **FastAPI app** with CORS wide-open for LAN development
- **Background telemetry loop:** polls CPU, memory, GPU (nvidia-smi), Ollama tags, OpenClaw health, and remote endpoints (Hermes, ComfyUI) every 1.5s. Remote polling now includes a `detail` field (`"connection_refused"`, `"timeout"`, `"unreachable"`) so the frontend can distinguish intentionally stopped services from actual failures.
- **WebSocket endpoint** `/ws/telemetry` broadcasts structured telemetry JSON to all connected frontend clients
- **REST endpoints:**
  - `GET /health` — liveness check
  - `GET /metrics` — Prometheus-formatted metrics
  - `POST /api/orchestrate` — submit a prompt, get a trace (see §3.1)
  - `GET /api/traces` — list all traces (supports `?limit=`)
  - `GET /api/traces/{id}` — retrieve a persisted trace
  - `DELETE /api/traces/{id}` — delete a trace from the store and `traces.jsonl`
  - `GET /api/traces/{id}/annotations` — list annotations for a trace
  - `POST /api/traces/{id}/annotations` — create an annotation
  - `DELETE /api/traces/{id}/annotations/{ann_id}` — delete an annotation
  - `GET /api/services` — return service definitions from `data/services.json`
  - `GET /api/telemetry` — latest telemetry snapshot (used by frontend HTTP polling)

### Trace Models: `backend/models/trace.py`

```python
TraceStep     — id, label, status, timestamp, duration_ms, metadata, context_assembled
TraceSession  — id, prompt, status, steps[], output, created_at, completed_at, model_used
```

**`context_assembled`** — a new field added for transparency. At each stage with a model configured (steps 2, 6), the concatenated context (`"\n".join(context + [prompt])`) is stored on the step so the frontend can display exactly what was sent to the model. Non-model stages store `"[non-model stage — no context assembly]"`.

**`model_used`** on the session records which model name wound up being called (e.g. `qwen2.5:3b`).

Using Pydantic `BaseModel` with sensible defaults (auto-timestamps, empty metadata).

### Orchestrator Service: `backend/services/orchestrator.py`

- **7 stages** (only step 6 calls an LLM; steps 2 and 5 are lightweight):
  1. Request Received — 50ms, no model
  2. Intent Classification — embedding-based (all-minilm:22m cosine similarity), ~73ms, no LLM call
  3. Model Routing — 50ms, no model
  4. Memory Retrieval — 50ms, no model
  5. Context Assembly — echoes primary intent as pass-through, no LLM call
  6. Response Generation — calls `qwen2.5:3b` (final answer)
  7. Output Packaging — 50ms, no model
- Steps execute sequentially via `asyncio`
- Each model call sends the accumulated context + the original prompt, using `httpx.AsyncClient`
- Worker Node 1 URL: `http://198.51.100.100:12434` (Ollama-compatible API)
- The model (`qwen2.5:3b`) generates a standard response
- In-memory dict store (`_store`) keyed by trace ID (UUID hex, 12 chars)

**Design reasoning:** Real LLM calls make the trace timeline authentic — each step's duration reflects actual model inference time, and the final output is a genuine model response rather than a canned string.

### 3.4 Living Orchestration — Async Background Tasks

The orchestration endpoint was changed from a synchronous POST (block until all 7 stages complete) to an **async background task** pattern:

1. `POST /api/orchestrate` creates a `TraceSession`, stores it in `_store`, starts `asyncio.create_task(orchestrate(...))`, and immediately returns `{"trace_id": "...", "status": "started"}`.
2. The background task runs the 7 stages, updating `_store[trace_id]` incrementally as each stage completes.
3. The frontend polls `GET /api/traces/{trace_id}` every 1.5s for incremental updates.
4. Activity events (`emit_event` in `orchestrator.py`) are written to the in-memory deque during processing, so `GET /api/activity` returns live events even before the trace finishes.

This decouples the orchestration runtime from the HTTP request lifecycle, enabling real-time streaming of stage progress to the UI without WebSocket or SSE infrastructure.

```python
# main.py — async orchestration
@app.post("/api/orchestrate")
async def api_orchestrate(req: OrchestrateRequest) -> dict[str, str]:
    session = TraceSession(id=uuid.uuid4().hex[:12], prompt=req.prompt)
    _store[session.id] = session
    task = asyncio.create_task(orchestrate(req.prompt, session.id))
    return {"trace_id": session.id, "status": "started"}
```

### 3.5 Model Provider Selection (registry-driven routing)

Execution provider is controlled by `ORCHESTRATOR_MODEL` env var (default: `local`), and **hot-swappable at runtime** via `set_model_provider("local"|"worker")`.

Routing is **registry-driven**, not a hardcoded binary switch. `_resolve_model_endpoint(model_key)` in the orchestrator looks up a model chain and picks the first node that is enabled+reachable:

| Provider | Preferred node | Fallback | Protocol | Logprobs |
|---|---|---|---|---|
| `local` | `local_llm` — llama.cpp-server on `127.0.0.1:12435` (serves `qwen2.5:3b` GGUF) | `ollama` (`127.0.0.1:11434`) | `openai` | ✓ |
| `worker` | `worker_llm` — llama.cpp-server on the backoffice GPU node (`:12434`, serves `gpt-oss:20B`) | — | `openai` | ✓ |

Every node that speaks OpenAI-compatible + top-k logprobs (llama.cpp-server, vLLM, TGI, LM Studio) becomes a first-class node by adding a `network.json` service entry — no orchestrator changes. The `local_llm` node exists specifically because Ollama does **not** expose logprobs; serving the execution model through it lets the primary node capture token entropy instead of silently losing it.

**Node-qualified model identity** — `session.model_used` is now `<node>/<model>` (e.g. `primary/qwen2.5:3b`, `backoffice/gpt-oss:20B`). The node is derived from `config_manager.get_service_node()` (which machine owns the service in `network.json`). This keeps personality profiles and entropy aggregated per model×node instead of merging same-named models across machines. Legacy traces predating qualification keep their unqualified names.

**Runtime hot-swap** — implemented as a mutable module-level global `_MODEL_PROVIDER` with `get_model_provider()` / `set_model_provider()` accessors. Two REST endpoints expose this:

- `GET /api/config/model` — returns `{"provider": "local"|"worker"}`
- `POST /api/config/model` — accepts `{"provider": "local"|"worker"}`, switches on the fly, returns 400 on invalid value

No restart or reload needed — the next `_call_model()` invocation reads the current provider. This lets the frontend SettingsModal switch models without a server restart.

### 3.6 Token-Level Uncertainty Capture (Entropy)

When the execution node speaks OpenAI-compat with `logprobs` enabled, the orchestrator asks for top-5 logprobs on every generated token (`_call_openai`), then computes per-trace entropy via `_compute_token_entropy()`:

- **mean entropy** — average of `-Σ p·log2(p)` over top-5 probabilities (normalized to bits, 0–~2.5)
- **p95 entropy / max surprisal** — tail-of-distribution view; surprisal = `-log2(p_best)`
- **series** — per-token values, kept as the model's uncertainty timeline

Stored on `TraceSession.token_entropy` (and per-step in step 6 metadata), surfaced as:
- **EntropyTrajectoryChart** — full SVG line+area of the `series` over the generation (mean/p95 reference lines, peak marker mapped to its output word), rendered in the "Response Generation" TimelineStep; replaced `UncertaintySparkline` (2026-08-05)
- **Decisiveness** axis on the personality fingerprint (low mean entropy = decisive)
- **DualTimeline** entropy cards per stage
- **EntropyCalibrationPanel** (analysis `memory` → `calibration`) — scatter of mean entropy vs DDC/LCC margin and intent confidence, Pearson r per metric, verdict gated at MIN_N=6 (2026-08-05)

Entropy is **node-local** — values are only comparable across models served by nodes with the same tokenizer/logprob semantics. A canonical-fact trace ("capital of France") correctly shows near-zero entropy; that near-zero is the honest signal, not a bug.

### 3.7 Memory Grounding Analysis

`MemoryEntropyPanel` (frontend) buckets traces by whether their retrieved chunks were `used`, `discarded`, or absent (no `retrieved_chunks`), then compares mean token entropy across groups. The Δ(used − discarded) readout answers "does grounding in memory make the model more decisive?" — and the verdict is **always labeled anecdotal** when the corpus is small (currently only a handful of traces carry entropy, all predating the rest). Traces without `token_entropy` are excluded and the panel shows an honest empty state.

### 3.8 Chat Sessions (multi-turn)

Chats are **linked trace groups** — no new storage. Every `TraceSession` carries two optional fields:

- `chat_id: str | None` — UUID generated by the frontend on the first message (`None` = standalone single prompt, fully backward compatible).
- `exchange_index: int | None` — server-assigned, incremented per `chat_id`. Out-of-sequence exchanges are rejected.

Flow: `POST /api/orchestrate` accepts an optional `chat_id`; `orchestrate()` stamps it and assigns the next `exchange_index` via `next_exchange_index()` (a store scan for the max existing index). Listing endpoints (`GET /api/chats` → session summaries, `GET /api/chats/{id}` → ordered exchanges) scan `traces.jsonl`; unknown chats return 404. `api_list_chats` dedupes by trace id across the in-memory `_store` and the persisted file (a double-count bug was caught by `backend/tests/test_chats.py`).

Per-exchange classification (DDC/LCC/intent/entropy) runs automatically — each exchange is a full pipeline trace. Cross-turn influence is currently implicit (prior exchanges are retrievable via the memory-retrieval word-overlap stage); explicit history injection is deferred (Phase 11, item 8).

### 3.9 Model Provider Precedence (env vs saved config)

`ORCHESTRATOR_MODEL` env var **overrides** the provider saved via the Models UI in `network.json`. Default (var unset) → the UI-saved provider is authoritative and survives restarts. Setting the var forces a provider regardless of the saved choice. Symptom this fixes: with the var set to `local` in `backend/.env`, every `--reload` restart silently reset the provider back to local, shadowing the UI choice. `backend/.env` ships with the var **commented out**.

---

## 4. Frontend Architecture

### Component Tree

```
layout.tsx          — Root layout, Geist fonts, dark background
  page.tsx          — Tabbed dashboard: Systems / Single Prompt / Chat / History / Analysis / Tests tabs + settings

  │   [Systems Tab]                    [Trace / Single Prompt Tab]
  │   ─────────────                    ──────────────────────────
  │   ├── SystemVitalsPanel            ├── IntelligencePanel [left sidebar]
  │   ├── EngineStatusPanel            │   ├── StageDescriptions
  │   ├── ResourceConstellation        │   ├── ForkInTheRoad (decision tree)
  │   └── ActivityFeed                 │   ├── ThoughtStream (live log)
  │                                    │   ├── StageDebate (contradiction)
  │   [History Tab]                    │   ├── TraceRadar (radar chart)
  │   ├── IntelligencePanel            │   ├── ChunkDisplay (used/discarded)
  │   ├── MemoryConstellation          │   ├── Causal Tracing
  │   ├── CelestialDistribution        │   └── Context Assembly viewer
  │   └── PersonalityProfile           ├── LatencyBreakdown [left sidebar]
  │                                    ├── PerformanceInsights [right sidebar]
  │   [Chat Tab]                       ├── SolarNexus
  │   ├── ChatTimeline                 │   └── ContextPane
  │   │   (horizontal exchange rail +  ├── PromptInput
  │   │    session replay: play paces  ├── ObservatoryPanel
  │   │    each exchange into the      │   └── TraceTimeline
  │   │    shared surface; loop lives  │       └── TimelineStep
  │   │    in page.tsx so it survives  └── VectorDistanceGraph (MDS-2D)
  │   │    the tab switch)
  │   ├── ChatTrajectory               │
  │   ├── ChatConversationTopology     │   └── TraceTimeline
  │   │   (MDS topic-space landscape:  │       └── TimelineStep
  │   │    per-exchange embeddings →   └── VectorDistanceGraph (MDS-2D)
  │   │    all-pairs cosine distances, │
  │   │    animated comet loops the    │
  │   │    path, per-hop drift labels) │
  │   ├── ChatReferenceMap             │
  │   │   (cross-turn arcs: teal =     │       └── TimelineStep
  │   │    memory retrieval pulled a   └── VectorDistanceGraph (MDS-2D)
  │   │    chunk from an earlier ex,
  │   │    violet dashed = lexical
  │   │    echo of an earlier output)
  │   ├── ChatContextComposition       │
  │   │   (per-exchange stacked bar:   │
  │   │    fresh vs history carry-over │
  │   │    vs external memory, used    │
  │   │    solid / discarded hatched)  │
  │   ├── ChatMetrics                  │
  │   │   (consistency/drift/mood/     │
  │   │    utilization/entropy trend)  │
  │   └── ChatPanel — conversation spine; clicking an exchange
  │       routes it into the SAME analysis panels above (shared
  │       render layer — no panel duplication)
  │
  ├── SettingsModal       — Network config + Models tab (provider hot-swap)
  ├── DiscoveryEvents     — Toast overlay on orchestration completion
  └── ClientInit          — Catches unhandledrejection + error at window level
```

### Custom Hooks

| Hook | Purpose |
|---|---|
| `useWebSocket(url)` | Polls `http://{server}:8001/api/telemetry` every 1.5s via `fetch()`, returns `{data, connected}` |
| `useOrchestrate()` | POSTs prompt, receives `trace_id`, polls `GET /api/traces/{id}` every 1.5s for incremental updates. Stops polling when status is `complete` or `error`. |
| `useTraceReplay(trace)` | Animates through steps sequentially using each step's `duration_ms` as delay. Returns `{activeStepIndex, phase}`. Used for history replay; live traces bypass replay and use live step index. |
| `useChat()` | Multi-turn chat state machine. Generates the `chat_id` UUID on the first message (`generateId()` — `crypto.randomUUID` only exists in secure contexts, so it falls back to `getRandomValues`-based v4), POSTs `{prompt, chat_id}` to `/api/orchestrate`, polls the exchange via `/api/traces/{id}` until complete, exposes `reset()` for a new session. Backend assigns `exchange_index` (0,1,2…) server-side. |

**Note on transport:** Despite its name, `useWebSocket` **does not use WebSocket**. See §6.7 for why. The hook polls the HTTP endpoint `GET /api/telemetry` every 1.5 seconds. The `connected` field is `true` when the last poll succeeded.

### Type Definitions (`src/types/trace.ts`)

Mirrors the backend Pydantic models in TypeScript for type-safe frontend components.

### Styling Approach

- **Tailwind v4** with CSS-based theming (`@theme inline` in `globals.css`)
- Custom colour tokens: `teal-mystic`, `solar-gold`, `deep-abyss`, `jade-glow`
- Glassmorphic panels via `.glass-panel` utility class:
  ```css
  .glass-panel {
    background: rgba(12, 17, 36, 0.6);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(45, 212, 191, 0.15);
    border-radius: 1.5rem;
  }
  ```
- **Framer Motion** for all animations (subtle, restrained, elegant)
  - Staggered step reveal (0.15s delay per step)
  - Breathing glow on conductor core (6s cycle)
  - Orbital ring rotation (90s outer, 130s inner — counter-rotating)
  - Status pulse on processing nodes (2.5s cycle)
  - Flowing energy pathways (dasharray + pathLength animations)

### Solar Nexus SVG Visual States

| State | Colour | Effect |
|---|---|---|
| online | `#34d399` (jade) | Teal glow, steady |
| processing | `#fbbf24` (gold) | Gold pulse |
| heavy load | `#f97316` (orange) | Orange flare |
| offline | `#1e293b` (navy) | Dim, no glow |
| error | `#ef4444` (crimson) | Crimson pulse |

States are derived from telemetry thresholds (CPU >80% = heavy load, >50% = processing, status != "ok" = error).

---

## 5. Complete Setup Guide

### Quick Start

```bash
git clone https://github.com/Greggar/Mythic_AI_Observatory.git
cd Mythic_AI_Observatory
bash install.sh
```

The install script checks for available Ollama models and picks sensible defaults (see Model Selection below). Edit `backend/.env` if you want to override. Then start both servers with `bash restart.sh`.

### Prerequisites

- **Python 3.12+** and **pip3**
- **Node.js 22+** and **pnpm** (or npm with corepack)
- **Ollama** — install from [ollama.com](https://ollama.com) and pull at least one chat model:
  ```bash
  ollama pull qwen2.5:3b    # or any model that fits your hardware
  ```

### Model Selection

The `install.sh` script auto-detects installed Ollama models and picks sensible defaults:

| Role | Selection logic | Fallback |
|---|---|---|
| **Main model** (`OLLAMA_MODEL`) | First `qwen2.5` in 3–7B range, then any `qwen2.5`, then any available model | `qwen2.5:3b` |
| **Classifier** (`CLASSIFIER_MODEL`) | `qwen2.5:1.5b` if available, then smallest `qwen2.5` | `qwen2.5:1.5b` |
| **Embeddings** (`EMBEDDING_MODEL`) | `all-minilm:22m` if available | `all-minilm:22m` |

Edit `backend/.env` to override, or use the Settings → Models tab after launch.

### Start the Backend

```bash
cd ~/mythic-ai-observatory/backend
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

### Start the Frontend

```bash
cd ~/mythic-ai-observatory/frontend

# Development mode (hot-reload, avoids HTML caching issue — preferred for active dev):
NEXT_PUBLIC_API_URL=http://198.51.100.1:8001 pnpm dev

# Production mode (LAN access, stable — use for demos):
npx next build   # one-time build
npx next start -p 3001 -H 0.0.0.0
# → http://localhost:3001 or http://198.51.100.1:3001
```

**Dev vs prod:** Dev mode (`pnpm dev`) hot-reloads on file changes and avoids the stale-HTML caching problem. Prod mode (`next start`) serves pre-built files in memory — rebuilding `.next` while the server runs has no effect. Use dev for active development, prod for demos. See restart.sh for a combined start script.

**Important:** When accessing from a remote machine on the LAN, use production mode (`next start`). Dev mode's HMR WebSocket may fail across network boundaries. See §6.7 for details.

### Accessing Remotely

The Next.js server is bound to `0.0.0.0` via the `-H 0.0.0.0` flag. The backend FastAPI also binds to `0.0.0.0`. Both are accessible from any machine on the LAN.

---

### Custom Hook — `useOrchestrate` Polling Flow

```typescript
// Frontend polls trace state every 1.5s
const poll = async () => {
  const res = await fetch(`/api/traces/${trace_id}`);
  const data = await res.json();
  setTrace(data);
  if (data.status === "complete" || data.status === "error") {
    setLoading(false);    // stop polling
    return;
  }
  setTimeout(poll, 1500);
};
```

The hook tracks three states:
- `loading: true, trace: null` — submission in progress, waiting for POST response
- `loading: true, trace: TraceSession` — actively polling (stages appearing incrementally)
- `loading: false, trace: TraceSession` — completed, final trace displayed

### Stage Orbit — Visual States

The SVG ring visualization has three distinct visual modes:

| Phase | Core | Arcs | Nodes | Particles |
|---|---|---|---|---|
| Idle | STANDBY text, slow breathing glow | Dashed orbital ring, drifting dots | All dim | None |
| Replaying/Live | PROCESSING or COMPLETE, elapsed time | Green arcs between completed stages | Active node gold pulse + glow | Gold particles travel along active arc |
| Complete | COMPLETE, total duration, confidence | All arcs green | All nodes green | None |

### System Orbit — Service Satellite Glyphs

Each machine in `ResourceConstellation.tsx` has orbiting service glyphs defined in `SERVICE_GLYPHS`:

```typescript
const SERVICE_GLYPHS = {
  Primary Server: [
    { label: "API", color: "#2dd4bf" },
    { label: "Ollama", color: "#34d399" },
    { label: "OC", color: "#fbbf24" },
    { label: "UI", color: "#2dd4bf" },
    { label: "FastAPI", color: "#34d399" },
    { label: "Conductor", color: "#fbbf24" },
  ],
  Worker Node 1: [
    { label: "Hermes", color: "#2dd4bf" },
    { label: "ComfyUI", color: "#a78bfa" },
    { label: "qwen3.5", color: "#34d399" },
  ],
  // ...
};
```

When the `active` prop is true (live orchestration in progress), glyphs pulse via Framer Motion with staggered delays, providing a visual cue that the system is working.

---

## 6. Troubleshooting

### 6.1 Background Task Crashes Are Silent

Any unhandled exception inside `asyncio.create_task()` produces a `Task exception was never retrieved` warning but does not propagate to any caller or HTTP response. The trace is left frozen at the failing step. Debug by wrapping task bodies in `try/except` with explicit logging, or attach a done callback that checks `task.exception()`.

### 6.2 Variable Shadowing in Nested Loops

Reusing a loop variable name in a nested `for` loop overwrites the outer scope. In Python, `for i in ...` inside another `for i in ...` silently corrupts `i` after the inner loop exits — usually causing an `IndexError` on the next access. Always use distinct names (`stage_idx`, `chunk_idx`).

### 6.3 next start Caches Build Artifacts in Memory

The Next.js production server loads `.next/` into memory at startup and never refreshes it. Rebuilding while the server is running has no effect. Kill the server gracefully, delete `.next/`, rebuild, then restart.

### 6.4 Incomplete CSS After Interrupted Build

Killing Next.js mid-build corrupts CSS chunks. Symptom: white page with unstyled content. Fix: `rm -rf .next && npx next build && npx next start`.

### 6.5 WebSocket Fragility Across LAN

Routers and firewalls often kill WebSocket connections after the HTTP upgrade handshake. If a remote machine's frontend loads but live data doesn't flow, switch to HTTP polling (`fetch()` at 1.5s interval) — simpler and more robust for LAN deployments.

### 6.6 Model Won't Fit in VRAM

Check `nvidia-smi` before choosing a model size. A model that fits entirely in VRAM outperforms a larger model that spills to CPU, even if the smaller model has fewer parameters.

### 6.7 Hydration Mismatch from Floating-Point SVG

`Math.cos()`/`Math.sin()` produce slightly different values in Node.js vs browser V8 (~10^-15 difference). React's strict hydration comparison flags this. Always round computed SVG coordinates to 4+ decimal places with `.toFixed(4)`.

### 6.8 Guard Nested Fields in API Responses

A response object can be truthy while its nested fields are still undefined (e.g. `telemetry` exists but `telemetry.cpu` hasn't populated yet). Use optional chaining (`?.`) on every access path where the shape isn't guaranteed between page mount and first data arrival.

### 6.9 Environment Variables Must Be Inline

`export VAR=value` in one shell command is not inherited by a process started in another. Use `env VAR=value uvicorn ...` as a single command, or hardcode sensible defaults with `os.environ.get("VAR", "default")`.

### 6.10 Port 3001 EADDRINUSE With No Visible Process

Sometimes `ss`, `lsof`, and `fuser` show nothing on port 3001 but `next dev -p 3001` still gets `EADDRINUSE`. This is typically a stale Next.js process or a zombie `node` from an interrupted session. Fix: `kill $(pgrep -f "next-server")` or use a different port (`pnpm dev --port 3003`). Also check for orphaned `node` processes: `ps aux | grep node`.

### 6.11 Docker Model Runner Doesn't Serve Embeddings

Docker Model Runner (port 12434) supports chat and completion models but not the `/api/embeddings` endpoint. The DDC/LCC classifiers and memory retrieval all require embeddings. If your primary model runner is DMR, set `embeddings.url` in `network.json` (or via Settings → Models → Embedding Service URL) to point at a separate Ollama instance that has `all-minilm:22m` pulled. This can be on the same machine (if running Ollama in Docker alongside DMR) or a different machine on the network.

### 6.12 Restart Scripts Must Outlive the Shell That Launched Them

When a restart/daemon command is run through an agent tool (opencode, CI), the tool **kills the entire process group when its command times out or the shell exits** — so `uvicorn ... &` started inline dies the moment the tool returns. The fix is a dedicated script that fully detaches: `setsid nohup <cmd> >log 2>&1 & disown` (see `restart_backend.sh` and `tools/start_local_llm.sh`). Verify with `ss -ltn` on the port afterward, and confirm the backend actually restarted (not a zombie) by curling `/health`.

### 6.13 Ollama Does Not Expose Logprobs

Ollama's OpenAI-compat endpoint does not return per-token `logprobs`/`top_logprobs`, so no entropy can be captured through it (requests silently come back without the field). To get token-level uncertainty on a node, serve the model via llama.cpp-server (or vLLM/TGI/LM Studio), which returns `logprobs` + a `timings` block. This is why the `local_llm` node exists — the execution model is routed to it when it's up, and falls back to Ollama (entropy silently lost) only when it isn't.

---

## 7. Lessons Learned

### Architecture & Design

1. **Mock before integrate.** The mocked orchestration service allowed us to validate the full frontend/backend pipeline before committing to any LLM integration. This saved significant debugging time.

2. **HTTP polling over WebSocket for LAN deployment.** WebSocket connections are fragile across network boundaries — routers, firewalls, and proxies can kill the HTTP upgrade. HTTP polling (1.5s `fetch()`) is simpler, more robust, and the overhead is negligible at this interval.

3. **Framer Motion + SVG** works well for subtle, elegant animated visualisations. Keep cycle times slow (2.5s–130s) to avoid feeling "game-like." The `mounted` state pattern prevents hydration mismatches in Next.js.

4. **Always round SVG path coordinates** when computed from `Math.cos`/`Math.sin`. Floating-point precision differs between Node.js and browser V8, causing hydration mismatches at the 15th decimal place. Use `.toFixed(4)`.

5. **Tailwind v4's CSS-based theming** (`@theme inline`) is a departure from v3's `tailwind.config.js`. Custom colours are defined in `globals.css` using CSS custom properties. Future developers should be aware of this.

### OpenClaw Configuration

5. **Model selection matters.** The `openclaw.json` supports multiple models in an array under one provider. The first model in the list is the default. This is useful for fallback strategies.

6. **Telegram pairing** requires two steps: (a) giving the bot token, and (b) approving the Telegram user with `openclaw pairing approve telegram <code>`. The approval step is easy to miss.

7. **Systemd user services** are the correct way to manage OpenClaw persistently. The service unit is at `~/.config/systemd/user/openclaw-gateway.service`. Restart with `systemctl --user restart openclaw-gateway`.

### Prometheus

8. **Snap-based Prometheus** has its config at `/var/snap/prometheus/current/prometheus.yml` — NOT `/etc/prometheus/prometheus.yml`. This is easy to overlook.

9. **NEVER use `sed` for YAML.** The indentation-sensitive nature of YAML makes it extremely fragile with sed. Use `tee` with a heredoc or install `yq` for programmatic YAML editing.

10. **Prometheus was already running as a Snap** before we attempted to install it via apt. The apt version failed because port 9090 was already taken by the Snap version. Always check `snap list` and `docker ps` before installing new packages.

### Environment Variables

11. The frontend uses `NEXT_PUBLIC_WS_URL` and `NEXT_PUBLIC_API_URL` environment variables with sensible defaults (`ws://localhost:8001/ws/telemetry`, `http://localhost:8001`). These should be set to the server's LAN IP when accessing from remote machines.

### Living Orchestration

12. **Async background tasks for blocking endpoints.** Any endpoint that emits activity events must return immediately. Use `asyncio.create_task()` to run heavy work in the background and let the frontend poll for results. The synchronous POST pattern starves the event bus.

13. **Separate live state from replay state.** The `useTraceReplay` hook should not receive rapidly-mutating live data. Derive the active step index from the trace's step statuses during polling, and only trigger the replay animation for completed or historical traces.

14. **Environment vars must be set in the same command as the process.** `env VAR=value uvicorn ...` or hardcoded defaults are reliable. `export` in a separate shell invocation is not inherited by background processes.

15. **Small CPU-bound models are viable for orchestration.** A 3B model on a mid-range CPU takes ~40s per inference call (77s total trace), which is slow but acceptable for an observatory demo where the pacing makes the process visible. The ActivityFeed streaming live events during processing compensates for the wait time.

16. **Guard nested fields in API responses, not just the top-level object.** A response can be truthy while its nested fields are still undefined — e.g. `telemetry` exists but `telemetry.cpu` hasn't populated yet. Always use optional chaining (`?.`) on every access path where the shape isn't guaranteed between mount and first data arrival.

17. **Expose assembled context on each trace step for transparency.** Storing `context_assembled` on model-calling steps lets the UI show exactly what the model received — system prompt + accumulated context + user prompt — in a split-pane view. This turns the black-box LLM call into an inspectable artifact, which helps debugging prompt construction and context-window overflow. The token budget meter (`Math.round(text.length / 4)` vs context window) gives a visual indicator of headroom at a glance.

18. **Runtime-mutable globals enable hot-swapping without restart.** Using a module-level `_MODEL_PROVIDER` with accessor functions (`get/set_model_provider`) lets the operator switch between local and Worker Node 1 models via the SettingsModal without restarting uvicorn. The pattern works because the model resolution happens at call time (`_resolve_model_url()`) rather than at import time. The trade-off is thread safety — the global is not behind a lock, but for a single-async-thread FastAPI app this is not a concern.

19. **Background `asyncio.create_task` failures are silent by default.** A `NameError` inside a background task produces no log output or HTTP error — just a `Task exception was never retrieved` warning that's easy to miss. Always either: (a) attach a done callback that logs `task.exception()`, (b) wrap the entire task body in try/except with explicit logging, or (c) add a smoke test that runs the orchestration end-to-end before merging.

20. **TypeScript strict mode infers `Set<unknown>` from `Array.filter()` on `any[]`.** When chaining `.filter()` and `.map()` on the result of `fetch().json()` (typed `any`), the intermediate array is `any[]`, and `filter()` returns `unknown[]`. Explicitly type the parameter: `new Set<string>((data as HistoryEntry[]).filter(...).map(...))`. The error message (`Set<unknown>` not assignable to `Set<string>`) points to a misleading line — always check the call chain. (2026-06-04)

21. **`refreshTrigger` must be wired to actually fire.** The `historyRefresh` state was declared in `page.tsx` and passed to `MemoryConstellation` as `refreshTrigger`, but nothing ever incremented it. Until a `useEffect` watched for trace completion and called `setHistoryRefresh(n => n + 1)`, the constellation never re-fetched after a new trace finished. (2026-06-04)

22. **Server components cannot use `"use client"`.** The root `layout.tsx` exports `metadata` (a server-only feature). Adding `"use client"` silences the metadata export at build time. Client-side logic (event listeners, state, effects) must be extracted into a separate child component (e.g. `<ClientInit />`) imported by the server layout. (2026-06-06)

23. **SVG tooltips inside `overflow-hidden` parents get clipped.** A tooltip rendered as an SVG `<foreignObject>` or absolutely-positioned `<div>` inside a container with `overflow-hidden` (e.g. a bar chart wrapper) will be visually clipped at the parent's bounds. Fix: render the tooltip outside the container via React portal or fixed positioning from `getBoundingClientRect()`. (2026-06-06)

24. **`traceSteps.duration_ms` can be `null` for pending/failed steps.** When passing trace steps as props, TypeScript will enforce the `null` union. The component must filter with `.find(s => s.duration_ms != null)` before using the value in calculations. (2026-06-06)

25. **Ollama hides logprobs; llama.cpp-server exposes them.** If a metric needs per-token probabilities, an Ollama-backed node will silently return responses without the field — no error, no signal. Detect the absence explicitly and document it (as with the `MemoryEntropyPanel` empty state) rather than letting the panel look like a bug. (2026-08-03)

26. **Node-qualified identity prevents cross-machine merging.** Once two machines can serve the same-named model (e.g. `qwen2.5:3b` on primary and backoffice), unqualified `model_used` strings collapse distinct populations in `/api/traces/profile`. Prefixing with the owning machine (`primary/qwen2.5:3b`) keeps profiles and entropy honest. Qualify at the single assignment point (`session.model_used`) so it can't drift. (2026-08-03)

27. **Registry-driven routing beats a binary local/worker switch.** A hardcoded `if provider == "local"` check can't express "try this node, fall back to that one" or admit a new node without code changes. Resolving a model key to an ordered chain of `network.json` services means adding a node (llama.cpp, vLLM, …) is pure config. (2026-08-03)

## 8. Future Considerations

### High Priority

- **[Backend] Add proper error handling** for when Worker Node 1 is unreachable. Currently, failed HTTP polls silently return `"status": "error"` — the frontend should surface this more clearly.
- **[Frontend] Move telemetry and API URLs to environment variables.** Currently, `http://198.51.100.1:8001` is hardcoded in the build. Use `NEXT_PUBLIC_API_URL` for deploy-time configuration.

### Done ✓

- **[Backend] Streaming orchestration.** Implemented via async background task + polling pattern. POST returns trace_id immediately, frontend polls `/api/traces/{id}` every 1.5s. Activity events stream live during processing. (2026-06-03)
- **[Backend + Frontend] Context Assembly Breakdown.** Each trace step now stores `context_assembled` — the exact text sent to the model. The frontend `SolarNexus` shows a split-pane (system prompt / assembled context) on node click, with a token budget meter. (2026-06-04)
- **[Backend + Frontend] Model Provider Hot-Swap.** `GET/POST /api/config/model` endpoints added. `SettingsModal` has a "Models" tab with radio buttons for local/worker. No restart required. (2026-06-04)
- **[Backend] Fix `MODEL_PROVIDER` → `_MODEL_PROVIDER` typo.** The missing underscore caused a silent `NameError` that froze traces at Intent Classification indefinitely. (2026-06-04)
- **[Frontend] New-trace glow burst on MemoryConstellation.** When a new trace completes, `page.tsx` increments `historyRefresh`, triggering a re-fetch. The constellation detects which entries are new (by diffing IDs against the previous fetch) and animates them with an amber expanding ring (5s) + three quick amber pulses on the core dot. Colour is `#f59e0b` (solar gold) — complementary to the teal galaxy palette. (2026-06-04)
- **[Backend + Frontend] Trace Annotations & Collaborative Memory.** Users can add notes, tags, and ratings to any trace via the MemoryConstellation panel. Persisted server-side in `annotations.jsonl`. Annotation count shown in hover tooltip. Full CRUD supported. (2026-06-05)
- **[Backend + Frontend] Dynamic System Orbit services.** Service glyphs and metadata served from `GET /api/services` (reads `data/services.json`) instead of hardcoded frontend constants. Manual refresh button in the System Orbit header triggers re-fetch. (2026-06-05)
- **[Frontend] MemoryConstellation expand on interaction.** Panel smoothly enlarges (scale 1.3x) with opaque black overlay when hovering a dot or interacting; reverts on `onMouseLeave`. (2026-06-05)
- **[Backend] Telemetry detail field.** Remote polling returns `detail: "connection_refused" | "timeout" | "unreachable"` instead of generic error, allowing frontend to distinguish stopped services from actual failures. (2026-06-05)
- **[Frontend] Engine Status Panel → Runtime Metrics.** New panel with throughput (requests/time), average latency, error count with hover trace details, mini duration bar chart with gradient fill and hover tooltip showing trace ID/duration/status. (2026-06-05)
- **[Frontend] Stage descriptions in IntelligencePanel.** Human-readable explanations for all 7 orchestration stages shown below current stage label and on agent dot hover in `SolarNexus`. (2026-06-05)
- **[Frontend] Context Assembly display in IntelligencePanel + TimelineStep.** Collapsible `context_assembled` viewer with "Show assembled context" toggle in both IntelligencePanel and each TimelineStep. (2026-06-05)
- **[Frontend] Live trace overlay on latency panel (#19).** LatencyBreakdown accepts `traceSteps` prop from activeTrace; renders a brighter inner bar on each stage showing the current trace's duration vs the historical average. (2026-06-06)
- **[Tooling] Agentic Step-Level Latency Monitor (#18).** `tools/latency_monitor.py` — CLI with `--recent/--trace/--watch/--cache/--terminal` modes; polls backend, computes stage averages, renders stacked bar charts (matplotlib/ASCII). (2026-06-06)
- **[Frontend + Backend] LLM-generated performance insights.** `PerformanceInsights` panel with heuristic rules + LLM-generated insight cards. `_generate_llm_insights()` in orchestrator calls qwen2.5:3b with live architecture context from `network.json` and port-probed reachability. (2026-06-06)
- **[Frontend] IP masking toggle.** `mask_ips` checkbox in SettingsModal; frontend-only CSS-value swap on focus/blur — host inputs show `198.51.100.x` when masked, reveal on focus. (2026-06-06)
- **[Frontend] CelestialDistribution legend tooltips.** Hover on mean/median/mode shows statistical definition and right-skew implication for trace speed. (2026-06-06)
- **[Frontend] Frontend crash resilience.** `ClientInit.tsx` catches `unhandledrejection` + `error` at the window level; start command uses `NODE_OPTIONS='--max_old_space_size=4096'` and `setsid` for stable background detachment. (2026-06-06)
- **[Backend] Fix variable shadowing in orchestrator loop.** Inner loop `for i, chunk in enumerate(top_chunks)` shadowed outer `i`, causing IndexError that froze Memory Retrieval. (2026-06-09)
- **[Frontend] StageDebate component.** `StageDebate.tsx` — detects polar opposition between Context Assembly and Response Generation outputs using sentence-level polarity scoring + topic domain overlap. Non-conflicting shows collapsible "No stage conflicts"; conflicting shows glowing violet "Internal Debate" panel. Exports `detectContradiction()`. (2026-06-10)
- **[Frontend] TraceRadar component.** `TraceRadar.tsx` — SVG pentagon radar chart with 5 axes (Confidence, Context Relevance, Constraint Adherence, Output Substance, Honesty). Computed from trace step metadata. Always renders in IntelligencePanel completed state. (2026-06-10)
- **[Frontend] ForkInTheRoad decision tree.** `ForkInTheRoad.tsx` — decision tree visualization for intent classification. Chosen path highlighted in teal with branch line + confidence bar + reasoning; rejected paths dimmed at 50% opacity with strikethrough labels. Shows during processing state. (2026-06-10)
- **[Backend + Frontend] History tab blank crash fix.** Three bugs: (1) FastAPI route ordering — `/api/traces/profile` registered AFTER `/{trace_id}`, wildcard caught "profile" as trace ID; (2) `PersonalityProfile` called `.length` on `null` API response with no error boundary, unmounting entire React tree; (3) `next start` cached stale HTML from old build. (2026-06-10)
- **[Frontend] Duplicate React key fixes.** `MemoryConstellation` edge keys used source dot index instead of map index; `CelestialDistribution` dot keys used `entry.id` (duplicate trace IDs). Fixed with composite keys (`c-${ci}-${idx}`, `${id}-${di}`). (2026-06-10)
- **[Backend] Variable shadowing re-fix (vector graph code).** Second independent `for i in range(len(top_chunks))` in the vector-graph similarity computation was NOT caught by the original fix. Renamed to `vi`/`vj` to avoid shadowing outer stage index `i`. (2026-06-10)
- **[Backend] Intent classification prompt updated.** System prompt asks for `reasoning` per intent explaining why each path was chosen/rejected. (2026-06-10)
- **[Tooling] restart.sh.** `~/mythic-ai-observatory/restart.sh` — kills both servers, rebuilds frontend, starts backend with `--reload` and frontend with `pnpm dev`. (2026-06-10)
- **[Frontend] VectorDistanceGraph tooltip enhancement.** Replaced `useState` mouse tracking with `useRef` to avoid re-renders on every mouse move; richer tooltip content with color dot, trace ID, Used/Discarded status, relevance percentage. (2026-06-10)
- **[Frontend] Switched to `next dev` for development.** `next start` caches HTML in memory — rebuilding `.next` has no effect until server restart. Dev mode hot-reloads and avoids stale HTML. Use `pnpm dev` for active development, `next start` for demos. (2026-06-10)
- **[Backend + Frontend] Token-level uncertainty capture (entropy).** `_call_openai` requests top-5 logprobs on execution; `_compute_token_entropy()` stores mean/p95/surprisal/series on `TraceSession.token_entropy` + step-6 metadata. Frontend renders `UncertaintySparkline`, a Decisiveness fingerprint axis, and DualTimeline entropy cards. Entropy surfaces in `/api/traces/profile`. (2026-07)
- **[Backend + Frontend] Memory Grounding analysis panel.** `MemoryEntropyPanel` compares mean token entropy between traces whose chunks were used vs discarded vs absent; verdict always labeled anecdotal on small samples. Wired into RelationshipsPanel as a `memory` relationship type. (2026-08-03)
- **[Backend] Local llama.cpp execution node.** `local_llm` service (`127.0.0.1:12435`, protocol `openai`) serves the local `qwen2.5:3b` execution model with logprobs so the primary node captures entropy. `config_manager.get_local_llm_config()` + `get_service_node()`. (2026-08-03)
- **[Backend] Registry-driven model routing + node-qualified identity.** `_resolve_model_endpoint()` replaces the binary local/worker URL switch with ordered node chains from `network.json`; `session.model_used` is now `<node>/<model>` (e.g. `primary/qwen2.5:3b`). (2026-08-03)
- **[Tooling] `restart_backend.sh` + `tools/start_local_llm.sh`.** Detached daemon start scripts using `setsid nohup … & disown` so the backend / llama.cpp node survive the launching shell (agent tooling kills process groups on timeout). (2026-08-03)
- **[Frontend] Entropy trajectory chart.** `EntropyTrajectoryChart` renders the per-token entropy `series` as an SVG line+area in the "Response Generation" TimelineStep, with mean/p95 reference lines, an amber peak marker mapped to its output word, and a stats row. Replaces the `UncertaintySparkline` mini-sparkline. (2026-08-05)
- **[Frontend] Entropy ↔ classifier-confidence calibration.** `EntropyCalibrationPanel` (analysis `memory` → `calibration`) plots mean entropy vs DDC prompt/response margin, LCC prompt margin, and intent confidence with Pearson r per metric, CSV export, and a MIN_N=6 anecdotal gate whose verdict self-upgrades with corpus size. Real data (n=9) shows r≈0 — entropy and classifier confidence are independent so far. (2026-08-05)
- **[Backend + Frontend] Entropy-aware analysis prompts.** `_build_analysis_prompt` accepts an `entropy_summary` block (per-trace H/p95/n_tokens/high-entropy count, built client-side in RelationshipsPanel) and instructs the analysis model to treat high-entropy responses as uncertain generation and correlate them with relationship patterns — calibrated to sample size, silent about missing entropy data. (2026-08-05)
- **[Frontend] Research provenance layer.** `researchRefs.ts` registry (metric/panel → real citations with URL + relevance line) + `ResearchPopover` component (quiet ⓘ glyph, click-to-open portaled glass popover, outside-click/Esc close). Wired into EntropyTrajectoryChart (Kadavath 2022), EntropyCalibrationPanel (Guo 2017 + Kadavath), MemoryEntropyPanel (Lewis 2020). Truth-over-polish rule: no hallucinated citations. (2026-08-05)
- **[Frontend] Correction detector (Phase 18 #4 seed).** `frontend/src/utils/correctionDetector.ts` + `ChatMetrics` amber strip: flags human corrections of the model via weighted signals — `meta-language` (0.6, correction framing), `margin-collapse` (0.2, DDC prompt margin < 0.03), `self-ref-retrieval` (0.2, prior exchange retrieved as grounding). Threshold 0.6. Validated on the "Poetic No" chat: fires only on the true correction (EX2→EX3, score 1.0), 0 false positives across all 6 chats. Encodes a Phase 18 finding: corrections reuse the topic surface, so topic-distance surprise inverts for them — the tell is classifier margin collapse + retrieval re-feeding the disputed artifact. (2026-08-05)
- **[Frontend] Conversation topology (Phase 18 #2).** `ChatConversationTopology.tsx` draws the chat as an animated landscape in embedding topic-space: per-exchange all-minilm embeddings → all-pairs cosine distances → MDS projection, intent-colored nodes sized by token count, a comet that loops the EX0→…→EXn path (synced to session replay via a shared `progress` motion value), per-hop drift labels (`1 − cos`, teal/amber/pink by magnitude), and click-through to the shared analysis surface. MDS extracted to shared `utils/mds.ts` (deterministic seeded power iteration, convergent; `VectorDistanceGraph` refactored onto it). "Poetic No" sanity check: EX2↔EX3 are nearest neighbours (sim 0.482, drift 0.518 — correction stays grounded near the poem) while EX0 diverges (0.784/0.856). (2026-08-05)
- **[Backend] Branching factor 2^H (Phase 18 #1).** `_compute_token_entropy` now also emits `median_branching` (median of 2^H over all scored tokens — how many competing continuations were plausibly live at the median token; ~1.0 = near-deterministic, >2 = a real fork) and `branching_series` (2^H per downsampled token, aligned with `series`). `TokenEntropy` model + frontend type extended. (2026-08-05)
- **[Frontend] Branching-fan viz in EntropyTrajectoryChart.** The entropy chart now shows `2^H med` in the stats row and draws a teal stream-fan around the mean line whose half-width at token *i* grows with (2^H_i − 1), so the "single glowing stream" visibly splits at high-uncertainty tokens and collapses to a thread at deterministic ones. Hover tooltip reports the live-continuation count. Falls back to deriving 2^H from the entropy series for older traces. (2026-08-05)
- **[Backend] Reasoning fragility probe (Phase 14 #9, GSM-Symbolic method).** `services/reasoning_probe.py`: 5 parameterized word-problem templates (clips/fruit/train/pencils/baker) × base/symbolic/noop variants. Symbolic re-rolls names + numbers and recomputes the answer; noop appends an entity-neutral distractor-number clause (answer unchanged). Runner calls `_call_model` directly (model_name_override/provider_override) for output + token entropy, plus `classify_ddc` for prompt margin. Robust exactness scoring: answer-keyword regex, list-marker skip, and an exact-mention check so a correct answer buried in CoT but never restated on its own line still scores right (caught the real "computes 38, stops before the final line" failure on the symbolic-fruit cell). `POST /api/probe/reasoning` + `GET /api/probe/reasoning/{run_id}` + `.../summary` mirror the test-run store + semaphore pattern. (2026-08-05)
- **[Frontend] ReasoningProbePanel (Phase 14 #9 UI).** Tests-tab panel: model + template chips, live progress polling, per-model base/symbolic/noop accuracy cards with entropy / 2^H / DDC margin + fragility drops (symbolic−base, noop−base), expandable per-cell detail (prompt, response, expected vs parsed, signals). ResearchPopover `reasoning-fragility` cites Mirzadeh et al. (arXiv:2410.05229). (2026-08-05)
- **[Live finding] Chat grounding failure — mechanism corrected: content was never delivered, not ignored (chat `53f3b337`, 2026-08-06).** EX2 "write the lyrical narrative poem you suggested on the topic we were discussing" retrieved EX0's moons-of-Mars response at relevance **0.6179 (`used: true`)** but generated a generic shadow-cartography poem with no Mars. Root cause (code-read 2026-08-06): step-4 appended **only a similarity-score summary** to `context` — the chunk *texts* never reached the generator, and chat history was never loaded (each exchange orchestrated in isolation; `api_orchestrate` passes only `req.prompt`). "used" meant "counted in the summary", not "injected"; the "(N incorporated into context)" message was false. The #1 chunk (0.6466) was the previous exchange's own meta-commentary (self-reference pollution). EX3 only "bridged" because the correction message itself named the topic. DDC prompt margin arc: EX0 0.1108 → EX2 **0.0023** → EX3 0.0659. **Observation lesson:** `trace.memory_retrieval` is always `null` — retrieval lives in `steps[4].metadata.retrieved_chunks`. (2026-08-06)
- **[Backend] Memory + chat delivery fix (2026-08-06).** Step-4 now injects the used chunks' content into the generator's context as `[Memory Retrieval · rel x.xx]` lines (700-char cap), with `used` redefined at `MEMORY_USE_THRESHOLD=0.15` (top-ranked chunk always used) and a truthful summary line. Chat traces additionally carry prior exchanges into context as a `[Chat History]` block (newest-first within `CHAT_HISTORY_CHARS=2500` / `CHAT_HISTORY_EXCHANGES=20` budgets — the DMR clamps to `context_window 4096`). Verified live: an elliptical "poem on that topic now" after a topic-setting exchange produced a Prometheus-grounded poem ("The Titan's Flame"), where pre-fix it produced an unrelated "Celestial Weave". Open: retrieval-rank hygiene (cross-chat poems still outranked the topic chunk — rescued only by the history block). (2026-08-06)
- **[Tool] Backoffice freeze watcher (2026-08-06).** `tools/backoffice_watch.py` samples the backoffice GPU util/mem + load1/5 + mem avail from Prometheus (prom URL via `PROMETHEUS_URL` env) and the worker DMR `/v1/models` latency every 2 s → CSV. Used during the fix verification: DMR stayed responsive (15–32 ms) with load1 ≤ 0.5 across both generations — the earlier "freeze" (49.7 s poem, 20 s probe silence) was a single-slot queue stall, not a hang. **Gotcha:** the backoffice `gpu_usage_percent` reads 0% *during active generation* (≈50 tok/s on the 9B Q4 model proves the GPU is used) — the exporter does not capture the Docker/WSL GPU device, so GPU% is an unreliable freeze signal; use DMR latency + load instead. (2026-08-06)

### Medium Priority

- **[Backend] Wrap all fallible calls in post-complete section in try/except.** The `_embed()` call at line 656 was unprotected, causing embeddings to never persist if it failed. (2026-06-09)
- **[Backend] JSONL deduplication.** `_persist()` appends the full session on every call, so a single trace can generate 3-5 identical lines in `traces.jsonl`. This inflates `load_history(limit=20)` with duplicate entries, skewing Memory Retrieval similarity search. Consider overwriting the last entry for a given trace ID instead of always appending, or deduplicate on load.
- **[Backend] Post-complete section is slow.** The section makes 3 sequential LLM inference calls (insights, rationale, explanation) using qwen2.5:3b on CPU, each taking 30-60s. Embeddings and final persistance are blocked until all three finish. Consider parallelizing with `asyncio.gather()` or running them as separate fire-and-forget tasks.

- **[Frontend + Backend] Investigate WebSocket-killing network issue.** The router/firewall between the server and Worker Node 1 drops WebSocket connections after HTTP upgrade. Identifying the exact device and rule would allow re-enabling WebSocket for lower-latency telemetry.
- **[Frontend] Use shared telemetry/API base URL.** Currently `useWebSocket` and `useOrchestrate` have independent URL configuration. Unify behind a single config object.

### Low Priority

- **[Backend] Database persistence.** The in-memory `_store` dict survives only as long as the process. Swap it for SQLite (via SQLAlchemy or aiosqlite) for restart-persistent trace storage.
- **[Frontend] Theme persistence.** Save the user's panel layout preferences (collapsed/expanded) in `localStorage`.
- **[Frontend] Dark/light mode.** The UI currently only has a dark theme. A light variant could be useful for daytime use.
- **[Monitoring] Grafana dashboard.** Prometheus is running (when fixed). Adding Grafana pointing at both Prometheus and the Conductor API's `/metrics` would give a second observability layer.
- **[Monitoring] Node Exporter dashboard.** The node-exporter at `:9100` provides rich hardware metrics (`node_cpu_seconds_total`, `node_memory_MemAvailable_bytes`, etc.) that could feed a richer telemetry view.
- **[OpenClaw] Telegram auto-restart.** If the OpenClaw systemd service restarts, the Telegram connection drops and the bot needs time to reconnect. This is handled automatically by the service's `Restart=always` directive.

### Security

- **The CORS middleware currently allows all origins.** In production, restrict to specific frontend URLs.
- **The Prometheus snap binds to `0.0.0.0:9090`** with no authentication. Consider adding a reverse proxy with basic auth if exposing beyond the LAN.
- **OpenClaw's gateway token** is stored in plaintext in `openclaw.json`. Ensure this file has restricted permissions (`chmod 600`).

---

## 9. Version Control

The project lives at **https://github.com/Greggar/Mythic_AI_Observatory**

### Workflow

```bash
# Status
git status

# Stage changes
git add -A

# Commit
git commit -m "description of change"

# Push to GitHub
git push
```

### What's tracked vs ignored

**.gitignore** excludes:
- `node_modules/`, `.next/` — can be rebuilt from `package.json`
- `.venv/` — Python virtual environment, not portable
- `backend/data/traces.jsonl` — runtime operational data (trace history)
- `.env` files — API keys and secrets

Everything else (code, config, `machines.json`, docs) is tracked.

### Adding a machine (no code changes)

1. Add node-exporter on the new PC
2. Add it to Prometheus scrape config
3. Optionally add a `hostnames` entry in `backend/data/machines.json` for a friendly name and insight
4. Done — the backend auto-discovers instances via Prometheus at each `/api/vitals` call

### First-time setup on a new machine

```bash
git clone https://github.com/Greggar/Mythic_AI_Observatory.git
cd Mythic_AI_Observatory
bash install.sh
```

Then edit `backend/.env` and `frontend/.env.local` to match your network, and run `bash restart.sh` to start both servers.

See the [README](README.md) for more detailed instructions.

---

## 10. File Index

| Path | Purpose |
|---|---|---|
| `backend/main.py` | FastAPI app, telemetry loop, WebSocket, REST endpoints; async orchestration with background tasks |
| `backend/models/trace.py` | Pydantic models for trace steps and sessions |
| `backend/models/annotation.py` | Pydantic model for Annotation (content, tags, rating, author) |
| `backend/services/orchestrator.py` | 7-stage orchestration pipeline with activity event bus, async background task support |
| `backend/services/annotation_service.py` | Annotation CRUD with jsonl persistence (annotations.jsonl) |
| `backend/services/config_manager.py` | Network config persistence (machines.json) for dynamic endpoint resolution |
| `frontend/package.json` | Dependencies and scripts (`dev` on port 3001) |
| `frontend/src/app/globals.css` | Tailwind v4 theme with custom colours + glassmorphism |
| `frontend/src/app/layout.tsx` | Root layout with Geist fonts |
| `frontend/src/app/page.tsx` | Tabbed dashboard: Systems tab (vitals, runtime metrics, system orbit, activity feed) and Traces tab (intelligence, nexus, prompt, timeline, memory constellation); tab bar with active state; increments `historyRefresh` on trace completion |
| `frontend/src/components/PromptInput.tsx` | Textarea with submit, Cmd+Enter, loading state |
| `frontend/src/components/TraceTimeline.tsx` | Full timeline: steps + resolution output |
| `frontend/src/components/TimelineStep.tsx` | Single step row with status icon, duration |
| `frontend/src/components/ObservatoryPanel.tsx` | Animated container for trace output |
| `frontend/src/components/SystemVitals.tsx` | CPU/Memory/GPU gauge bars |
| `frontend/src/components/SolarNexus.tsx` | Stage Orbit — animated SVG ring with 7 pipeline stages, energy particles, live step tracking; clickable nodes show ContextPane (split-pane prompt/context) + TokenMeter |
| `frontend/src/components/SettingsModal.tsx` | Network config editor for backend/remote endpoint URLs + Models tab for runtime provider hot-swap |
| `frontend/src/components/ResourceConstellation.tsx` | System Orbit — solar system viz with machines as planets, orbiting service glyphs that pulse on activity |
| `frontend/src/components/IntelligencePanel.tsx` | Confidence ring, duration, model, token estimate, resource impact attribution; stage descriptions for each of the 7 orchestration stages; collapsible `context_assembled` viewer with toggle; wires ForkInTheRoad, StageDebate, TraceRadar, ThoughtStream, ChunkDisplay, CausalTracing |
| `frontend/src/components/EngineStatusPanel.tsx` | Runtime Metrics dashboard: throughput (req/s), avg latency, error count with hover details; mini duration bar chart with gradient fill showing recent trace durations; hover any bar to see trace ID, duration, and status |
| `frontend/src/components/ActivityFeed.tsx` | Real-time event stream from backend activity bus (polls every 2s) |
| `frontend/src/components/MemoryConstellation.tsx` | History browser — spiral galaxy SVG: past traces as orbiting dots clustered semantically along a spiral arm with orbital drift, connection filaments, theme labels outside rotation; new traces get an amber expanding glow burst (5s) + flashing core; click any dot to replay that trace in the timeline; on hover/click the panel zooms (scale 1.3x) with opaque overlay; per-trace "Show assembled context" toggle reveals `context_assembled` in tooltip |
| `frontend/src/components/DiscoveryEvents.tsx` | Toast overlay for discovery events on orchestration completion |
| `frontend/src/components/SettingsModal.tsx` | Network config editor for backend/remote endpoint URLs |
| `frontend/src/components/ForkInTheRoad.tsx` | Decision tree visualization for intent classification — chosen path highlighted in teal, rejected paths dimmed with strikethrough, reasoning shown per branch |
| `frontend/src/components/StageDebate.tsx` | Contradiction detection between Context Assembly and Response Generation — sentence-level polarity scoring + topic domain overlap; violet "Internal Debate" UI |
| `frontend/src/components/TraceRadar.tsx` | SVG heptagon radar chart with 7 axes (Confidence, Context, Transparency, Constraint Adherence, Conflict Avoidance, Data Constraints, Output Substance). Supports multi-trace comparative overlay with per-trace color palette and fingerprint summary bar. |
| `frontend/src/components/ComparativeRadarPanel.tsx` | History-tab panel showing full comparative radar with trace list, fingerprint summary, expandable prompt/output details. Opened via multi-select in MemoryConstellation "Compare N" button. |
| `frontend/src/components/VectorDistanceGraph.tsx` | MDS-2D cosine-similarity cluster map for Memory Retrieval chunks with SVG scatter plot + hover tooltips |
| `frontend/src/components/PersonalityProfile.tsx` | Per-model profiling — count, latency avg/p50/p95/p99, tokens, failure rate, confidence, per-stage averages in collapsible cards |
| `frontend/src/components/LatencyBreakdown.tsx` | Per-stage colored progress bars with historical averages and live trace overlay |
| `frontend/src/components/PerformanceInsights.tsx` | LLM-generated insight cards for trace performance analysis |
| `frontend/src/components/CelestialDistribution.tsx` | Statistical distribution chart (mean/median/mode) with legend tooltips |
| `frontend/src/components/SunburstChart.tsx` | 2/3-level radial treemap for DDC, LCC, and Multi-Label classification — d3.arc() wedges, portaled tooltip, click-to-highlight, CSV export, keyword-clusters placeholder |
| `frontend/src/components/SynthesisBridge.tsx` | Sentence-level highlighted output linking final response text to retrieved chunks via word-overlap similarity. Colored underlines show influence source; hover tooltip reveals chunk content, relevance, and used/discarded status. Wired in IntelligencePanel completed state after Memory Retrieval section. |
| `frontend/src/components/charts/DualTimeline.tsx` | Synchronized side-by-side cards for 7 orchestration stages (+ overall) pairing Objective Trace (system metrics) with LLM Self-Rationale (model reasoning). Includes **ghost references**: sentence-level detection of data references within rationale text — hover a sentence to highlight the matching objective card, and vice versa. Wired in IntelligencePanel completed state. |
| `frontend/src/hooks/useWebSocket.ts` | WebSocket hook with auto-reconnect (currently HTTP polling) |
| `frontend/src/hooks/useOrchestrate.ts` | Orchestration hook — async POST returns trace_id, polls for incremental updates every 1.5s |
| `frontend/src/hooks/useTraceReplay.ts` | Step-by-step animation hook for historical trace replay |
| `frontend/src/types/trace.ts` | TypeScript types mirroring backend Pydantic models — includes `context_assembled` on TraceStep |
| `backend/services/ddc_embeddings.py` | DDC classifier — 55 categories via all-minilm cosine similarity, 0.10 threshold, `classify_ddc()` + `classify_multi()` |
| `backend/services/lcc_embeddings.py` | LCC classifier — 70+ subclasses via all-minilm, single-letter main classes removed, `classify_lcc()` + `classify_multi()` |
| `backend/models/trace.py` | Pydantic models including `DdcEntry`, `DdcMetadata`, `LccEntry`, `LccMetadata` with alternatives fields |
| `backend/data/network.json` | Persistent network config (machines, remotes, endpoints) |
| `backend/data/services.json` | Service definitions (glyph layout, name, description) served via `GET /api/services` |
| `backend/services/classifier_agent.py` | Background agent: polls every 45s, classifies unprocessed traces via LLM against `synesthesia_schema.md`, stores results in `synesth_cache.json` |
| `backend/services/synesthesia_schema.md` | Plain-language classification schema (5 input + 5 output categories) for Cognitive Synesthesia — edit this to change classification behavior without code |
| `tools/backfill_synesth.py` | One-shot backfill script using Worker Node 1 GPU (`qwen2.5:7b`) to classify all existing traces into `synesth_cache.json` |
| `DEVELOPMENT.md` | Quick-start guide for local dev |
| `LVM-ROOT-EXPAND.md` | Instructions for expanding the root LVM volume |
| `Innovation.md` | Ideas log for practical experiments with the local 3B model |
| `~/.openclaw/openclaw.json` | OpenClaw configuration (models, channels, skills) |
| `~/.config/systemd/user/openclaw-gateway.service` | Systemd user service for OpenClaw |
| `/var/snap/prometheus/current/prometheus.yml` | Prometheus Snap config (currently broken) |

---

*Generated 2026-06-19. Update this document when making architectural changes.*
