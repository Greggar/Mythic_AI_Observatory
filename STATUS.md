# Mythic AI Observatory — Development Status

## What It Is
A distributed agentic AI monitoring and orchestration platform. Users submit prompts that flow through a 7-stage LLM orchestration pipeline (real inference via `qwen3.5:9B` on a backoffice GPU). The system telemetry and trace data are visualised in a calm, sacred, luxurious single-page interface.

## Architecture

```
User ←→ Next.js (:3001) ←→ FastAPI (:8001) ←→ Backoffice qwen3.5:9B (:12434)
                          ↑
                    Prometheus (:9090) + Node Exporter (:9100)
```

- **Backend** — FastAPI serving telemetry (CPU/mem/disk/network via psutil, 1.5s polling), orchestration pipeline, trace storage in memory. Python 3.12, venv-isolated.
- **Frontend** — Next.js 16, Tailwind v4, Framer Motion, Canvas2D (atmosphere layer). Production mode (`next start`), no WebSocket (HTTP polling due to network constraint).
- **Deployment** — Single Ubuntu 24.04 server, two systemd user services, auto-start at boot. Backoffice PC runs the LLM model runner.

## What's Built (Working)

- **System vitals panel** — gauges for CPU, memory, disk, network I/O
- **Prompt input** — textarea with Cmd+Enter submit, loading state
- **Solar Nexus** — animated SVG orchestration visualisation:
  - **BackgroundAtmosphere** — Canvas2D particle system with aurora gradient
  - **OrchestrationRing** — 5 concentric rings with knotwork outer arcs
  - **SolarCore** — breathing central intelligence, pulses on trace activity, emits completion wave
  - **AgentNode** — 7 orbiting service nodes with state-driven colour (idle/active/complete/error), deterministic orbital drift
  - **EnergyPath** — curved bezier arcs with dasharray flow animation between nodes during trace
- **TraceTimeline** — step-by-step resolution with expandable output block per stage
- **DecisionPathways** — shows current/next stage name
- **Real orchestration** — 7 stages: reception, classification, context assembly, synthesis planning, draft generation, refinement, final output. Each calls the backoffice model with accumulated context.
- **Prometheus** — configured and running (though dashboards not yet built)

## Visual Identity (Applied)

| Token | Value | Role |
|---|---|---|
| `teal-mystic` | `#2dd4bf` | Primary accent, headings, active nodes |
| `solar-gold` | `#f59e0b` | Highlight, completion effects |
| `deep-abyss` | `#0a0a1a` | Background |
| `jade-glow` | `#10b981` | Healthy node state |
| | | |

Glassmorphic panels (`backdrop-blur-xl`, `bg-black/40`). No Three.js — all centre visualisation is SVG + Canvas2D.

## What's Rough / Missing (Designer Attention)

1. **The Solar Nexus works but is visually early-stage** — the SVG components exist and animate correctly but the composition is not yet refined. Layout proportions, glow radii, arc thickness, colour blending, and animation timings all need a designer's eye.
2. **No dashboard panels really — it's a single page with a left sidebar** — vitals panel and prompt input are stacked on the left. The centre visualisation dominates. No right panel exists yet. No secondary screens.
3. **Error states are functional but not beautiful** — when the backoffice is unreachable, telemetry shows `"status":"error"` for remotes; the UI handles it gracefully but the visual treatment is minimal (grey nodes).
4. **No dark/light mode** — only dark.
5. **Trace replay is timed delays on the frontend** — not streaming from backend. This means replay has artificial pauses, not real pipeline timing.
6. **No orchestration history** — traces exist in memory only (ephemeral). No database. No search, no replay of prior runs.
7. **No auth** — fully open.
8. **Prometheus data exists but is unused in the UI** — no dashboards, no charts beyond the basic gauges.
9. **Telemetry URLs are hardcoded** to the server IP — not configurable.

## Technical Constraints for Designers

- **No WebSocket** — router/firewall between server and backoffice kills WebSocket after HTTP upgrade. All telemetry is HTTP polling every 1.5s. For any real-time features, design around polling or SSE.
- **Model context window is 4096 tokens** — long orchestration chains risk overflow.
- **Canvas2D for atmosphere layer** — all other visuals are SVG. If you add heavy animation, keep the Canvas2D path for particle-style effects.
- **Production mode only for LAN access** — Next.js dev HMR kills itself across the network. Any new frontend feature must work in `next start` production mode.
- **Single server deployment** — both frontend and backend on one machine. Scalability is not yet a concern.
- **SVG hydration constraint** — all SVG path coordinates built from `Math.cos`/`Math.sin` must use `.toFixed(4)` to avoid React hydration mismatch between Node.js and browser V8. This is handled in existing components.

## Next-Sprint Ready (What the AI Could Design)

The pipeline works end-to-end and the visual core is in place. I want the designer panel to focus on:

1. **Refining the Solar Nexus composition** — proportions, glow, colour, animation feel. Make it feel sacred and alive rather than "demo of an SVG".
2. **A right-panel design** — what lives there when a trace is active vs when idle. Could show step details, agent thoughts, or resolved output.
3. **Error/empty/loading visual language** — how should unreachable remotes or idle states look beyond grey nodes and text?
4. **A trace history concept** — if we persist runs, how would someone browse past orchestrations?
5. **Sound design** — subtle tones for trace start, step completion, error? (The platform has audio capability but nothing uses it yet.)

Please output design proposals as markdown with SVG or CSS references where applicable. Prioritise what makes the interface feel calm, intelligent, and sacred over what adds information density.
