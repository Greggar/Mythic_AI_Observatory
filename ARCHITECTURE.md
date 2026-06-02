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
- **Background telemetry loop:** polls CPU, memory, GPU (nvidia-smi), Ollama tags, OpenClaw health, and remote endpoints (Hermes, ComfyUI) every 1.5s
- **WebSocket endpoint** `/ws/telemetry` broadcasts structured telemetry JSON to all connected frontend clients
- **REST endpoints:**
  - `GET /health` — liveness check
  - `GET /metrics` — Prometheus-formatted metrics
  - `POST /api/orchestrate` — submit a prompt, get a trace (see §3.1)
  - `GET /api/traces/{id}` — retrieve a persisted trace

### Trace Models: `backend/models/trace.py`

```python
TraceStep     — id, label, status, timestamp, duration_ms, metadata
TraceSession  — id, prompt, status, steps[], output, created_at, completed_at
```

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

---

## 4. Frontend Architecture

### Component Tree

```
layout.tsx          — Root layout, Geist fonts, dark background
  page.tsx          — Three-column dashboard + trace timeline

  ├── SystemVitals       — CPU/GPU/Memory gauges with animated bars
  ├── SolarNexus         — Animated SVG pentagram orchestration viz
  ├── DecisionPathways   — Quick-status cards (Ollama count, remotes, gateway)

  ├── PromptInput        — Textarea + submit button with Cmd+Enter
  ├── ObservatoryPanel   — Animated container (reveals on trace)
  │   └── TraceTimeline  — Step-by-step timeline with status markers
  │       └── TimelineStep — Individual step row (icon, label, duration)
```

### Custom Hooks

| Hook | Purpose |
|---|---|
| `useWebSocket(url)` | Polls `http://{server}:8001/api/telemetry` every 1.5s via `fetch()`, returns `{data, connected}` |
| `useOrchestrate()` | Manages `POST /api/orchestrate` lifecycle: loading, trace state, error |

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

### 6.8 Hydration Mismatch Due to Floating-Point Precision in SVG

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

---

## 8. Future Considerations

### High Priority

- **[Backend] Add proper error handling** for when the backoffice PC is unreachable. Currently, failed HTTP polls silently return `"status": "error"` — the frontend should surface this more clearly.
- **[Frontend] Move telemetry and API URLs to environment variables.** Currently, `http://192.168.0.237:8001` is hardcoded in the build. Use `NEXT_PUBLIC_API_URL` for deploy-time configuration.

### Medium Priority

- **[Backend] Streaming orchestration.** Instead of returning the full trace at once, stream each step completion over HTTP SSE or a persistent connection so the frontend animates steps in real-time as they complete.
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
|---|---|
| `backend/main.py` | FastAPI app, telemetry loop, WebSocket, REST endpoints |
| `backend/models/trace.py` | Pydantic models for trace steps and sessions |
| `backend/services/orchestrator.py` | Mocked orchestration logic with 7 stages |
| `frontend/package.json` | Dependencies and scripts (`dev` on port 3001) |
| `frontend/src/app/globals.css` | Tailwind v4 theme with custom colours + glassmorphism |
| `frontend/src/app/layout.tsx` | Root layout with Geist fonts |
| `frontend/src/app/page.tsx` | Main dashboard: vitals + nexus + pathways + prompt + timeline |
| `frontend/src/components/PromptInput.tsx` | Textarea with submit, Cmd+Enter, loading state |
| `frontend/src/components/TraceTimeline.tsx` | Full timeline: steps + resolution output |
| `frontend/src/components/TimelineStep.tsx` | Single step row with status icon, duration |
| `frontend/src/components/ObservatoryPanel.tsx` | Animated container for trace output |
| `frontend/src/components/SystemVitals.tsx` | CPU/Memory/GPU gauge bars |
| `frontend/src/components/SolarNexus.tsx` | Animated SVG pentagram orchestration visualisation |
| `frontend/src/components/DecisionPathways.tsx` | Quick-glance status cards |
| `frontend/src/hooks/useWebSocket.ts` | WebSocket hook with auto-reconnect |
| `frontend/src/hooks/useOrchestrate.ts` | Orchestration API call hook |
| `frontend/src/types/trace.ts` | TypeScript types mirroring backend Pydantic models |
| `~/.openclaw/openclaw.json` | OpenClaw configuration (models, channels, skills) |
| `~/.config/systemd/user/openclaw-gateway.service` | Systemd user service for OpenClaw |
| `/var/snap/prometheus/current/prometheus.yml` | Prometheus Snap config (currently broken) |

---

*Generated 2026-05-29. Update this document when making architectural changes.*
