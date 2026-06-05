# Future Plans — Sorted by Priority / Difficulty

Legend: ★☆☆ = quick win, ★★☆ = moderate effort, ★★★ = significant rework

---

## Phase 1 — Quick Wins (★★☆ or less)

| # | Idea | List | Effort | Est. Time |
|---|------|------|--------|-----------|
| 1 | **Hover tooltip on trace dots** — glass card showing timestamp, duration, and domain ✓ *(2026-06-05)* | List 1 | ★☆☆ | 20 min |
| 2 | **Search/filter input** — filter constellation by keyword match against prompt text | List 1 | ★☆☆ | 20 min |
| 3 | **Click to highlight a spiral arm** — when clicking a galaxy arm, dim all other arms ✓ *(2026-06-05)* | List 1 | ★☆☆ | 15 min |
| 4 | **Dynamic System Orbit services** — service glyphs and metadata served from backend `/api/services` instead of hardcoded; manual refresh button in panel header to re-fetch ✓ *(2026-06-05)* | List 1 | ★☆☆ | 30 min |
| 5 | **Token Velocity Graph** — line chart tracking generation speed (tok/s) in IntelligencePanel | List 1 | ★★☆ | 1 h |
| 6 | **Delete trace on constellation** — right-click, hover trash icon, or press Delete key ✓ *(2026-06-05)* | List 1 | ★☆☆ | 30 min |
| 7 | **Expand Memory panel on interaction** — when hovering a dot or browsing, the panel smoothly enlarges (scale 1.3x with opaque background) so the galaxy and tooltip have room to breathe ✓ *(2026-06-05)* | List 1 | ★★☆ | 1 h |
| 8 | **Real-time Log Tailing** — dark terminal streaming FastAPI + OpenClaw logs | List 1 | ★★☆ | 1.5 h |
| 9 | **System Orbit hover tooltips** — hover any service glyph or planet to see expanded name, purpose, and status explanation ✓ *(2026-06-05)* | List 1 | ★☆☆ | 30 min |
| 10 | **LAN-distributed architecture research** — investigate best practices for running the observatory over a small network with multiple AI nodes | — | ★★☆ | research + implement |
| 11 | **Context Assembly Viewer enhancement** — syntax-highlighted split-pane (system prompt / assembled context / user input) with token count breakdown per section | — | ★★☆ | 1 h |
| 12 | **Runtime Metrics auto-refresh** — poll traces every few seconds to keep throughput/latency/bar chart live | — | ★☆☆ | 15 min |
| 13 | **Service health timeline** — mini sparkline in the Issues tooltip showing ok/err/off proportions over the last N telemetry polls | — | ★☆☆ | 30 min |
| 14 | **Stage descriptions & Assembled Context Viewer** — descriptive tooltips for each orchestration stage explaining what it does ✓ *(2026-06-05)* | — | ★☆☆ | 30 min |

## Phase 2 — Moderate (★★☆)

| # | Idea | List | Effort | Est. Time |
|---|------|------|--------|-----------|
| 15 | **Vector Distance Graph** — clicking Memory Retrieval opens an interactive cosine-similarity cluster map showing top-5 retrieved chunks | List 1 | ★★☆ | 1.5 h |
| 16 | **Context Assembly Breakdown** — split-pane comparison (system prompt / injected context) with token budget meter when clicking Context Synthesis | List 1 | ★★☆ | 1 h |
| 17 | **Model Switcher / Hot-Reload** — toggle agent backend between model runners inline, orbital icon changes to reflect resource weight | List 1 | ★★☆ | 1 h |
| 18 | **Trace Annotations & Collaborative Memory** — attach notes, tags, and ratings to any trace ✓ *(2026-06-05)* | — | ★★☆ | 2–3 h |

## Phase 3 — Deep Work (★★★)

| # | Idea | List | Effort | Est. Time |
|---|------|------|--------|-----------|
| 19 | **3D Galaxy (Four-Arm Spiral)** — full Three.js 4-arm logarithmic spiral galaxy with OrbitControls, auto-rotation, dense constellation clusters per arm, zoom-dependent label fading | List 2 | ★★★ | 6–8 h |
| 20 | **Single Galaxy with 4 Coloured Arms** — Natural Sciences (blue), Social Sciences (teal), Arts (purple/magenta), Applied Sciences (orange/gold). Core = Universal Knowledge. Particles distributed by log-spiral formula. | List 2 | ★★★ | 4–6 h |
| 21 | **OrbitControls + Zoom-to-Cluster** — smooth camera zoom into an arm to reveal sub-domain constellation clusters with fade labels | List 2 | ★★★ | 4–5 h |
| 22 | **"Thought Stream" Full-Screen Terminal** — clicking the Intelligence panel expands to a full-screen live log viewer with both backend logs and token-velocity chart overlaid | List 1 | ★★★ | 3–4 h |

## Phase 4 — Polish & Transition Aesthetic (★★☆)

| # | Idea | List | Effort | Est. Time |
|---|------|------|--------|-----------|
| 23 | **Smooth modal transitions** — modals don't pop; SVG geometric lines slide apart and reassemble to frame new data windows | List 1 | ★★☆ | 2 h |
| 24 | **Cluster density along arms** — within each arm, denser particle groups to represent sub-domain constellations (Physics cluster, Biology cluster, etc.) | List 2 | ★★☆ | 2 h |

---

## Appendix: All Ideas (Original Grouping)

### From "Agent Nexus, System Orbit, Intelligence Deep-Dive" (List 1)
1. Vector Distance Graph — interactive cosine-similarity cluster map
2. Context Assembly Breakdown — split-pane prompt/context + token meter
3. Engine Status Panel — Docker containers, memory, network charts
4. Model Switcher / Hot-Reload — inline model toggle with icon change
5. Real-time Log Tailing — dual backend terminal stream
6. Token Velocity Graph — tok/s chart with confidence score
7. Smooth modal transitions — geometric line slide-apart animation
8. Floating hover tooltip — glass card on dot hover ✓ *(implemented 2026-06-05)*
9. Click-to-highlight arm — dim inactive arms
10. Search filter input — keyword match on prompts
11. New-trace glow burst ✓ *(implemented 2026-06-04)*
12. Delete trace from constellation — hover trash icon or press Delete key ✓ *(implemented 2026-06-05)*
13. Core glow refinement
14. **Trace Annotations & Collaborative Memory** ✓ *(implemented 2026-06-05)*
15. **System Orbit hover tooltips** — acronym expansion, purpose, status explanation ✓ *(2026-06-05)*

### From "Visual & Interaction Galaxy" (List 2)
1. Four-arm logarithmic spiral — 4 TLDs of knowledge as arms
2. Particles along log-spiral formula per arm
3. Constellation clusters (sub-domains) within each arm
4. Glowing central core nucleus
5. OrbitControls — rotate, pan, zoom
6. Zoom-out sees full 4-arm structure
7. Zoom-in passes through particles into clusters
8. Slow auto-rotation Y-axis idle animation
9. Responsive labels that fade in/out with zoom level
10. Colour coding: Blue (Natural Sciences), Teal (Social Sciences), Purple/Magenta (Arts), Orange/Gold (Applied Sciences)
