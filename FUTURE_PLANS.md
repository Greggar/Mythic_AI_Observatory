# Future Plans — Sorted by Priority / Difficulty

Legend: ★☆☆ = quick win, ★★☆ = moderate effort, ★★★ = significant rework

---

## North Star Vision

This Observatory should be the place a user (human or AI agent) goes to *understand* what is happening in their AI ecosystem — both broadly and at single-trace granularity. That means:

- **Health at a glance** — are the systems healthy? Which services are running, overloaded, or offline?
- **Function transparency** — what is each AI actually doing? How does a task flow from prompt to output?
- **Decision interpretability** — *why* did the model do what it did? Which intent was chosen? Which context was used or discarded? What tokens drove the decision?
- **Causal debugging** — when an output is bad, trace back through each stage to find the root cause.
- **Comparative insight** — how do different models behave on the same prompt? What are their characteristic patterns (latency, token efficiency, failure modes)?

We are a long way toward health + function transparency. The items below extend into decision transparency, causal debugging, and comparative insight.

---

## Phase 1 — Quick Wins (★★☆ or less)

| # | Idea | List | Effort | Est. Time |
|---|------|------|--------|-----------|
| 1 | **Hover tooltip on trace dots** — glass card showing timestamp, duration, and domain ✓ *(2026-06-05)* | List 1 | ★☆☆ | 20 min |
| 2 | **Search/filter input** — filter constellation by keyword match against prompt text ✓ *(2026-06-08)* | List 1 | ★☆☆ | 20 min |
| 3 | **Click to highlight a spiral arm** — when clicking a galaxy arm, dim all other arms ✓ *(2026-06-05)* | List 1 | ★☆☆ | 15 min |
| 4 | **Dynamic System Orbit services** — service glyphs and metadata served from backend `/api/services` instead of hardcoded; manual refresh button in panel header to re-fetch ✓ *(2026-06-05)* | List 1 | ★☆☆ | 30 min |
| 5 | **Token Velocity Graph** — line chart tracking generation speed (tok/s) in IntelligencePanel | List 1 | ★★☆ | 1 h |
| 6 | **Delete trace on constellation** — right-click, hover trash icon, or press Delete key ✓ *(2026-06-05)* | List 1 | ★☆☆ | 30 min |
| 7 | **Expand Memory panel on interaction** — when hovering a dot or browsing, the panel smoothly enlarges (scale 1.3x with opaque background) so the galaxy and tooltip have room to breathe ✓ *(2026-06-05)* | List 1 | ★★☆ | 1 h |
| 8 | **Real-time Log Tailing** — dark terminal streaming FastAPI + OpenClaw logs | List 1 | ★★☆ | 1.5 h |
| 9 | **System Orbit hover tooltips** — hover any service glyph or planet to see expanded name, purpose, and status explanation ✓ *(2026-06-05)* | List 1 | ★☆☆ | 30 min |
| 10 | **LAN-distributed architecture research** — investigate best practices for running the observatory over a small network with multiple AI nodes | — | ★★☆ | research + implement |
| 11 | **Context Assembly Viewer enhancement** — syntax-highlighted split-pane (system prompt / assembled context / user input) with token count breakdown per section | — | ★★☆ | 1 h |
| 12 | **Runtime Metrics auto-refresh** — visibility-aware polling (15s interval, stops when tab hidden) to keep throughput/latency/bar chart live | — | ★☆☆ | 15 min |
| 13 | **Service health timeline** — mini sparkline in the Issues tooltip showing ok/err/off proportions over the last N telemetry polls | — | ★☆☆ | 30 min |
| 14 | **Stage descriptions & Assembled Context Viewer** — descriptive tooltips for each orchestration stage explaining what it does ✓ *(2026-06-05)* | — | ★☆☆ | 30 min |
| 15 | **Intent classification probabilities** — show top-3 intent labels and their confidence scores in IntelligencePanel stage 2, so the user sees not just *what* was classified but *how sure* the model was ✓ *(2026-06-07)* | — | ★☆☆ | 30 min |
| 16 | **Used vs discarded chunks indicator** — in Context Synthesis step, tag each retrieved chunk as "used" or "discarded" with a relevance score; show both in the IntelligencePanel breakdown ✓ *(2026-06-07)* | — | ★★☆ | 1 h |
| 17 | **Personality fingerprinting** — over many traces, build a per-model profile: avg latency distribution, token efficiency (output/input ratio), failure mode frequency, typical confidence. Show as a radar or summary card. ✓ *(2026-06-08)* | — | ★★☆ | 1.5 h |
| 18 | **Agentic Step-Level Latency Monitor** — standalone Python script that polls `http://127.0.0.1:8001/api/trace/<id>`, extracts per-stage durations, computes rolling averages, and renders a stacked horizontal bar chart to visualize pipeline bottlenecks. Includes a verification harness with mock data. | — | ★☆☆ | 30 min |
| 19 | **Live trace overlay on latency panel** — overlay the current trace's per-stage durations (as a brighter inner bar or dot) on top of the historical averages in the Step Latency panel, so you can compare the live run against the baseline at a glance. ✓ *(2026-06-06)* | — | ★☆☆ | 30 min |

## Phase 2 — Moderate (★★☆)

| # | Idea | List | Effort | Est. Time |
|---|------|------|--------|-----------|
| 19 | **Vector Distance Graph** — clicking Memory Retrieval opens an interactive cosine-similarity cluster map showing top-5 retrieved chunks ✓ *(2026-06-08)* | List 1 | ★★☆ | 1.5 h |
| 20 | **Context Assembly Breakdown** — split-pane comparison (system prompt / injected context) with token budget meter when clicking Context Synthesis | List 1 | ★★☆ | 1 h |
| 21 | **Model Switcher / Hot-Reload** — toggle agent backend between model runners inline, orbital icon changes to reflect resource weight | List 1 | ★★☆ | 1 h |
| 22 | **Trace Annotations & Collaborative Memory** — attach notes, tags, and ratings to any trace ✓ *(2026-06-05)* | — | ★★☆ | 2–3 h |
| 23 | **Causal tracing** — when a trace produces a bad or unexpected output, click "trace root cause" to highlight the most likely culprit stage (e.g., misclassification in stage 2, missing context in stage 4, poor synthesis in stage 5). Derives from existing step data — no new instrumentation needed. ✓ *(2026-06-07)* | — | ★★☆ | 1.5 h |
| 24 | **Live thought stream** — during orchestration, a real-time scrolling log in the IntelligencePanel showing the exact text flowing through each stage: incoming prompt → classified intent → retrieved chunks → assembled context → raw model output. Like watching the AI think aloud. ✓ *(2026-06-07)* | — | ★★☆ | 1.5 h |

## Phase 3 — Deep Work (★★★)

| # | Idea | List | Effort | Est. Time |
|---|------|------|--------|-----------|
| 25 | **3D Galaxy (Four-Arm Spiral)** — full Three.js 4-arm logarithmic spiral galaxy with OrbitControls, auto-rotation, dense constellation clusters per arm, zoom-dependent label fading | List 2 | ★★★ | 6–8 h |
| 26 | **Single Galaxy with 4 Coloured Arms** — Natural Sciences (blue), Social Sciences (teal), Arts (purple/magenta), Applied Sciences (orange/gold). Core = Universal Knowledge. Particles distributed by log-spiral formula. | List 2 | ★★★ | 4–6 h |
| 27 | **OrbitControls + Zoom-to-Cluster** — smooth camera zoom into an arm to reveal sub-domain constellation clusters with fade labels | List 2 | ★★★ | 4–5 h |
| 28 | **"Thought Stream" Full-Screen Terminal** — clicking the Intelligence panel expands to a full-screen live log viewer with both backend logs and token-velocity chart overlaid | List 1 | ★★★ | 3–4 h |
| 29 | **Comparative mode** — submit the same prompt to two different model providers simultaneously and watch both traces unfold side-by-side. A/B testing for LLMs with real-time comparison of latency, output quality, and stage durations. | — | ★★★ | 3–4 h |

## Phase 2b — Dual-Trace Visualization (Gemini-Inspired) (★★☆)

| # | Idea | Effort | Est. Time |
|---|------|--------|-----------|
| 30 | **Dual-Timeline Workspace** — synchronized side-by-side view pairing the Objective Trace (retrieval scores, system constraints, stage latencies) with the LLM Self-Rationale (intent explanations, path choices) for each stage. Cards scroll together, highlighting the gap between what the model *thought* it did and what the system *actually* did. | ★★☆ | 2–3 h |
| 31 | **Fork in the Road / Decision Tree** — for each decision stage (intent classification, context synthesis, response generation), render a mini decision tree showing the chosen path vs rejected alternatives with the model's stated reasoning for each branch. Visual A/B split (Confrontational vs Transparent, etc.). ✓ *(2026-06-10)* | ★★☆ | 2 h |
| 32 | **"Hover to Reveal the Ghost"** — interactive text-linking: hovering a sentence in the LLM's rationale highlights the corresponding system data in the objective trace and vice-versa. Proves the model's subjective "feeling" about the conversation matches the hard mathematical retrieval data. | ★★☆ | 2.5 h |
| 33 | **Confidence Filter Gauge** — donut/gauge showing the ratio of relevant retrievals to total searches (e.g., 3/5 relevant traces contextualized). If similarity scores are low but the model claims high confidence, the user spots a hallucination risk immediately. | ★☆☆ | 30 min |
| 34 | **The Synthesis Bridge** — highlighted text overlay connecting retrieved data fragments directly to the sentences they influenced in the final output. Proof that system instructions and past context actually shaped the text. | ★★☆ | 1.5 h |
| 35 | **Enhanced Radar Fingerprint** — extend TraceRadar with tone-specific axes (Transparency/Honesty, Conflict Avoidance, Data Constraint Adherence) so each trace has a scannable "fingerprint" that can be compared across runs. | ★☆☆ | 45 min |

## Phase 4 — Polish & Transition Aesthetic (★★☆)

| # | Idea | List | Effort | Est. Time |
|---|------|------|--------|-----------|
| 30 | **Smooth modal transitions** — modals don't pop; SVG geometric lines slide apart and reassemble to frame new data windows | List 1 | ★★☆ | 2 h |
| 31 | **Cluster density along arms** — within each arm, denser particle groups to represent sub-domain constellations (Physics cluster, Biology cluster, etc.) | List 2 | ★★☆ | 2 h |

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

### North Star — Decision Transparency & Comparative Insight (added 2026-06-05)
1. **Intent classification probabilities** — top-3 labels with confidence in stage 2 ✓ *(2026-06-07)*
2. **Used vs discarded chunks** — relevance-tagged retrieval results in Context Synthesis ✓ *(2026-06-07)*
3. **Personality fingerprinting** — per-model profiles (latency, token efficiency, failure modes) ✓ *(2026-06-08)*
4. **Causal tracing** — walk back through stages from a bad output to find root cause ✓ *(2026-06-07)*
5. **Live thought stream** — real-time text flow through each stage during orchestration ✓ *(2026-06-07)*
6. **Comparative mode** — side-by-side A/B of two providers on the same prompt
