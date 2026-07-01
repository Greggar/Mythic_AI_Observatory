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
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────────────┐ │
│  │  Ollama   │  │ OpenClaw │  │ FastAPI  │  │   Next.js 16    │ │
│  │ :11434    │  │ :18789   │  │ :8001    │  │   :3001         │ │
│  │ (local)   │  │(systemd) │  │ (uvicorn)│  │   (pnpm dev)    │ │
│  └──────────┘  └──────────┘  └──────────┘  └─────────────────┘ │
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
| OpenClaw Gateway | 18789 | 0.0.0.0 | Running (systemd user service) |
| FastAPI Conductor | 8001 | 0.0.0.0 | Manual start |
| Next.js Solar Interface | 3001 | 0.0.0.0 | Manual start (next start — production mode) |
| Docker Model Runner | 12434 | (backoffice) | Running |
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

### 3.5 Model Provider Selection

Controlled by `ORCHESTRATOR_MODEL` env var (default: `local`), and also **hot-swappable at runtime** via `set_model_provider("local"|"backoffice")`.

| Value | Base URL | Model | Suitable for |
|---|---|---|---|
| `local` | `http://127.0.0.1:11434` (Ollama) | `qwen2.5:3b` | CPU inference on primary server (moderate quality, slow) |
| `backoffice` | `http://198.51.100.100:12434` (Docker Model Runner) | `qwen2.5:7b` | GPU inference on Worker Node 1 (high quality, fast) |

When `local`, the payload adds `"options": {"num_ctx": 4096}` to stay within the 3B model's context window. When `backoffice`, the context limit is handled by the remote server.

**Runtime hot-swap** — implemented as a mutable module-level global `_MODEL_PROVIDER` with `get_model_provider()` / `set_model_provider()` accessors. Two REST endpoints expose this:

- `GET /api/config/model` — returns `{"provider": "local"|"backoffice"}`
- `POST /api/config/model` — accepts `{"provider": "local"|"backoffice"}`, switches on the fly, returns 400 on invalid value

No restart or reload needed — the next `_call_model()` invocation reads the current provider. This lets the frontend SettingsModal switch models without a server restart.

---

## 4. Frontend Architecture

### Component Tree

```
layout.tsx          — Root layout, Geist fonts, dark background
  page.tsx          — Tabbed dashboard: Systems / Trace / History tabs + settings

  │   [Systems Tab]                    [Trace Tab]
  │   ─────────────                    ──────────
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
  │                                    ├── SolarNexus
  │                                    │   └── ContextPane
  │                                    ├── PromptInput
  │                                    ├── ObservatoryPanel
  │                                    │   └── TraceTimeline
  │                                    │       └── TimelineStep
  │                                    └── VectorDistanceGraph (MDS-2D)
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

### Prerequisites (already installed)

```
Node.js  v22.22.2
pnpm     v10.33.2
Python   3.12.3
OpenClaw 2026.5.20
```

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

## 6. Troubleshooting Log

### 6.1 Prometheus Config Corruption

**Symptom:** `snap services prometheus` shows `inactive`. Service failed with `bind: address already in use` on first start, then after manual intervention would not restart.

**Root cause:** The initial `sed` command used `\n` inside the replacement string, which was not interpreted as a newline by sed, producing broken YAML:

```yaml
# Before (broken):
scrape_configs:
 - job_name: "node"
  static_configs:
 - targets: ["localhost:9100"]

# After (correct):
scrape_configs:
  - job_name: "node"
    static_configs:
      - targets: ["localhost:9100"]
  - job_name: "prometheus"
    static_configs:
      - targets: ["localhost:9090"]
```

**Fix:** Overwrite the entire file using `tee` with a heredoc or `printf` instead of `sed`.

**Lesson:** Never use `sed` with embedded `\n` for multi-line YAML replacements. Always use `tee` with a heredoc or a proper YAML tool like `yq`.

### 6.2 Small Model Produced Gibberish (Telegram Bot)

**Symptom:** Sending "hi" to the Telegram bot returned a wall of text about subAgents tool calls.

**Root cause:** OpenClaw was configured with `qwen2.5:1.5b`, a 1.5B parameter model that is too small for coherent conversation. It hallucinated system prompt instructions.

**Resolution:** Upgraded to `qwen2.5:3b` (still CPU-bound on this machine), then ultimately switched to using Worker Node 1 with 16GB VRAM running Docker Model Runner with `qwen2.5:7b` and `qwen2.5:7b`.

**Lesson:** Models below 3B parameters are not suitable for conversational AI. For a Telegram bot, use at minimum a 7B parameter model or delegate to a GPU-equipped machine.

### 6.3 3B Model Too Slow on Local CPU

**Symptom:** The 3B model was extremely slow despite the machine having a capable CPU (i7-6700, 8 threads, 15GB RAM).

**Root cause:** The machine has a GTX 960 with 2GB VRAM. The 3B model is 1.9GB — almost the entire VRAM — leaving no room for KV cache. Ollama likely attempted partial GPU offloading, causing PCIe transfer bottlenecks worse than pure CPU. The 1.5B model (986MB) fit in VRAM and ran faster on GPU despite being smaller.

**Lesson:** Having a GPU doesn't help if the model doesn't fit in VRAM. A model that fits entirely in VRAM will outperform a larger model that spills to CPU. Check `nvidia-smi` VRAM before choosing a model size.

### 6.4 Context Overflow with Telegram Bot

**Symptom:** `Context overflow: prompt too large for the model (22917 tokens exceeds 4096)`

**Root cause:** The `qwen2.5:7b` model on Worker Node 1 has only 4096 context tokens. The Telegram conversation history accumulated beyond this limit.

**Fix:** Add `reasoning: false` to model config (already set), and use `/reset` or `/new` to clear sessions. The auto-compaction feature attempted recovery.

**Lesson:** Always check the `context_window` of a model before deploying. 4K context is very small — look for models with 8K, 32K, or 128K context windows for interactive use.

### 6.5 Next.js Dev Server Not Reachable on LAN

**Symptom:** Site worked at `http://localhost:3000` on the server but not at `http://198.51.100.1:3000` from another PC.

**Root cause:** Next.js dev server defaults to binding on `127.0.0.1` only. The `-H 0.0.0.0` flag is required to accept connections from the network.

**Fix:** Changed `dev` script in `package.json` from `next dev` to `next dev -p 3001 -H 0.0.0.0` (also changed port to 3001 due to RocketChat conflict).

**Lesson:** Always add `-H 0.0.0.0` to Next.js dev in multi-machine dev environments. Consider switching to `next start` (production mode) for persistent LAN access.

### 6.6 Port Clash with RocketChat

**Symptom:** Port 3000 was already in use by RocketChat.

**Fix:** Mapped Next.js to port 3001 via `-p 3001`.

### 6.7 WebSocket Connections Fail from Remote LAN Machines

**Symptom:** The frontend works perfectly at `http://localhost:3001` on the server but shows "no connection" at `http://198.51.100.1:3001` from another LAN machine (Worker Node 1). The Next.js dev server page loads fine, but the telemetry WebSocket won't connect.

**Browser console errors:**
```
web-socket.ts:50 WebSocket connection to
'ws://198.51.100.1:3001/_next/webpack-hmr?id=...' failed
```

**Diagnosis process:**
1. Verified the backend FastAPI server listens on `0.0.0.0:8001` (all interfaces) — correct.
2. Tested WebSocket connectivity via Python `websockets` library FROM the server itself — connected fine, received telemetry messages.
3. Tested with explicit `Origin` headers to simulate browser cross-origin requests — still worked.
4. Checked the backend access log and found WebSocket connections FROM Worker Node 1 (`198.51.100.100`) were being *accepted* but then *closed* shortly after (`connection closed` appears within 1–2 log lines of `connection open`).
5. Tested with regular HTTP `fetch()` to port 8001 — this worked reliably, confirming the backend is reachable.
6. Checked browser DevTools → Network tab — saw only Next.js HMR WebSocket failures; our app's WebSocket never appeared, meaning the JavaScript runtime was crashing before our hook even executed.

**Root cause:**

The **network path between the server and Worker Node 1** kills WebSocket connections after the HTTP upgrade handshake. This is likely due to a router or firewall feature (e.g., deep packet inspection, connection tracking timeout, or a proxy that handles HTTP but not WebSocket upgrades). Two separate WebSocket channels were affected:

- **Next.js HMR WebSocket** (port 3001, `/_next/webpack-hmr`): Next.js dev mode uses this for hot module replacement. When this WebSocket repeatedly fails, the Next.js dev runtime can crash or fail to hydrate the React component tree, preventing our code from mounting at all.
- **Our app WebSocket** (port 8001, `/ws/telemetry`): Even when the React app did mount, the telemetry WebSocket would connect briefly then drop.

**Why `localhost` worked:** When accessing the server itself (either from the server's own browser or via `localhost`), both WebSocket connections stayed within the same machine — no router/firewall in the path.

**Fix — two changes:**

**1. Switch from dev mode to production mode** (eliminates HMR WebSocket):
```bash
# Instead of:
pnpm dev

# Use:
npx next build        # one-time build
npx next start -p 3001 -H 0.0.0.0   # production server, no HMR
```
Production `next start` serves pre-built static files. There is no HMR WebSocket, no dev overlay, and no hot-reloading infrastructure — just plain HTTP. The React app mounts normally because nothing tries to open a dev-time WebSocket.

**2. Replace WebSocket with HTTP polling** (eliminates app WebSocket):
The `useWebSocket` hook was rewritten to poll `GET /api/telemetry` via `fetch()` every 1.5 seconds instead of connecting to `ws://.../ws/telemetry`. This bypasses the WebSocket-killing network entirely:

```typescript
// Before (useWebSocket):
const ws = new WebSocket("ws://198.51.100.1:8001/ws/telemetry");
ws.onmessage = (event) => setData(JSON.parse(event.data));

// After (useWebSocket — HTTP polling):
const res = await fetch("http://198.51.100.1:8001/api/telemetry");
const json = await res.json();
setData(json);
```

A `GET /api/telemetry` endpoint was added to the backend that returns the latest collected telemetry snapshot (previously only broadcast via WebSocket).

**Lesson for future devs:**
- Next.js dev mode (`pnpm dev`) is for local development only. For LAN access, always use production mode: `next build && next start`.
- WebSocket connections traversing network boundaries are fragile. If a WebSocket fails to stay open from remote machines, the problem is likely a router/firewall killing the connection after the HTTP upgrade, not a code issue.
- When WebSocket is unreliable, HTTP polling is a robust fallback. For a 1.5s polling interval, the overhead is negligible.

### 6.8 Orchestration POST Blocks Activity Feed

**Symptom:** Activity feed showed no events until the full trace completed, even though the backend emitted events during processing.

**Root cause:** The original `POST /api/orchestrate` handler awaited the full `orchestrate()` coroutine before returning. Although `emit_event()` was called during processing, the HTTP response wasn't sent until all 7 stages finished, so the frontend's polling of `/api/activity` received no new data.

**Fix:** Split into two steps:
1. `POST /api/orchestrate` creates the trace in `_store` and launches `asyncio.create_task(orchestrate(...))`, returning `trace_id` immediately.
2. Frontend polls `GET /api/traces/{trace_id}` every 1.5s for incremental updates.

```python
# Before (synchronous):
@app.post("/api/orchestrate")
async def api_orchestrate(req):
    return await orchestrate(req.prompt)

# After (async task):
@app.post("/api/orchestrate")
async def api_orchestrate(req):
    session = TraceSession(id=uuid.uuid4().hex[:12], prompt=req.prompt)
    _store[session.id] = session
    asyncio.create_task(orchestrate(req.prompt, session.id))
    return {"trace_id": session.id, "status": "started"}
```

**Lesson:** Any endpoint that emits events consumed by a polling frontend must return immediately. Blocking until background work completes starves the event bus of visibility.

### 6.9 useTraceReplay Conflicts with Live Polling

**Symptom:** During live polling, `useTraceReplay` would restart its animation sequence every time the trace updated (every 1.5s), causing visual flickering as steps reset.

**Root cause:** `useTraceReplay` was called unconditionally with the live trace. Each polling update triggered a new trace reference, which the hook interpreted as a new replay session.

**Fix:** Separate the live step index (derived directly from `trace.steps` during polling) from the replay index (used only for history traces and completed live traces):

```typescript
// During live processing: derive step index from trace status
const liveStepIndex = loading && trace !== null
  ? trace.steps.findLastIndex((s) => s.status !== "pending")
  : null;

// Replay only triggers for completed or history traces
const triggerReplay = (replayTrace || (liveComplete && trace)) ? (replayTrace || trace) : null;
const { activeStepIndex: replayStep, phase: replayPhase } = useTraceReplay(triggerReplay);
```

**Lesson:** Don't feed rapidly-mutating data into replay/timeline hooks. Distinguish between live incremental state and post-hoc animation.

### 6.10 Environment Variable Not Inherited by Background Processes

**Symptom:** `ORCHESTRATOR_MODEL=local` had no effect — the backend still used the backoffice URL.

**Root cause:** When starting uvicorn via `nohup ... &` or a shell wrapper script, the environment variable was set in the parent shell but not inherited by the child process due to shell scoping rules. Multiple failed attempts included `export` in one bash invocation and the actual command in another.

**Fix:** Use `env ORCHESTRATOR_MODEL=local uvicorn ...` as a single command, or hardcode the default in the Python source:

```python
# orchestrator.py — environment with hardcoded fallback
MODEL_PROVIDER = os.environ.get("ORCHESTRATOR_MODEL", "local").lower()
```

The default was changed from `backoffice` to `local` to make the local-only experience work out of the box.

**Lesson:** Shell environment variables do not persist across separate `bash` tool calls. Always set the env var in the same command that launches the process, or hardcode sensible defaults.

### 6.11 Hydration Mismatch Due to Floating-Point Precision in SVG

**Symptom:** React hydration warning about mismatched attributes. The error pointed to `<path d="...">` in `OrchestrationRing.tsx:80`:

```
A tree hydrated but some attributes of the server rendered HTML
didn't match the client properties.
```

The diff showed a tiny difference in the 15th decimal place of SVG path coordinates:
```
+ d="M 203.81337886407522 ..."
- d="M 203.81337886407525 ..."
```

**Root cause:** `Math.cos()` and `Math.sin()` produce slightly different floating-point values in Node.js (server-side render) vs the browser's V8 engine. The difference is at the ~10^-15 level, but React's hydration comparison is strict — any difference, even in the 15th decimal place, triggers a mismatch.

**Fix:** Round all SVG path coordinates to 4 decimal places using `.toFixed(4)`:

```tsx
// Before:
d={`M ${x1} ${y1} Q ${CX} ${CY} ${x2} ${y2}`}

// After:
d={`M ${x1.toFixed(4)} ${y1.toFixed(4)} Q ${CX.toFixed(4)}
   ${CY.toFixed(4)} ${x2.toFixed(4)} ${y2.toFixed(4)}`}
```

**Files fixed:**
- `OrchestrationRing.tsx` — knotwork outer arc path
- `SolarCore.tsx` — solar-knot inner geometry path

**Lesson:** Any SVG `d` attribute built from floating-point arithmetic (`Math.cos`, `Math.sin`, `Math.random`, division) is at risk of hydration mismatch. Always round to a fixed precision (4–6 decimals) when embedding computed coordinates in JSX.

### 6.12 Telemetry.cpu Undefined Before First Poll

**Symptom:** Browser console error — `Cannot read properties of undefined (reading 'percent')` at `SolarNexus.tsx:81`.

**Root cause:** The `conductorState` derivation checked `!telemetry` (the whole object) but not `telemetry.cpu`. During the brief window between page mount and the first successful telemetry poll (1.5s), `telemetry` was an empty/partial object — the backend hadn't returned CPU data yet. The guard `!telemetry ? "offline"` passed because the object was truthy, then `telemetry.cpu.percent` crashed because `cpu` was undefined.

```typescript
// Before (crashes if telemetry exists but cpu hasn't populated):
const conductorState = !telemetry ? "offline"
    : telemetry.cpu.percent > 80 ? "busy"
    : ...

// After (safe — checks for cpu sub-object):
const conductorState = !telemetry?.cpu ? "offline"
    : telemetry.cpu.percent > 80 ? "busy"
    : ...
```

**Fix:** Replaced `!telemetry` with `!telemetry?.cpu` using optional chaining. If `cpu` is undefined, the expression short-circuits to `"offline"` without accessing `.percent`.

**Lesson:** When deriving state from an API response object, always guard against partially-populated data — not just the top-level null/undefined check. A response object can exist without all its nested fields being populated, especially during the first polling cycle. Use optional chaining (`?.`) on every nested access path where the shape is not guaranteed.

### 6.13 Undefined Variable Crashes Orchestration Silently

**Symptom:** Submitting a prompt via the dashboard returned immediately with `trace_id`, but the trace never progressed past "Intent Classification" (step 2). The frontend polled `/api/traces/{id}` every 1.5s but step 2 remained stuck at "processing" indefinitely. No error appeared in the backend logs beyond the initial POST.

**Root cause:** A typo in `orchestrator.py:_call_model()` at line 74:

```python
# Before (broken — MODEL_PROVIDER is undefined):
if MODEL_PROVIDER == "local":
    payload["options"] = {"num_ctx": 4096}
```

The module-level variable is `_MODEL_PROVIDER` (with underscore prefix). The bare `MODEL_PROVIDER` raised a `NameError` *outside* the `try/except` block in `_call_model()`, causing the entire `asyncio.create_task(orchestrate(...))` to crash silently. The trace in `_store` was left with step 2 in "processing" status — the exception handler in `orchestrate()` never ran because the error occurred at the callee level.

**Why it was silent:**
- `asyncio.create_task` wraps the coroutine in a Task; unhandled exceptions in the task are logged as `Task exception was never retrieved` but do **not** propagate to any caller.
- The `POST /api/orchestrate` handler had already returned `{"trace_id": "..."}` before the task started, so the HTTP response was fine.
- No middleware or global exception handler caught background task failures.

**Fix:** Changed `MODEL_PROVIDER` to `_MODEL_PROVIDER` on line 74:

```python
# After (correct):
if _MODEL_PROVIDER == "local":
    payload["options"] = {"num_ctx": 4096}
```

**Lesson:**
- A `NameError` for a misspelled global looks obvious in review but is invisible at runtime when it happens inside `asyncio.create_task`. Always write a small smoke test that exercises the full model-call path before declaring a feature done.
- When using `asyncio.create_task`, attach a done callback that checks `task.exception()` or wrap the task body in a try/except that logs any crash. Without this, background task failures are indistinguishable from a slow model call.
- Python's `_MODEL_PROVIDER` vs `MODEL_PROVIDER` underscore convention is easy to get wrong when writing defensive conditions inside long functions. Consider using a typed configuration object with IDE support instead of a bare module-level `str`.

### 6.14 Corrupted CSS Bundle After Interrupted Rebuild

**Symptom:** Frontend renders as a white page with gray SVG shapes ("large gray sunburst on white") — all dark backgrounds and glass-panel effects missing. The page HTML is correct but CSS styles are not applied.

**Diagnosis:**
1. The HTML served correctly (check with `curl | grep "deep-abyss"` — should return `1`).
2. The CSS `<link>` tag was present in the HTML.
3. Fetching the CSS file directly returned `500 Internal Server Error` — the CSS chunk in `.next/` was truncated or corrupted from a previous partial build.

**Root cause:** A `pkill -f "next start"` killed the Next.js production server while a build was still writing output files, leaving a partial/corrupt `.next/static/chunks/*.css` file. The Next.js server process served the (correct) HTML from the static build, but the (corrupt) CSS from the interrupted write. Hard-refreshing the browser didn't help because the CSS file itself was broken — not a caching issue.

**Fix:**
```bash
pkill -f "next-server"          # Kill the running server
rm -rf .next                     # Remove entire build output
npx next build                   # Clean build (takes 30-60s)
nohup npx next start -p 3001 -H 0.0.0.0 &
```

The `rm -rf .next` is critical — a partial rebuild (`npx next build` without cleaning) may reuse the corrupted chunks and produce the same broken output.

**Verification:**
```bash
css_href=$(curl -s http://localhost:3001 | grep -oP 'href="/_next/static/chunks/[^"]*\.css"' | head -1 | grep -oP '"[^"]+' | tr -d '"')
curl -s "http://localhost:3001${css_href}" | grep "deep-abyss"
# Should output: 1
```

**Lesson:** Never kill the Next.js production server while it's in the middle of writing build artifacts. Always stop the server cleanly (`pkill` then wait for process to disappear) before rebuilding. If the server was killed mid-write, always do `rm -rf .next` before the next build — incremental builds from a corrupted state produce corrupted output.

### 6.15 Variable Shadowing in orchestrator.py Loop Vector-Graph Code

**Symptom:** Memory Retrieval stuck on "processing" after Memory Retrieval code was refactored to compute vector embeddings and MDS-2D layouts. No error in logs. Same symptom as §6.17 (previously fixed) but in new code.

**Root cause:** The fix in commit c5ab0ff renamed the inner loop variable in the original `_orchestrate()` function, but a parallel code path — the vector-graph similarity computation — had its own `for i, chunk in enumerate(top_chunks)` that was NOT caught by the original fix. Two independent shadowing sites in the same function.

```python
# orchestrator.py: line 626 (vector-graph section)
for i in range(len(top_chunks)):    # BUG: shadows outer stage index i
    ...
    for j in range(len(top_chunks)):   # fine, j not used in outer scope
        ...
```

After the inner `range(len(top_chunks))` loop, `i` held `len(top_chunks)-1` (typically 4 or 5) instead of the Memory Retrieval stage index (3). The subsequent `session.steps[i].status = "complete"` hit an `IndexError` because `session.steps[4]` didn't exist yet (Context Assembly is index 4 and hasn't been created).

**Fix:** Renamed inner loop index to `vi`:
```python
for vi in range(len(top_chunks)):
    ...
    for vj in range(len(top_chunks)):
```

Also fixed the `j` → `vj` rename for consistency (though `j` is not used in the outer scope, it's good practice).

**Lesson:** When fixing a variable-shadowing bug, search the ENTIRE function — not just the original site. The same bug pattern can exist in parallel code paths (vector-graph, similarity search, deduplication passes). Use distinct descriptive names (`stage_idx`, `chunk_idx`) instead of single-letter `i`/`j` to prevent recurrence.

### 6.16 Next.js Silently Dies (OOM / Unhandled Rejection)

**Symptom:** Frontend returns `Connection refused` or `000` HTTP status after having been running fine. The process is gone from `ps aux` with no error in the startup log — the log simply ends at `✓ Ready in Xms`. The most common trigger is a hard page reload (Ctrl+Shift+R) or a burst of concurrent requests after the server has been running for a while.

**Diagnosis:**
1. Check `ss -tlnp | grep 3001` — if empty, the process is dead.
2. Check the startup log — if it ends abruptly with no stack trace, it was killed by the OOM killer or a segfault.
3. Try `dmesg | grep -i oom` (requires sudo) to confirm OOM kill.
4. If no OOM evidence, the likely cause is an unhandled promise rejection in a background handler that Node.js escalates to `process.exit` (default behaviour in Node 16+).

**Root cause:** The Next.js 16 production server on a 15GB machine defaults to a Node.js heap limit of ~1.4GB. Under load — especially during production builds or when serving multiple concurrent requests — garbage collection can't keep up and the kernel OOM-kills the process. Additionally, unhandled promise rejections in async request handlers or WebSocket fallback code cause Node to terminate the process with an unhelpful error message that may be lost in `nohup` output.

**Fix (two-part):**

1. **Raise the Node.js heap limit:**
   ```bash
   NODE_OPTIONS='--max_old_space_size=4096' nohup npx next start -p 3001 -H 0.0.0.0 > /tmp/frontend.log 2>&1 &
   ```
   This gives the garbage collector 4GB of headroom instead of 1.4GB.

2. **Catch unhandled rejections and errors:**
   A `<ClientInit />` component mounted at the top of `<body>` in `layout.tsx` registers window-level handlers:
   ```tsx
   window.addEventListener("unhandledrejection", (event) => { console.error(event.reason); });
   window.addEventListener("error", (event) => { console.error(event.message); });
   ```
   This prevents one-off promise rejections from crashing the process.

3. **Use `setsid` to detach from shell:**
   ```bash
   setsid bash -c 'NODE_OPTIONS="--max_old_space_size=4096" exec npx next start -p 3001 -H 0.0.0.0 > /tmp/frontend.log 2>&1' &
   ```
   `setsid` creates a new session so the process survives shell exit. `exec` replaces the shell with the next process, keeping the PID stable.

**Verification:**
```bash
ps -p $(ss -tlnp | grep 3001 | grep -oP 'pid=\K\d+') -o rss,pmem
# Expected: ~120MB RSS, ~0.7% memory
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001
# Expected: 200
```

**Lesson:** Node.js on memory-constrained machines needs explicit heap sizing. The default V8 heap limit (~1.4GB on 64-bit) is dangerously close to what Next.js 16 needs under load. Always set `--max_old_space_size` to at least 4GB on machines with 16GB RAM or less. Additionally, `nohup` is not reliable for detaching — use `setsid` with `exec` for guaranteed detachment.

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

15. **Small CPU-bound models are viable for orchestration.** The qwen2.5:3b on an i7-6700 takes ~40s per inference call (77s total trace), which is slow but acceptable for an observatory demo where the pacing makes the process visible. The ActivityFeed streaming live events during processing compensates for the wait time.

16. **Guard nested fields in API responses, not just the top-level object.** A response can be truthy while its nested fields are still undefined — e.g. `telemetry` exists but `telemetry.cpu` hasn't populated yet. Always use optional chaining (`?.`) on every access path where the shape isn't guaranteed between mount and first data arrival.

17. **Expose assembled context on each trace step for transparency.** Storing `context_assembled` on model-calling steps lets the UI show exactly what the model received — system prompt + accumulated context + user prompt — in a split-pane view. This turns the black-box LLM call into an inspectable artifact, which helps debugging prompt construction and context-window overflow. The token budget meter (`Math.round(text.length / 4)` vs context window) gives a visual indicator of headroom at a glance.

18. **Runtime-mutable globals enable hot-swapping without restart.** Using a module-level `_MODEL_PROVIDER` with accessor functions (`get/set_model_provider`) lets the operator switch between local and Worker Node 1 models via the SettingsModal without restarting uvicorn. The pattern works because the model resolution happens at call time (`_resolve_model_url()`) rather than at import time. The trade-off is thread safety — the global is not behind a lock, but for a single-async-thread FastAPI app this is not a concern.

19. **Background `asyncio.create_task` failures are silent by default.** A `NameError` inside a background task produces no log output or HTTP error — just a `Task exception was never retrieved` warning that's easy to miss. Always either: (a) attach a done callback that logs `task.exception()`, (b) wrap the entire task body in try/except with explicit logging, or (c) add a smoke test that runs the orchestration end-to-end before merging.

20. **TypeScript strict mode infers `Set<unknown>` from `Array.filter()` on `any[]`.** When chaining `.filter()` and `.map()` on the result of `fetch().json()` (typed `any`), the intermediate array is `any[]`, and `filter()` returns `unknown[]`. Explicitly type the parameter: `new Set<string>((data as HistoryEntry[]).filter(...).map(...))`. The error message (`Set<unknown>` not assignable to `Set<string>`) points to a misleading line — always check the call chain. (2026-06-04)

21. **`refreshTrigger` must be wired to actually fire.** The `historyRefresh` state was declared in `page.tsx` and passed to `MemoryConstellation` as `refreshTrigger`, but nothing ever incremented it. Until a `useEffect` watched for trace completion and called `setHistoryRefresh(n => n + 1)`, the constellation never re-fetched after a new trace finished. (2026-06-04)

22. **Server components cannot use `"use client"`.** The root `layout.tsx` exports `metadata` (a server-only feature). Adding `"use client"` silences the metadata export at build time. Client-side logic (event listeners, state, effects) must be extracted into a separate child component (e.g. `<ClientInit />`) imported by the server layout. (2026-06-06)

23. **SVG tooltips inside `overflow-hidden` parents get clipped.** A tooltip rendered as an SVG `<foreignObject>` or absolutely-positioned `<div>` inside a container with `overflow-hidden` (e.g. a bar chart wrapper) will be visually clipped at the parent's bounds. Fix: render the tooltip outside the container via React portal or fixed positioning from `getBoundingClientRect()`. (2026-06-06)

24. **`traceSteps.duration_ms` can be `null` for pending/failed steps.** When passing trace steps as props, TypeScript will enforce the `null` union. The component must filter with `.find(s => s.duration_ms != null)` before using the value in calculations. (2026-06-06)

### 6.17 Silent Background Task Crash Due to Variable Shadowing in `orchestrate()` Loop

**Symptom:** Submitting a prompt returned a `trace_id` immediately, but the trace progressed through Intent Classification and Model Routing, then **stuck at Memory Retrieval indefinitely** ("processing" with no duration). The frontend polled `/api/traces/{id}` every 1.5s but the Memory Retrieval step never resolved. No error appeared in backend logs.

The Memory Retrieval step's `metadata` showed `retrieved_chunks` (meaning the similarity search completed) but the step status remained "processing."

**Root cause:** A **variable shadowing bug** in `orchestrator.py:_orchestrate()`. The outer loop uses `i` as the stage index:

```python
for i, stage in enumerate(STAGES):        # i = stage index (0-6)
    ...
    if stage_id == "step-4":
        ...
        for i, chunk in enumerate(top_chunks):  # BUG: shadows outer i!
            chunk["used"] = ci == 0 or ...
```

The inner loop `for i, chunk in enumerate(top_chunks)` **reuses the same variable name** `i`, overwriting the outer loop's stage index. After the inner loop completes, `i` is `4` (the last chunk index, or `len(top_chunks)-1`) instead of `3` (Memory Retrieval's stage index). When the code reaches:

```python
session.steps[i].status = "complete"  # i=4, but steps only has 4 elements (0-3)
```

This raises `IndexError: list index out of range` because `session.steps[4]` doesn't exist yet — it would be created by the next iteration of the outer loop (Context Assembly, stage index 4). The `IndexError` crashes the `asyncio.create_task` background task silently (see Lesson #19), leaving Memory Retrieval frozen in "processing" forever.

**Why it was silent:** Same mechanism as §6.13 — `asyncio.create_task` wraps the coroutine in a Task; unhandled exceptions are logged as `Task exception was never retrieved` but do not propagate to any caller. No middleware caught it.

**Fix:** Rename the inner loop variable from `i` to `ci` (chunk index):

```python
for ci, chunk in enumerate(top_chunks):
    chunk["used"] = ci == 0 or chunk["relevance"] >= threshold
```

**Secondary issue — missing try/except on embedding computation:** At line 656, `session.embedding = await _embed(session.prompt)` was **not** wrapped in a try/except block. If the Ollama embeddings endpoint timed out or returned an error, the exception propagated, the final `_persist(session)` at line 674 never ran, and the trace's embedding was **never written to disk**. This created a vicious cascade: every subsequent trace's Memory Retrieval stage had to recompute embeddings for all past sessions (each hitting Ollama's `/api/embeddings`), multiplying the latency. Fixed by wrapping the call:

```python
try:
    session.embedding = await _embed(session.prompt)
except Exception as e:
    logger.warning("Embedding computation failed for %s: %s", trace_id, e)
```

**Lesson:**
- **Never reuse loop variable names in nested `for` loops in Python.** The outer variable is silently overwritten. Use distinct names (`i`, `j`, `k` or descriptive names like `stage_idx`, `chunk_idx`).
- **Any `await` call in a background task that is not wrapped in try/except is a crash risk.** If the call fails, the entire task dies and the session is left in an inconsistent state. Always protect fallible calls — especially HTTP/IO calls to external services (Ollama, Worker Node 1) — with `try/except` that logs the error and continues.
- **A step's `metadata` being populated but its `status` still "processing" is a diagnostic signal** that the code between the metadata write and the status update crashed. Inspect the exact line range for unguarded operations. (2026-06-09)

---

## 8. Future Considerations

### High Priority

- **[Backend] Add proper error handling** for when Worker Node 1 is unreachable. Currently, failed HTTP polls silently return `"status": "error"` — the frontend should surface this more clearly.
- **[Frontend] Move telemetry and API URLs to environment variables.** Currently, `http://198.51.100.1:8001` is hardcoded in the build. Use `NEXT_PUBLIC_API_URL` for deploy-time configuration.

### Done ✓

- **[Backend] Streaming orchestration.** Implemented via async background task + polling pattern. POST returns trace_id immediately, frontend polls `/api/traces/{id}` every 1.5s. Activity events stream live during processing. (2026-06-03)
- **[Backend + Frontend] Context Assembly Breakdown.** Each trace step now stores `context_assembled` — the exact text sent to the model. The frontend `SolarNexus` shows a split-pane (system prompt / assembled context) on node click, with a token budget meter. (2026-06-04)
- **[Backend + Frontend] Model Provider Hot-Swap.** `GET/POST /api/config/model` endpoints added. `SettingsModal` has a "Models" tab with radio buttons for local/backoffice. No restart required. (2026-06-04)
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
- **[Frontend] IP masking toggle.** `mask_ips` checkbox in SettingsModal; frontend-only CSS-value swap on focus/blur — host inputs show `192.168.x.xxx` when masked, reveal on focus. (2026-06-06)
- **[Frontend] CelestialDistribution legend tooltips.** Hover on mean/median/mode shows statistical definition and right-skew implication for trace speed. (2026-06-06)
- **[Frontend] Frontend crash resilience.** `ClientInit.tsx` catches `unhandledrejection` + `error` at the window level; start command uses `NODE_OPTIONS='--max_old_space_size=4096'` and `setsid` for stable background detachment. (2026-06-06)
- **[Backend] Fix variable shadowing in orchestrator loop.** Inner loop `for i, chunk in enumerate(top_chunks)` shadowed outer `i`, causing IndexError that froze Memory Retrieval. (2026-06-09)
- **[Frontend] StageDebate component.** `StageDebate.tsx` — detects polar opposition between Context Assembly and Response Generation outputs using sentence-level polarity scoring + topic domain overlap. Non-conflicting shows collapsible "No stage conflicts"; conflicting shows glowing violet "Internal Debate" panel. Exports `detectContradiction()`. (2026-06-10)
- **[Frontend] TraceRadar component.** `TraceRadar.tsx` — SVG pentagon radar chart with 5 axes (Confidence, Context Relevance, Constraint Adherence, Output Substance, Honesty). Computed from trace step metadata. Always renders in IntelligencePanel completed state. (2026-06-10)
- **[Frontend] ForkInTheRoad decision tree.** `ForkInTheRoad.tsx` — decision tree visualization for intent classification. Chosen path highlighted in teal with branch line + confidence bar + reasoning; rejected paths dimmed at 50% opacity with strikethrough labels. Shows during processing state. (2026-06-10)
- **[Backend + Frontend] History tab blank crash fix.** Three bugs: (1) FastAPI route ordering — `/api/traces/profile` registered AFTER `/{trace_id}`, wildcard caught "profile" as trace ID; (2) `PersonalityProfile` called `.length` on `null` API response with no error boundary, unmounting entire React tree; (3) `next start` cached stale HTML from old build. (2026-06-10)
- **[Frontend] Duplicate React key fixes.** `MemoryConstellation` edge keys used source dot index instead of map index; `CelestialDistribution` dot keys used `entry.id` (duplicate trace IDs). Fixed with composite keys (`c-${ci}-${idx}`, `${id}-${di}`). (2026-06-10)
- **[Backend] Variable shadowing re-fix (vector graph code).** Second independent `for i in range(len(top_chunks))` in the vector-graph similarity computation was NOT caught by the original §6.17 fix. Renamed to `vi`/`vj` to avoid shadowing outer stage index `i`. (2026-06-10)
- **[Backend] Intent classification prompt updated.** System prompt asks for `reasoning` per intent explaining why each path was chosen/rejected. (2026-06-10)
- **[Tooling] restart.sh.** `~/mythic-ai-observatory/restart.sh` — kills both servers, rebuilds frontend, starts backend with `--reload` and frontend with `pnpm dev`. (2026-06-10)
- **[Frontend] VectorDistanceGraph tooltip enhancement.** Replaced `useState` mouse tracking with `useRef` to avoid re-renders on every mouse move; richer tooltip content with color dot, trace ID, Used/Discarded status, relevance percentage. (2026-06-10)
- **[Frontend] Switched to `next dev` for development.** `next start` caches HTML in memory — rebuilding `.next` has no effect until server restart. Dev mode hot-reloads and avoids stale HTML. Use `pnpm dev` for active development, `next start` for demos. (2026-06-10)

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
- **OpenClaw's gateway token** (`f3daf902...`) is stored in plaintext in `openclaw.json`. Ensure this file has restricted permissions (`chmod 600`).

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
git clone git@github.com:Greggar/Mythic_AI_Observatory.git
cd Mythic_AI_Observatory

# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt   # or pip install fastapi uvicorn httpx psutil

# Frontend
cd ../frontend
pnpm install
```

The SSH key for this machine (`primary-server`) is registered on GitHub for push access.

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

## Session 2026-06-18 — LLM-Powered Cognitive Synesthesia Classifier

### Problem
The Cognitive Synesthesia chord diagram relied on hand-tuned regex classifiers (`classifySynesthesiaPrompt`, `classifySynesthesiaResponse`, and the 6 grammar-ring classifiers). Every new prompt type required a regex patch, and edge cases kept slipping through.

### Solution — Schema-Driven LLM Classification
Replaced regex classification with a background agent that uses the local LLM to classify traces against a plain-language schema:

1. **`synesthesia_schema.md`** — defines 5 input categories (Direct Command, Factual Question, Creative Request, Simple Query, Complex Inquiry) and 5 output categories (Concise List/Facts, Prose Explanation, Creative/Verse, Bulleted List, Technical/Code) with 10+ examples each. Edit this to change classification behavior — no code changes.

2. **`classifier_agent.py`** — background task polls every 45 seconds, finds traces without synesth data, classifies them via `qwen2.5:1.5b` (local, fast for 1-2 new traces), stores results in `synesth_cache.json`.

3. **`backfill_synesth.py`** — one-shot script using Worker Node 1 GPU (`qwen2.5:7b`) to classify all 93 existing traces in ~45 seconds.

4. **`SynesthClassification` model** — `input_cat`/`output_cat` fields on `TraceSession`. Frontend reads `trace.synesth` when available, falls back to regex for unclassified traces.

### Key Architectural Decisions
- **Separate cache file** (`synesth_cache.json`) rather than modifying `traces.jsonl` — avoids rewriting the entire history file on each classification.
- **Merge at API layer** — `api_list_traces` calls `merge_synesth()` which overlays cache data onto `TraceSession` objects before returning them. Backward-compatible: old traces without cache entries get `synesth: null`.
- **Two-tier model strategy** — Worker Node 1 GPU for initial backfill (fast, parallel), local CPU model for ongoing (cheap, always available).

### Frontend: 6-Ring Concentric Synesthesia Chart

The RelationshipsPanel renders a 6-ring concentric SVG chart that visualizes the full prompt→response pipeline from a trace:

- **Rings 1-3 (inner 35%)**: Depth (Interjection/Minor Sentence/Full Verb Phrase) → Mood (Imperative/Indicative/Interrogative/Conditional/Subjunctive) → Syntax (Simple/Compound/Complex)
- **Rings 4-6 (outer 65%)**: Action Type (Direct Execution/Conversational Phatic/Refusal/Guardrail) → Pragmatic Tone (Informative/Instructional/Creative/Analytical/Corrective) → Output Form (Structured/Bulleted/Continuous Prose)

#### Architecture

1. **`buildSynesthTree()`** — aggregates each trace into a 6-level tree path. Each node carries a `moodIdx` for color propagation. `ensureChild()` creates parent-child hierarchy with mood-index inheritance for gradient-bleed coloring.

2. **`layoutSunburst()`** — computes proportional angular spans per node. Each ring is divided among its parent node's children based on trace count. The inner 3 rings share the first 35% of radial space; outer 3 get the remaining 65%.

3. **`nodeColor()`** — HSL-based color strategy: mood determines hue (0 red/217 blue/38 amber/258 purple/160 emerald), depth determines lightness/saturation. Special rules: Creative tone pops (+14 sat, +5 lit), Informative mutes (−8 sat), Refusal mutes (−12 sat, −3 lit).

4. **Legend** — unified `"# RING"` legend with number + label per row, plus a separate mood color legend on the right.

5. **Tooltip** — rendered via `createPortal` to `document.body` with `z-[100]` to escape parent stacking contexts (`overflow-hidden` on glass panels).

6. **CSV export** — 6 columns: depth, mood, syntax, action, tone, form.

#### Bugfixes
- **moodIdx inheritance** — `buildSynesthTree` was inheriting `moodIdx` from the depth parent at Ring 2 instead of using the actual mood category (`d <= 1 ? catIdx : node.moodIdx`). Conditional/Subjunctive traces were colored amber (from parent depth) instead of purple/emerald.
- **Depth ring invisible** — center circle radius (`r=18`) exactly overlapped the Depth ring arcs (inner=0, outer=18). Fixed: center `r=14`, Depth shifted to `inner=16, outer=32`.
- **Duplicate React keys** — `r5-Continuous Prose` appeared twice (same label under different parent Tone nodes). Keys now include `startAngle`: `r${ring}-${label}-${sa.toFixed(4)}`.
- **Off-by-one in collectLevelNodes** — depthLevel=0 returned root instead of Depth children. Rewrote to start at `root.children` at d=0.

### Problems Encountered & Fixes

| Problem | Fix |
|---------|-----|
| `qwen2.5:3b` too slow on CPU (120s+ per trace) | Switched to `qwen2.5:1.5b` for the background agent |
| Worker Node 1 `qwen2.5:7b` returned 500 errors with concurrency=4 | Reduced `CONCURRENCY` to 1 — model can't handle parallel requests |
| `synesth: null` in API responses after backfill | Server's `_cache` module variable was stale — restart picked up the cache file |
| Analysis model settings showed "qwen2.5:3b" with backoffice provider (404 error) | Race condition between `fetchModels` and `fetchNetworkSources` in SettingsModal; auto-selection effect was not updating `analysisModel` state; `handleSave` used stale model name |
| Settings modal didn't load network sources until Models tab opened | Added `fetchNetworkSources()` to the modal mount effect |

### Lessons Learned
- **Schema-driven classification works** — the LLM correctly interpreted the plain-language schema, classifying traces with nuanced understanding that regex couldn't match.
- **Worker Node 1 GPU is ~100x faster** — qwen2.5:7b classified traces in 1.2s each vs 120s+ for qwen2.5:3b on CPU. But it can't handle >1 concurrent request without crashing.
- **State sync is the hardest part** — React state + concurrent API calls + async effects create race conditions that are invisible until the wrong value persists across a save. Always test the "open settings → save without touching anything" path.
- **Separate cache from source of truth** — storing classifications in a separate file (`synesth_cache.json`) avoided coupling to the trace persistence layer and made backfill trivially idempotent.

### Relevant Files
- `backend/services/synesthesia_schema.md` — editable classification schema
- `backend/services/classifier_agent.py` — background classifier agent + cache management
- `backend/models/trace.py` — `SynesthClassification` Pydantic model
- `backend/main.py` — `merge_synesth` in `api_list_traces`, background task startup, manual classify endpoint
- `frontend/src/components/RelationshipsPanel.tsx` — `synInputCat`/`synOutputCat` helpers with LLM-first, regex-fallback
- `frontend/src/components/SettingsModal.tsx` — analysis model save fix (race condition, stale state)
- `frontend/src/types/trace.ts` — `SynesthClassification` TypeScript interface
- `tools/backfill_synesth.py` — backfill script using Worker Node 1 GPU
- `frontend/src/components/RelationshipsPanel.tsx` — `buildSynesthTree()`, `layoutSunburst()`, `nodeColor()` for 6-ring concentric chart
- `frontend/src/components/RelationshipsPanel.tsx` — `classifyDepth()`, `classifyMood5()`, `classifyActionType()`, `classifyPragmaticTone()`, `classifyOutputForm()` client-side classifiers

---

*Generated 2026-06-19. Update this document when making architectural changes.*
