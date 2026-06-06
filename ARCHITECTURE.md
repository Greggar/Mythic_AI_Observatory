# Mythic AI Observatory — Architecture & Operations Guide

---

## 1. Project Overview

The Mythic AI Observatory is a distributed agentic AI monitoring and orchestration platform. It consists of a FastAPI backend (the "Conductor") that polls system telemetry and runs orchestration traces backed by real LLM inference, a Next.js frontend (the "Solar Interface") that visualises everything with an elegant glassmorphic UI, and a Prometheus stack for long-term metrics.

**Core philosophy:** calm, intelligent, observability-first. The UI avoids game/cyberpunk/cluttered aesthetics in favour of sacred geometry, subtle glow effects, and negative space.

---

## 2. System Topology

```
┌─────────────────────────────────────────────────────────────────┐
│                        Ubuntu Server                             │
│                    192.168.0.237 (primary-server)              │
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
│              │   Backoffice PC           │
│              │   198.51.100.100           │
│              │                           │
│              │  Docker Model Runner      │
│              │  :12434                   │
│              │  ┌─ gpt-oss:20B (11GB)   │
│              │  └─ qwen3.5:9B (5.5GB)   │
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

**`context_assembled`** — a new field added for transparency. At each model-calling stage (steps 2, 5, 6), the concatenated context (`"\n".join(context + [prompt])`) is stored on the step so the frontend can display exactly what was sent to the model. Non-model stages store `"[non-model stage — no context assembly]"`.

**`model_used`** on the session records which model name wound up being called (e.g. `qwen2.5:3b` or `qwen3.5:9B`).

Using Pydantic `BaseModel` with sensible defaults (auto-timestamps, empty metadata).

### Orchestrator Service: `backend/services/orchestrator.py`

- **7 stages** (steps 2, 5, 6 call the backoffice LLM; 1, 3, 4, 7 are lightweight):
  1. Request Received — 50ms, no model
  2. Intent Classification — calls `qwen3.5:9B` via Ollama-compatible API
  3. Agent Selection — 50ms, no model
  4. Memory Retrieval — 50ms, no model
  5. Context Synthesis — calls `qwen3.5:9B`
  6. Response Generation — calls `qwen3.5:9B` (final answer)
  7. Final Response — 50ms, no model
- Steps execute sequentially via `asyncio`
- Each model call sends the accumulated context + the original prompt, using `httpx.AsyncClient`
- Backoffice URL: `http://198.51.100.100:12434` (Ollama-compatible API)
- The model is a reasoning model that produces `thinking` + `response`; if `response` is empty, `thinking` is used as fallback
- `num_predict` is unset (let the model generate naturally) — with limits the thinking consumed all tokens before reaching the response
- In-memory dict store (`_store`) keyed by trace ID (UUID hex, 12 chars)

**Design reasoning:** Real LLM calls make the trace timeline authentic — each step's duration reflects actual model inference time, and the final output is a genuine model response rather than a canned string. The `gpt-oss:20B` model on the backoffice was too large to respond reliably (timed out), so all model stages use `qwen3.5:9B`.

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
| `local` | `http://127.0.0.1:11434` (Ollama) | `qwen2.5:3b` | CPU inference on primary (moderate quality, slow) |
| `backoffice` | `http://198.51.100.100:12434` (Docker Model Runner) | `qwen3.5:9B` | GPU inference on BackOffice (high quality, fast) |

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
  page.tsx          — Tabbed dashboard: Systems tab / Traces tab + settings

  │   [Systems Tab]                    [Traces Tab]
  │   ─────────────                    ───────────
  │   ├── SystemVitalsPanel            ├── IntelligencePanel
  │   ├── EngineStatusPanel            │   └── StageDescriptions
  │   ├── ResourceConstellation        ├── SolarNexus
  │   └── ActivityFeed                 │   └── ContextPane
  │                                    ├── PromptInput
  │                                    ├── ObservatoryPanel
  │                                    │   └── TraceTimeline
  │                                    │       └── TimelineStep
  │                                    └── MemoryConstellation
  │
  ├── SettingsModal       — Network config + Models tab (provider hot-swap)
  └── DiscoveryEvents     — Toast overlay on orchestration completion
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

# Development mode (local-only, HMR WebSocket required):
pnpm dev

# Production mode (LAN access, no HMR WebSocket):
npx next build   # one-time build
npx next start -p 3001 -H 0.0.0.0
# → http://localhost:3001 or http://192.168.0.237:3001
```

**Important:** When accessing from a remote machine on the LAN, always use production mode (`next start`). Dev mode's HMR WebSocket may fail across network boundaries, causing the React app to not hydrate properly. See §6.7 for details.

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

### Agent Nexus — Visual States

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
  Gingerlong: [
    { label: "API", color: "#2dd4bf" },
    { label: "Ollama", color: "#34d399" },
    { label: "OC", color: "#fbbf24" },
    { label: "UI", color: "#2dd4bf" },
    { label: "FastAPI", color: "#34d399" },
    { label: "Conductor", color: "#fbbf24" },
  ],
  BackOffice: [
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

**Resolution:** Upgraded to `qwen2.5:3b` (still CPU-bound on this machine), then ultimately switched to using a backoffice PC with 16GB VRAM running Docker Model Runner with `gpt-oss:20B` and `qwen3.5:9B`.

**Lesson:** Models below 3B parameters are not suitable for conversational AI. For a Telegram bot, use at minimum a 7B parameter model or delegate to a GPU-equipped machine.

### 6.3 3B Model Too Slow on Local CPU

**Symptom:** The 3B model was extremely slow despite the machine having a capable CPU (i7-6700, 8 threads, 15GB RAM).

**Root cause:** The machine has a GTX 960 with 2GB VRAM. The 3B model is 1.9GB — almost the entire VRAM — leaving no room for KV cache. Ollama likely attempted partial GPU offloading, causing PCIe transfer bottlenecks worse than pure CPU. The 1.5B model (986MB) fit in VRAM and ran faster on GPU despite being smaller.

**Lesson:** Having a GPU doesn't help if the model doesn't fit in VRAM. A model that fits entirely in VRAM will outperform a larger model that spills to CPU. Check `nvidia-smi` VRAM before choosing a model size.

### 6.4 Context Overflow with Telegram Bot

**Symptom:** `Context overflow: prompt too large for the model (22917 tokens exceeds 4096)`

**Root cause:** The `qwen3.5:9B` model on the backoffice has only 4096 context tokens. The Telegram conversation history accumulated beyond this limit.

**Fix:** Add `reasoning: false` to model config (already set), and use `/reset` or `/new` to clear sessions. The auto-compaction feature attempted recovery.

**Lesson:** Always check the `context_window` of a model before deploying. 4K context is very small — look for models with 8K, 32K, or 128K context windows for interactive use.

### 6.5 Next.js Dev Server Not Reachable on LAN

**Symptom:** Site worked at `http://localhost:3000` on the server but not at `http://192.168.0.237:3000` from another PC.

**Root cause:** Next.js dev server defaults to binding on `127.0.0.1` only. The `-H 0.0.0.0` flag is required to accept connections from the network.

**Fix:** Changed `dev` script in `package.json` from `next dev` to `next dev -p 3001 -H 0.0.0.0` (also changed port to 3001 due to RocketChat conflict).

**Lesson:** Always add `-H 0.0.0.0` to Next.js dev in multi-machine dev environments. Consider switching to `next start` (production mode) for persistent LAN access.

### 6.6 Port Clash with RocketChat

**Symptom:** Port 3000 was already in use by RocketChat.

**Fix:** Mapped Next.js to port 3001 via `-p 3001`.

### 6.7 WebSocket Connections Fail from Remote LAN Machines

**Symptom:** The frontend works perfectly at `http://localhost:3001` on the server but shows "no connection" at `http://192.168.0.237:3001` from another LAN machine (the backoffice PC). The Next.js dev server page loads fine, but the telemetry WebSocket won't connect.

**Browser console errors:**
```
web-socket.ts:50 WebSocket connection to
'ws://192.168.0.237:3001/_next/webpack-hmr?id=...' failed
```

**Diagnosis process:**
1. Verified the backend FastAPI server listens on `0.0.0.0:8001` (all interfaces) — correct.
2. Tested WebSocket connectivity via Python `websockets` library FROM the server itself — connected fine, received telemetry messages.
3. Tested with explicit `Origin` headers to simulate browser cross-origin requests — still worked.
4. Checked the backend access log and found WebSocket connections FROM the backoffice (`198.51.100.100`) were being *accepted* but then *closed* shortly after (`connection closed` appears within 1–2 log lines of `connection open`).
5. Tested with regular HTTP `fetch()` to port 8001 — this worked reliably, confirming the backend is reachable.
6. Checked browser DevTools → Network tab — saw only Next.js HMR WebSocket failures; our app's WebSocket never appeared, meaning the JavaScript runtime was crashing before our hook even executed.

**Root cause:**

The **network path between the server and backoffice** kills WebSocket connections after the HTTP upgrade handshake. This is likely due to a router or firewall feature (e.g., deep packet inspection, connection tracking timeout, or a proxy that handles HTTP but not WebSocket upgrades). Two separate WebSocket channels were affected:

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
const ws = new WebSocket("ws://192.168.0.237:8001/ws/telemetry");
ws.onmessage = (event) => setData(JSON.parse(event.data));

// After (useWebSocket — HTTP polling):
const res = await fetch("http://192.168.0.237:8001/api/telemetry");
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

18. **Runtime-mutable globals enable hot-swapping without restart.** Using a module-level `_MODEL_PROVIDER` with accessor functions (`get/set_model_provider`) lets the operator switch between local and backoffice models via the SettingsModal without restarting uvicorn. The pattern works because the model resolution happens at call time (`_resolve_model_url()`) rather than at import time. The trade-off is thread safety — the global is not behind a lock, but for a single-async-thread FastAPI app this is not a concern.

19. **Background `asyncio.create_task` failures are silent by default.** A `NameError` inside a background task produces no log output or HTTP error — just a `Task exception was never retrieved` warning that's easy to miss. Always either: (a) attach a done callback that logs `task.exception()`, (b) wrap the entire task body in try/except with explicit logging, or (c) add a smoke test that runs the orchestration end-to-end before merging.

20. **TypeScript strict mode infers `Set<unknown>` from `Array.filter()` on `any[]`.** When chaining `.filter()` and `.map()` on the result of `fetch().json()` (typed `any`), the intermediate array is `any[]`, and `filter()` returns `unknown[]`. Explicitly type the parameter: `new Set<string>((data as HistoryEntry[]).filter(...).map(...))`. The error message (`Set<unknown>` not assignable to `Set<string>`) points to a misleading line — always check the call chain. (2026-06-04)

21. **`refreshTrigger` must be wired to actually fire.** The `historyRefresh` state was declared in `page.tsx` and passed to `MemoryConstellation` as `refreshTrigger`, but nothing ever incremented it. Until a `useEffect` watched for trace completion and called `setHistoryRefresh(n => n + 1)`, the constellation never re-fetched after a new trace finished. (2026-06-04)

---

## 8. Future Considerations

### High Priority

- **[Backend] Add proper error handling** for when the backoffice PC is unreachable. Currently, failed HTTP polls silently return `"status": "error"` — the frontend should surface this more clearly.
- **[Frontend] Move telemetry and API URLs to environment variables.** Currently, `http://192.168.0.237:8001` is hardcoded in the build. Use `NEXT_PUBLIC_API_URL` for deploy-time configuration.

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

### Medium Priority

- **[Frontend + Backend] Investigate WebSocket-killing network issue.** The router/firewall between the server and backoffice drops WebSocket connections after HTTP upgrade. Identifying the exact device and rule would allow re-enabling WebSocket for lower-latency telemetry.
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
| `frontend/src/components/SolarNexus.tsx` | Agent Nexus — animated SVG ring with 7 pipeline stages, energy particles, live step tracking; clickable nodes show ContextPane (split-pane prompt/context) + TokenMeter |
| `frontend/src/components/SettingsModal.tsx` | Network config editor for backend/remote endpoint URLs + Models tab for runtime provider hot-swap |
| `frontend/src/components/ResourceConstellation.tsx` | System Orbit — solar system viz with machines as planets, orbiting service glyphs that pulse on activity |
| `frontend/src/components/IntelligencePanel.tsx` | Confidence ring, duration, model, token estimate, resource impact attribution; stage descriptions for each of the 7 orchestration stages; collapsible `context_assembled` viewer with toggle |
| `frontend/src/components/EngineStatusPanel.tsx` | Runtime Metrics dashboard: throughput (req/s), avg latency, error count with hover details; mini duration bar chart with gradient fill showing recent trace durations; hover any bar to see trace ID, duration, and status |
| `frontend/src/components/ActivityFeed.tsx` | Real-time event stream from backend activity bus (polls every 2s) |
| `frontend/src/components/MemoryConstellation.tsx` | History browser — spiral galaxy SVG: past traces as orbiting dots clustered semantically along a spiral arm with orbital drift, connection filaments, theme labels outside rotation; new traces get an amber expanding glow burst (5s) + flashing core; click any dot to replay that trace in the timeline; on hover/click the panel zooms (scale 1.3x) with opaque overlay; per-trace "Show assembled context" toggle reveals `context_assembled` in tooltip |
| `frontend/src/components/DiscoveryEvents.tsx` | Toast overlay for discovery events on orchestration completion |
| `frontend/src/components/SettingsModal.tsx` | Network config editor for backend/remote endpoint URLs |
| `frontend/src/hooks/useWebSocket.ts` | WebSocket hook with auto-reconnect (currently HTTP polling) |
| `frontend/src/hooks/useOrchestrate.ts` | Orchestration hook — async POST returns trace_id, polls for incremental updates every 1.5s |
| `frontend/src/hooks/useTraceReplay.ts` | Step-by-step animation hook for historical trace replay |
| `frontend/src/types/trace.ts` | TypeScript types mirroring backend Pydantic models — includes `context_assembled` on TraceStep |
| `backend/data/network.json` | Persistent network config (machines, remotes, endpoints) |
| `backend/data/services.json` | Service definitions (glyph layout, name, description) served via `GET /api/services` |
| `DEVELOPMENT.md` | Quick-start guide for local dev |
| `LVM-ROOT-EXPAND.md` | Instructions for expanding the root LVM volume |
| `Innovation.md` | Ideas log for practical experiments with the local 3B model |
| `~/.openclaw/openclaw.json` | OpenClaw configuration (models, channels, skills) |
| `~/.config/systemd/user/openclaw-gateway.service` | Systemd user service for OpenClaw |
| `/var/snap/prometheus/current/prometheus.yml` | Prometheus Snap config (currently broken) |

---

*Generated 2026-06-06. Update this document when making architectural changes.*
