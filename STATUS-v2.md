# Mythic AI Observatory — Phase 4 Status

## What's New (Phase 4)

Phase 4 transformed the Observatory from a functional dashboard into a living constellation interface. The visual language centres on calm, sacred intelligence — no cyberpunk, no dense tables, no admin styling.

### Solar Nexus — Complete Refactor

| Component | What Changed |
|---|---|
| `SolarCore` | Replaced simple circles with layered concentric rings, triskele Celtic knot geometry, rotating knotwork halos, breathing glow, periodic solar pulse, subtle volumetric light effect |
| `AgentNode` | Five distinct states (idle → active → processing → completed → unreachable), each with its own visual language. Health glow rings, amber shimmer for busy, fading crimson ember for unreachable. No blinking — all transitions use scale+opacity with generous durations |
| `EnergyPath` | Upgraded from basic dashed lines to luminous curves with travelling particles, solar flare bursts on activation, glow highlights, and gradient fills |
| `OrchestrationRing` | Refined ring set: 5 concentric rings at various speeds, dash arrays, and opacities |
| `SacredGeometry` | **New** — Celtic solar knots, astrolabe ring, maritime compass rose, illuminated-manuscript marginal dots. Opacity is extremely low (0.02–0.04). Rotates on 3-minute cycles. Felt rather than noticed |

### Intelligence Panel (Right Side)

Replaces the `DecisionPathways` card. Three distinct visual states:

- **Idle** — Shows CPU, Remotes Online, Models count, Gateway status. Clean card layout, no tables
- **Processing** — Current stage card (teal highlight), next stage preview, elapsed time, 7-dot agent activity indicator
- **Completed** — Gold-accented completion card with output summary, duration, model used, animated confidence bar

### Orchestration History

**Backend** — Traces persist to `backend/data/traces.jsonl` (JSONL format, max 500 runs). New endpoint `GET /api/traces?limit=N` returns most recent traces.

**Frontend** — `HistoryPanel` shows timestamp, prompt summary, duration, status. Clicking a history entry replays that trace through the visualisation (pulls full trace via `GET /api/traces/{id}`). "Clear replay" button in header to return to live mode.

### Prometheus Visualisations

- **ResourceConstellation** — SVG diagram showing CPU, Memory, GPU, Network as orbiting celestial bodies around a small central core. Body size scales with utilization. Colors shift from jade → teal → amber → red based on load
- **TrendChart** — Smooth SVG trend lines for CPU and Memory over the last 60 telemetry samples (~90 seconds). Uses quadratic bezier curves, no sharp corners

### Audio Framework

`lib/audioService.ts` provides typed event hooks (`onAudioEvent`, `emitAudioEvent`, `createAudioPlayer`). Events: `orchestration-start`, `stage-complete`, `orchestration-complete`, `error`, `idle`, `pulse`. No actual audio assets loaded — ready for future wiring to Howler.js or Web Audio API.

### Visual Language — CSS State System

Added to `globals.css`:
- `state-healthy` — jade glow
- `state-busy` — teal energy
- `state-completed` — gold radiance
- `state-warning` — amber shimmer
- `state-offline` — fading crimson ember

All animations use fade+scale transitions (no blinking). Custom scrollbar styling for history panel.

## Current Architecture

```
User ←→ Next.js (:3001) ←→ FastAPI (:8001) ←→ Worker Node 1 qwen2.5:7b (:12434)
                          ↑
                    Prometheus (:9090) + Node Exporter (:9100)

Persistence:
  backend/data/traces.jsonl  — 500 most recent orchestration traces
  (no database — JSONL is append-only, trimmed on size threshold)
```

### Files Changed in Phase 4

**New:**
- `frontend/src/components/SacredGeometry.tsx`
- `frontend/src/components/IntelligencePanel.tsx`
- `frontend/src/components/HistoryPanel.tsx`
- `frontend/src/components/ResourceConstellation.tsx`
- `frontend/src/components/TrendChart.tsx`
- `frontend/src/lib/audioService.ts`
- `backend/data/traces.jsonl` (auto-created on first orchestration)

**Rewritten:**
- `frontend/src/components/SolarCore.tsx`
- `frontend/src/components/AgentNode.tsx`
- `frontend/src/components/EnergyPath.tsx`
- `frontend/src/components/SolarNexus.tsx`
- `frontend/src/app/page.tsx`
- `frontend/src/app/globals.css`
- `backend/services/orchestrator.py`
- `backend/main.py`

**Unchanged (remaining functional):**
- `BackgroundAtmosphere.tsx`
- `SystemVitals.tsx`
- `PromptInput.tsx`
- `TraceTimeline.tsx`
- `TimelineStep.tsx`
- `ObservatoryPanel.tsx`
- `hooks/useWebSocket.ts`, `useOrchestrate.ts`, `useTraceReplay.ts`
- `types/trace.ts`

## What Works

- 7-stage orchestration pipeline with real LLM calls to Worker Node 1 `qwen2.5:7b`
- Telemetry polling (CPU, memory, GPU, Ollama, OpenClaw, remotes) every 1.5s
- Solar Nexus visualisation with sacred geometry, breathing core, orbiting nodes, flowing energy paths
- Trace replay with 600ms minimum step delay
- History persistence and browsing
- History replay (click an entry to re-watch its trace)
- Intelilgence Panel with three states (idle/processing/complete)
- Resource Constellation (celestial body visualisation)
- Trend Charts (last ~90 seconds of CPU and Memory)
- Audio event hooks (no sound yet)
- CSS state system
- Prometheus active on :9090, node-exporter on :9100
- systemd user services for both backend and frontend, auto-start at boot

## Notable Constraints & Issues

### WebSocket Still Dead
Router/firewall kills WebSocket after HTTP upgrade. All telemetry uses HTTP polling every 1.5s. This affects both the app telemetry and Next.js HMR (irrelevant in production mode). If WebSocket connectivity is ever restored, the backend's `ConnectionManager` and `/ws/telemetry` endpoint are still in place.

### SVG Hydration Requirement
All SVG path coordinates built from `Math.cos`/`Math.sin` use `.toFixed(4)` to avoid React hydration mismatch between Node.js and browser V8 at the ~10⁻¹⁵ level. This is handled in `SolarCore` (triskele paths), `OrchestrationRing` (knot arcs), and `SacredGeometry`. If you add new SVG components with trigonometric coordinates, apply `.toFixed(4)`.

### History Persistence Limitations
- JSONL format on disk — not a database
- No search, no filtering, no pagination beyond the `limit` param
- Trims to 500 entries when file exceeds ~5MB (approximate)
- Concurrent write safety not handled (single-threaded FastAPI behind uvicorn, so fine in practice)

### No Auth
Fully open. Anyone on the LAN can view the interface and submit orchestration prompts.

### Hardcoded URLs
- Telemetry poll URL is hardcoded to `http://192.168.1.1:8001/api/telemetry` in `useWebSocket.ts`
- API base is `process.env.NEXT_PUBLIC_API_URL` (falls back to `http://localhost:8001`)
- Worker Node 1 URL hardcoded in `orchestrator.py`
- Worker Node 1 model name hardcoded as `qwen2.5:7b`

### No Database
All state (traces, telemetry) is in-memory or flat-file. No session persistence beyond the trace list.

### Confidence Bar and Duration Are Approximate
- The 88% confidence shown in the Intelligence Panel ("completed" state) is hardcoded — should come from the trace session model
- Duration shown is sum of individual step durations, which may not match wall-clock time exactly

### GPU Stats
Requires `nvidia-smi`. On systems without NVIDIA GPUs, GPU gauges show 0%. The resource constellation handles this gracefully (zero-sized body).

### Black-on-Transparent Text in SVG Labels
The text elements used for node labels in `SolarNexus.tsx` are intentionally transparent (`fill="transparent"`) — visible rendering is handled by the `AgentNode` component's own text element. This is a side-effect of keeping the original SVG structure.

### Scrollbar on History Panel
The history panel uses a custom thin scrollbar. It's styled via `scrollbar-thin` class which targets WebKit scrollbars. May not render on Firefox without `scrollbar-width: thin` added.

## Visual Identity (Applied)

| Token | Hex | Role |
|---|---|---|
| `teal-mystic` | `#2dd4bf` | Primary accent, active nodes, intelligence pulse |
| `solar-gold` | `#fbbf24` | Completion radiance, highlight, confidence |
| `jade-glow` | `#34d399` | Healthy state, idle nodes |
| `deep-abyss` | `#05070f` | Background |
| `deep-abyss-light` | `#0c1124` | Panel fill |
| | | |
| Sacred geometry | — | Celtic knots, astrolabe rings, compass rose at 0.02–0.04 opacity |

## Known Issues (2026-06-09)

### Fixed
- **Memory Retrieval stuck on "processing"** — Inner loop variable `i` in `orchestrator.py:596` shadowed the outer stage index, causing `IndexError` in the background task after Memory Retrieval completed its similarity search. The step's metadata was populated but its status never flipped to "complete." Also fixed missing try/except around embedding computation that prevented embeddings from being persisted, creating a cascade where every subsequent trace recomputed all past embeddings.

### Foreseen
- **Post-complete section is slow** — 3 sequential LLM calls (insights, rationale, explanation) using qwen2.5:3b on CPU, each taking 30-60s. Embedding persists and final `traces.jsonl` write are blocked until all finish. Consider `asyncio.gather()` or separate fire-and-forget tasks.
- **JSONL deduplication** — `_persist()` appends the full session on every call (multiple persists per trace), inflating `load_history()` with duplicate entries that skew Memory Retrieval similarity search.

## Next-Sprint Candidates

1. **Make confidence dynamic** — derive from trace quality or model output metrics
2. **Add database** — SQLite for proper history querying, search, filtering
3. **Un-hardcode URLs** — move to environment variables throughout
4. **Design the trace history view** — what does browsing 500 past orchestrations look like?
5. **Audio assets** — wire actual ambient tones to the audio service events
6. **Responsive layout** — currently optimized for ~1920px wide; breaks at <1280px
7. **Firefox scrollbar** — add `scrollbar-width: thin` for the history panel
8. **Agent Habitat crossover** — the Phaser 3 cyberpunk city on :5050 has potential cross-pollination patterns
