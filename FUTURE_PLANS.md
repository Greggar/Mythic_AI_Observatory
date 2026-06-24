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

## Phase 0 — Open-Source Readiness (★☆☆–★★★)

*Critical path items to ship the project to the public. Must be completed before any public release.*

| # | Item | Effort | Est. Time |
|---|------|--------|-----------|
| 1 | **Replace `backend/data/*.json` with template defaults** — `network.json`, `machines.json`, `services.json` currently ship with Gregory Long's network (primary-server, BackOffice, LoungeRoom, Tailscale IPs, specific model tags). Replace with all-`127.0.0.1` defaults and a `TEMPLATE.md` explaining how to configure for a real network. | ★★☆ | 1 h |
| 2 | **Frontend machine names data-driven** — `ResourceConstellation.tsx` has `Gingerlong`, `BackOffice`, `LoungeRoom` as hardcoded string constants. Make it read machine/service data from the API so any network topology is rendered automatically. | ★★☆ | 1.5 h |
| 3 | **`frontend/next.config.ts` cleanup** — `allowedDevOrigins` contains 3 LAN IPs; rewrite proxy hardcodes `localhost:8001`. Both should be driven by `NEXT_PUBLIC_API_URL` or removed. | ★☆☆ | 20 min |
| 4 | **`backend/services/ddc_embeddings.py` / `lcc_embeddings.py` — use config_manager** — both hardcode `OLLAMA_URL = "http://127.0.0.1:11434"` instead of reading from `config_manager.get_ollama_url()`. | ★☆☆ | 15 min |
| 5 | **`backend/services/config_manager.py` — remove hardcoded model fallback** — line 71 defaults to `docker.io/ai/qwen3.5:9B-UD-Q4_K_XL` which is a personal model tag. Replace with `qwen2.5:3b`. | ★☆☆ | 5 min |
| 6 | **`PerformanceInsights.tsx` — data-driven profiles** — contains hardcoded profiles for `qwen2.5:3b` with specific latency thresholds. Should be computed from actual trace data. | ★★☆ | 1 h |
| 7 | **`frontend/.env.example` scrub** — remove references to `192.168.0.237`, primary-server. Default to `http://localhost:8001`. Uncomment the default. | ★☆☆ | 10 min |
| 8 | **Scrub docs of personal infrastructure** — `ARCHITECTURE.md`, `DEVELOPMENT.md`, `STATUS.md`, `METRICS-AND-GRAFANA.md` contain IPs, hostnames, usernames, and absolute paths. Replace with generic examples or templated variables. | ★★☆ | 45 min |
| 9 | **Add first-run / setup state** — detect that `network.json` is still using defaults and show a setup prompt or onboarding flow in the Settings modal. | ★★☆ | 1.5 h |
| 10 | **`tools/latency_monitor.py` — read API_BASE from env** — currently hardcodes `http://127.0.0.1:8001`. Should use `LATENCY_API_URL` env var with that as default. | ★☆☆ | 5 min |
| 11 | **`/tmp/` cache paths configurable** — `ddc_embeddings.py` and `lcc_embeddings.py` write to `/tmp/ddc_category_embeddings.json`. Should use a configurable cache directory via env var or `tempfile`. | ★☆☆ | 10 min |
| 12 | **`restart.sh` — detect venv** — currently hardcodes `.venv/bin/uvicorn`. Should detect or allow override. | ★☆☆ | 10 min |
| 13 | **Replace `phi4-mini` default in SettingsModal** — frontend default model name is `phi4-mini` (line 51). Should default to what the backend returns. | ★☆☆ | 5 min |

## Licensing & Attribution

The project is released under a custom MIT License (see `LICENSE`) that:
- Grants full freedom to **use, copy, modify, merge, publish, distribute, sublicense**, and permit others to do the same
- Allows **commercial and non-commercial** use
- **Prohibits selling the software as a standalone product** — you may charge for hosting, support, integration, or value-added services, but not for the Software itself
- Requires **attribution to Gregory Long** with the unique identifier **greg@mythic-ai.dev** in all copies and derivative works

The unique identifier ensures that any other "Greg Long" cannot claim authorship — the email domain `mythic-ai.dev` is Gregory Long's personal domain.

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
| 12 | **Runtime Metrics auto-refresh** — visibility-aware polling (15s interval, stops when tab hidden) to keep throughput/latency/bar chart live ✓ *(2026-06-08)* | — | ★☆☆ | 15 min |
| 13 | **Service health timeline** — mini sparkline in the Issues tooltip showing ok/err/off proportions over the last N telemetry polls | — | ★☆☆ | 30 min |
| 14 | **Stage descriptions & Assembled Context Viewer** — descriptive tooltips for each orchestration stage explaining what it does ✓ *(2026-06-05)* | — | ★☆☆ | 30 min |
| 15 | **Intent classification probabilities** — show top-3 intent labels and their confidence scores in IntelligencePanel stage 2, so the user sees not just *what* was classified but *how sure* the model was ✓ *(2026-06-07)* | — | ★☆☆ | 30 min |
| 16 | **Used vs discarded chunks indicator** — in Context Synthesis step, tag each retrieved chunk as "used" or "discarded" with a relevance score; show both in the IntelligencePanel breakdown ✓ *(2026-06-07)* | — | ★★☆ | 1 h |
| 17 | **Personality fingerprinting** — over many traces, build a per-model profile: avg latency distribution, token efficiency (output/input ratio), failure mode frequency, typical confidence. Show as a radar or summary card. ✓ *(2026-06-08)* — Enhanced 2026-06-11: linguistic style (verbosity slider, directness slider, formatting DNA donut) and cognitive fingerprint (hedging gauge, lexical diversity) added; performance collapsed under a "Performance & Latency" toggle. | — | ★★☆ | 1.5 h |
| 18 | **Agentic Step-Level Latency Monitor** — standalone Python script that polls `http://127.0.0.1:8001/api/trace/<id>`, extracts per-stage durations, computes rolling averages, and renders a stacked horizontal bar chart to visualize pipeline bottlenecks. Includes a verification harness with mock data. ✓ *(2026-06-06)* | — | ★☆☆ | 30 min |
| 19 | **Live trace overlay on latency panel** — overlay the current trace's per-stage durations (as a brighter inner bar or dot) on top of the historical averages in the Step Latency panel, so you can compare the live run against the baseline at a glance. ✓ *(2026-06-06)* | — | ★☆☆ | 30 min |
| 39 | **Backfill DDC for existing traces** — one-time script that reads `traces.jsonl`, runs the `classify_ddc()` service on each prompt/output, and writes back updated records with DDC metadata ✓ *(2026-06-13)* | — | ★☆☆ | 30 min |
| 40 | **DDC group-by in MemoryConstellation** — `clusterByDdcDomain()` and `clusterByDdcAction()` functions added to the dispatch map; traces without DDC data fall into a configurable default group ✓ *(2026-06-13)* | — | ★☆☆ | 30 min |
| 41 | **Sunburst / Circular Dendrogram view** — first alternative visualization option: radial DDC hierarchy with wedges sized by trace count, zoomable through lineage tiers ✓ *(2026-06-13)* | — | ★★☆ | 2 h |
| 42 | **DDC lineage breadcrumb in tooltip** — expand hover tooltip to show the full DDC lineage (e.g. 000 → 006 → 006.3) when DDC data is available ✓ *(2026-06-13)* | — | ★☆☆ | 15 min |
| 43 | **DDC/LCC Domain as 7th Synesthesia Ring** — add an outermost ring showing the DDC/LCC classification domain (e.g. Natural Sciences, Social Sciences, Arts) colored by main class, bridging the two classification systems into a single visual | — | ★☆☆ | 30 min |
| 44 | **Synesthesia 6-Ring Concentric Chart** — SVG radial visualization replacing the 4-ring grammar diagram with full prompt→response pipeline: Depth → Mood → Syntax → Action Type → Pragmatic Tone → Output Form. Color-bleed strategy, unified legend, portaled tooltip, CSV export ✓ *(2026-06-15)* | — | ★★☆ | 2 h |

| 37 | **Enhanced Personality Profile (linguistic style + cognitive fingerprint)** — expand the current Personality Profiles panel beyond latency metrics into quantifiable stylistic descriptors computed per-model from trace outputs: **Verbosity** (avg token count, laconic ↔ prolix slider), **Formatting DNA** (pie chart: bullet / paragraph / table / code), **Hedging Frequency** (density of cautious qualifiers like "I cannot", "generally speaking"), **Lexical Diversity** (type-token ratio), **Directness** (first-sentence response time), and **Sentiment Baseline** (optimistic/neutral/skeptical undertone). ✓ *(2026-06-11)* — formality index and creativity entropy still require backend token-logit analysis. | — | ★★☆ | 1.5 h |
| 38 | **Four-dropdown History controls (Group by, Prompt, Response, View)** — refactored the single "group by" into four independent selectors: Group by (clustering scheme), Prompt (action/domain facet), Response (action/domain facet), View (visualization type). Backend DDC and LCC embedding classifiers added with Sunburst visualization and Multi-Label mode. ✓ *(2026-06-13)* | — | ★★☆ | 1.5 h |

## Phase 2 — Moderate (★★☆)

| # | Idea | List | Effort | Est. Time |
|---|------|------|--------|-----------|
| 19 | **Vector Distance Graph** — clicking Memory Retrieval opens an interactive cosine-similarity cluster map showing top-5 retrieved chunks ✓ *(2026-06-08)* | List 1 | ★★☆ | 1.5 h |
| 20 | **Context Assembly Breakdown** — split-pane comparison (system prompt / injected context) with token budget meter when clicking Context Synthesis | List 1 | ★★☆ | 1 h |
| 21 | **Model Switcher / Hot-Reload** — toggle agent backend between model runners inline, orbital icon changes to reflect resource weight | List 1 | ★★☆ | 1 h |
| 22 | **Trace Annotations & Collaborative Memory** — attach notes, tags, and ratings to any trace ✓ *(2026-06-05)* | — | ★★☆ | 2–3 h |
| 23 | **Causal tracing** — when a trace produces a bad or unexpected output, click "trace root cause" to highlight the most likely culprit stage (e.g., misclassification in stage 2, missing context in stage 4, poor synthesis in stage 5). Derives from existing step data — no new instrumentation needed. ✓ *(2026-06-07)* | — | ★★☆ | 1.5 h |
| 24 | **Live thought stream** — during orchestration, a real-time scrolling log in the IntelligencePanel showing the exact text flowing through each stage: incoming prompt → classified intent → retrieved chunks → assembled context → raw model output. Like watching the AI think aloud. ✓ *(2026-06-07)* | — | ★★☆ | 1.5 h |
| 45 | **Synesthesia Cross-Ring Correlation Heatmap** — square heatmap showing how classifications across adjacent rings correlate (e.g., does Imperative mood correlate with Direct Execution action? Does Complex Syntax correlate with Technical/Code output?). Reveals systematic coupling between prompt- and response-side rings. Computed from historical trace data. | — | ★★☆ | 1.5 h |
| 46 | **Synesthesia Timeline Evolution** — line/area chart showing how the distribution of each ring's categories changes over chronological trace history. See shifts in user behavior (e.g., more Imperative moods over time) or model response patterns (e.g., shift toward Bulleted formatting). | — | ★★☆ | 1.5 h |

## Phase 3 — Deep Work (★★★)

| # | Idea | List | Effort | Est. Time |
|---|------|------|--------|-----------|
| 25 | **3D Galaxy (Four-Arm Spiral)** — full Three.js 4-arm logarithmic spiral galaxy with OrbitControls, auto-rotation, dense constellation clusters per arm, zoom-dependent label fading | List 2 | ★★★ | 6–8 h |
| 26 | **Single Galaxy with 4 Coloured Arms** — Natural Sciences (blue), Social Sciences (teal), Arts (purple/magenta), Applied Sciences (orange/gold). Core = Universal Knowledge. Particles distributed by log-spiral formula. | List 2 | ★★★ | 4–6 h |
| 27 | **OrbitControls + Zoom-to-Cluster** — smooth camera zoom into an arm to reveal sub-domain constellation clusters with fade labels | List 2 | ★★★ | 4–5 h |
| 28 | **"Thought Stream" Full-Screen Terminal** — clicking the Intelligence panel expands to a full-screen live log viewer with both backend logs and token-velocity chart overlaid | List 1 | ★★★ | 3–4 h |
| 29 | **Comparative mode** — submit the same prompt to two different model providers simultaneously and watch both traces unfold side-by-side. A/B testing for LLMs with real-time comparison of latency, output quality, and stage durations. | — | ★★★ | 3–4 h |
| 36 | **RAG Document Query** — ingest documents (PDF, text, markdown) into a local vector store; the orchestrator retrieves relevant passages alongside past traces during Memory Retrieval. IntelligencePanel shows document source, chunk relevance, and passage-level confidence alongside the existing retrieved-chunks display. Enables comparative confidence analysis: does the model answer more confidently from document sources vs past trace patterns? Natively extends the existing Memory Retrieval / Context Synthesis pipeline — no new stage needed. | — | ★★★ | 4–6 h |

## Phase 2b — Dual-Trace Visualization (Gemini-Inspired) (★★☆)

| # | Idea | Effort | Est. Time |
|---|------|--------|-----------|
| 30 | **Dual-Timeline Workspace** — synchronized side-by-side view pairing the Objective Trace (retrieval scores, system constraints, stage latencies) with the LLM Self-Rationale (intent explanations, path choices) for each stage. Cards scroll together, highlighting the gap between what the model *thought* it did and what the system *actually* did. | ★★☆ | 2–3 h |
| 31 | **Fork in the Road / Decision Tree** — for each decision stage (intent classification, context synthesis, response generation), render a mini decision tree showing the chosen path vs rejected alternatives with the model's stated reasoning for each branch. Visual A/B split (Confrontational vs Transparent, etc.). ✓ *(2026-06-10)* | ★★☆ | 2 h |
| 32 | **"Hover to Reveal the Ghost"** — interactive text-linking: hovering a sentence in the LLM's rationale highlights the corresponding system data in the objective trace and vice-versa. Proves the model's subjective "feeling" about the conversation matches the hard mathematical retrieval data. | ★★☆ | 2.5 h |
| 33 | **Confidence Filter Gauge** — donut/gauge showing the ratio of relevant retrievals to total searches (e.g., 3/5 relevant traces contextualized). If similarity scores are low but the model claims high confidence, the user spots a hallucination risk immediately. ✓ *(2026-06-11)* | ★☆☆ | 30 min |
| 34 | **The Synthesis Bridge** — highlighted text overlay connecting retrieved data fragments directly to the sentences they influenced in the final output. Proof that system instructions and past context actually shaped the text. | ★★☆ | 1.5 h |
| 35 | **Enhanced Radar Fingerprint** — extend TraceRadar with tone-specific axes (Transparency/Honesty, Conflict Avoidance, Data Constraint Adherence) so each trace has a scannable "fingerprint" that can be compared across runs. | ★☆☆ | 45 min |

## Phase 4 — Polish & Transition Aesthetic (★★☆)

| # | Idea | List | Effort | Est. Time |
|---|------|------|--------|-----------|
| 30 | **Smooth modal transitions** — modals don't pop; SVG geometric lines slide apart and reassemble to frame new data windows | List 1 | ★★☆ | 2 h |
| 31 | **Cluster density along arms** — within each arm, denser particle groups to represent sub-domain constellations (Physics cluster, Biology cluster, etc.) | List 2 | ★★☆ | 2 h |

---

## Phase 11 — Chat Traces (★★☆–★★★)

*Extend the observatory from single-prompt traces to full multi-turn chat sessions. Requires research into LLM context maintenance, session management, and content normalization.*

### Core Idea

Currently every trace is a single prompt → response pair. Chat traces would capture an entire conversation with N exchanges, preserving context flow between turns. The user selects "Single Prompt" or "Chat" at the start. Chat sessions get a `chat_id` field (0 = not part of a chat) and an `exchange_index` for turn ordering.

| # | Item | Effort | Est. Time | Notes |
|---|------|--------|-----------|-------|
| 1 | **Chat session model** — `ChatSession` wrapper containing `chat_id`, `exchange_index`, `prompt`, `response`, `parent_trace_id`, `context_summary`. Backend stores sessions as linked trace groups rather than standalone entries. | ★★☆ | 2 h | Core data model |
| 2 | **UI mode selector** — modal/prompt-area toggle between "Single Prompt" and "Chat" mode. Chat mode shows an ongoing session panel with exchange history. | ★★☆ | 1.5 h | UX |
| 3 | **Chat ID generation** — backend assigns `chat_id` on first exchange; subsequent prompts in the same session receive the same `chat_id` with incremented `exchange_index`. A `chat_id` of `0` means not part of a chat (backward-compatible default). | ★☆☆ | 30 min | Plumbing |
| 4 | **Context carry-over** — each exchange receives the previous N exchanges (or tokens) as injected context. Research required: how does each model family (qwen, llama, gpt-oss) handle context window limits? What truncation strategy works? | ★★★ | 4–6 h | Research-heavy |
| 5 | **Per-exchange classification** — run DDC, LCC, synesthesia, mood/intent, intonation on each exchange individually. Aggregate to show how classifications evolve over the conversation (e.g., drifting from Factual Question to Complex Inquiry). | ★★☆ | 1.5 h | Uses existing pipeline |
| 6 | **Chat-level metrics** — aggregate across exchanges: topic drift velocity (how fast DDC/LCC class changes), mood volatility (mood switches per exchange), intent consistency (does the model maintain the same persona?), context utilization (which chunks were retrieved per turn). | ★★☆ | 2 h | Analytics |
| 7 | **Context window research** — study how each deployed model uses its context window across turns. Do responses degrade after N exchanges? At what token count does retrieval quality drop? Document per-model context profiles. | ★★★ | 3–5 h | Research |
| 8 | **Content cleaner (ML)** — optional pre-processing stage that strips pleasantries ("Thanks!", "Sure!", "I'd be happy to...") and offensive language, tagging them as `social_lubricant` or `toxic` with a frequency metric per model/session. Could use a small classifier (all-minilm fine-tune or regex cascade). | ★★☆ | 3–4 h | ML |
| 9 | **Chat timeline visualization** — horizontal timeline showing exchanges as linked cards, with per-exchange classification badges, token counts, and a sentiment/confidence trend line along the bottom. | ★★☆ | 2 h | UI |
| 10 | **Session replay** — replay an entire chat in the IntelligencePanel, showing context accumulation across turns and how the model's reasoning evolves. Each exchange gets its own ForkInTheRoad, ThoughtStream, and TokenVelocity. | ★★★ | 3 h | Polish |

### Architecture Notes

- `chat_id` is a UUID assigned by the orchestrator on session start. The frontend passes it as an optional field in the orchestration request.
- `exchange_index` is a simple incrementing integer per chat_id. The backend enforces ordering and can reject out-of-sequence exchanges.
- The content cleaner (item 8) could piggyback on the existing embedding classifier pattern: train or prompt a small model to classify utterance type (greeting, instruction, clarification, insult, etc.) and strip or flag common boilerplate.
- Per-exchange classification reuses the existing DDC/LCC/synesthesia pipeline. No new models needed — just loop over exchanges in a chat.
- Context window research (item 7) is the critical path item. Without understanding how models degrade over long contexts, the chat trace feature is just cosmetic. This should be started first.

---

## Phase 12 — Batch Trace Processing (★★☆)

*Run a text file of prompts through the full pipeline in headless mode. No animations, no streaming — just fast bulk inference with all post-trace classification applied. Results populate all existing visualisations automatically.*

### Core Idea

The single-prompt UI is great for exploration, but testing a model across 50-100+ prompts is tedious one at a time. A "Batch Run" button accepts a `.txt` file (one prompt per line), queues them through the orchestrator without frontend animations, and notifies the user when all traces + post-processing (DDC, LCC, synesthesia, insight generation) are complete.

| # | Item | Effort | Est. Time | Notes |
|---|------|--------|-----------|-------|
| 1 | **Backend batch endpoint** — `POST /api/traces/batch` accepts `{ file: string, model?: string }`, splits on newlines, submits each prompt to `_orchestrate()` with a `batch_id` tag. Returns immediately with `batch_id`; processing happens asynchronously. | ★★☆ | 1.5 h | ✓ *(2026-06-21)* |
| 2 | **Batch status polling** — `GET /api/traces/batch/{batch_id}` returns `{ total, completed, failed, status: "running"|"done"|"error" }`. Frontend polls until done. | ★☆☆ | 30 min | ✓ *(2026-06-21)* |
| 3 | **Frontend file picker + upload** — drag-and-drop or click-to-upload `.txt` in the prompt area. Shows file name, line count, estimated time (based on historical avg/line). "Run Batch" button starts processing. | ★☆☆ | 45 min | ✓ *(2026-06-21)* |
| 4 | **Headless orchestrator mode** — skip `gen_started_at`, step metadata, live telemetry events when processing batch traces (no frontend needs them). Reduces per-trace overhead. | ★☆☆ | 30 min | ✓ *(2026-06-23)* |
| 5 | **Post-batch notification** — toast or panel update: "Batch {batch_id} complete: 47/50 traces (3 failed)". Failed traces show line number + error message for debugging. | ★☆☆ | 30 min | ✓ *(2026-06-23)* |
| 6 | **Auto-refresh visualisations** — after batch completes, trigger `refreshTrigger` in existing panels so all charts (confusion matrix, heatmap, sunburst, strongest relationships) reflect the new data immediately. | ★☆☆ | 15 min | ✓ *(2026-06-23)* |
| 7 | **Concurrency control** — batch processing should limit concurrent traces to avoid queue timeouts. Configurable `BATCH_CONCURRENCY` env var (default 2). | ★☆☆ | 20 min | ✓ *(2026-06-21)* |

### Architecture Notes

- The orchestrator's `_orchestrate()` is already synchronous — batch mode just calls it in a loop with concurrent workers. No new orchestration logic needed.
- Post-trace classification (DDC, LCC, synesthesia, insights) runs inline per trace as it already does.
- `batch_id` is a UUID stored on each `TraceSession` record. Existing API endpoints already return all traces; filtering by `batch_id` is a simple query param addition.
- Failed traces should still be saved with their error status so the user can see which lines failed.
- Frontend file upload can use a hidden `<input type="file">` with `.txt` accept filter. No need for a complex upload UI.

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

## Session summary — 2026-06-13

- **Embedding-based DDC classification** — `backend/services/ddc_embeddings.py`: 55 DDC categories classified via all-minilm:22m cosine similarity; threshold lowered 0.25→0.10; margin check removed entirely; enriched descriptions fix "rainbow→Physics" (was misclassifying as Religion)
- **Embedding-based LCC classification** — `backend/services/lcc_embeddings.py`: 70+ subclasses; single-letter broad main classes removed (matched everything at 0.12-0.14); HB/HA enriched so "linear regression" maps to Statistics, not Economic Theory; 128/128 traces in 12.9s
- **SunburstChart component** — `frontend/src/components/SunburstChart.tsx`: d3.arc() radial treemap; 2-level (DDC/LCC) + 3-level (Multi-Label); portaled tooltip; click-to-highlight; CSV export
- **Four-dropdown History controls** — Group by (Keywords/DDC/LCC/Multi-Label) + Prompt/Response facets + View (Constellation/Sunburst); dropdown scales for new systems
- **Multi-Label classification** — `classify_multi()` returns top-3 above 0.10; 3-level sunburst with alternative-class outer ring; MemoryConstellation clusters by primary DDC digit; 123/128 traces backfilled in 10.9s
- **CSV export** — all 16 DDC+LCC columns (prompt/response code, label, action, domain); tooltip overflow fix via createPortal to document.body
- **Keyword+Sunburst** — explanatory message shown (no hierarchy for flat clusters)

## Session summary — 2026-06-14

- **Prompt Keyword Clusters removed** — default Group by changed to DDC Facets; keyword-clusters option and sunburst placeholder removed; constellation now clusters exclusively by DDC/LCC main class
- **DDC main class clustering** — `clusterByDDC` changed from domain/action facet combos to DDC first digit (e.g. 000 → Class 0). Same color = same cluster — fixes traces of the same subject being split across groups
- **Constellation colored by DDC/LCC** — dots use the same per-class color palette as SunburstChart (DDC `0`-`9`, LCC `A`-`Z` maps). Glow burst on new traces uses matching class color at 50% opacity
- **Tighter cluster spread** — dot spread reduced from `min(16 + dotCount*5, 55)` to `min(8 + dotCount*2, 20)`. Galaxy scaled to 89% via `translate(140,140) scale(0.89) translate(-140,-140)`
- **Hermes code review fixes** — `api_get_trace` raises `HTTPException(404)`; `context_assembled` = `None` for non-model stages; `stage_avgs` uses `None` instead of `0` for missing stages; `asyncio.get_event_loop().time()` → `perf_counter()`
- **FUTURE_PLANS.md cleanup** — #12 (Runtime Metrics auto-refresh) and #18 (Latency Monitor) marked as done

## Session summary — 2026-06-18 (LLM-Powered Cognitive Synesthesia Classifier)

- **Schema-driven synesthesia classification** — replaced hand-tuned regex (`classifySynesthesiaPrompt`, `classifySynesthesiaResponse`, and 6 grammar-ring classifiers) with a background agent using the local LLM to classify traces against a plain-language schema (`synesthesia_schema.md`). 5 input categories + 5 output categories with 10+ examples each. Editing the schema changes classification behavior — no code changes.
- **Two-tier model strategy** — `qwen2.5:1.5b` (local CPU) for ongoing background polling every 45s; `gpt-oss:20B` on backoffice GPU for bulk backfill (93 traces in ~45s, CONCURRENCY=1 to avoid crashes)
- **Separate cache file** — `synesth_cache.json` stores classifications independently of `traces.jsonl`; merged at API layer via `merge_synesth()` in `api_list_traces`. Backward-compatible: old traces get `synesth: null`.
- **`synesth_domain` field** — added to `TraceSession` model for domain-level aggregation (instruction-following, world-knowledge, creative-writing, technical-analysis, conversational)
- **Backfill complete** — `tools/backfill_synesth.py` classified 93/93 existing traces using backoffice GPU
- **Settings race condition fixed** — `fetchNetworkSources()` added to modal mount effect to fix stale model name in `handleSave` caused by race between `fetchModels` and `fetchNetworkSources`
- **Architecture documented** — added "Session 2026-06-18 — LLM-Powered Cognitive Synesthesia Classifier" section to ARCHITECTURE.md with problem statement, solution architecture, key decisions, problems table, and lessons learned.

### Lessons Learned
- **Schema-driven classification works** — the LLM correctly interpreted the plain-language schema, classifying traces with nuanced understanding that regex couldn't match.
- **Backoffice GPU is ~100x faster** — gpt-oss:20B classified traces in 1.2s each vs 120s+ for qwen2.5:3b on CPU. But it can't handle >1 concurrent request without crashing.
- **State sync is the hardest part** — React state + concurrent API calls + async effects create race conditions that are invisible until the wrong value persists across a save. Always test the "open settings → save without touching anything" path.
- **Separate cache from source of truth** — storing classifications in a separate file (`synesth_cache.json`) avoided coupling to the trace persistence layer and made backfill trivially idempotent.

## Session summary — 2026-06-17 (Analysis/Execution Model Split + Open-Source Prep)

- **Analysis/execution model split** — `ANALYSIS_MODEL` and `ANALYSIS_PROVIDER` in orchestrator.py are independent of the main execution model. Analysis can use a smaller model than the orchestrator.
- **"Analyze with AI" button** — new `POST /api/traces/analyze` endpoint with per-type analysis prompts (cross, synesthesia, mood-intent, intonation, grammar). Frontend shows loading/error/result states per relationship type.
- **Analysis model persistence** — config_manager.py reads/writes analysis model config to `network.json` under `"analysis"` key. Survives server restarts.
- **Open-source readiness** — Phase 0 checklist (13 items) added covering IP/hostname removal, config defaults, env vars, and docs scrubbing.
- **LICENSE file** — custom MIT License prohibiting standalone reselling, requiring attribution to Gregory Long.

## Session summary — 2026-06-12

- **Session review** — comprehensive project summary provided to user covering all panels, infrastructure, and lessons learned
- **TraceRadar "Honesty" → "Dishonesty" axis** — renamed axis label and updated descriptions; HONESTY_PAT regex now described as "self-limiting phrases" with 0 = direct, 1 = evasive framing
- **LLM insight prompt improvements** — added `active_local_model: {LOCAL_MODEL}` to trace data and instruction to use the active model from TRACE DATA; removed model label enrichment from `_build_architecture_context()` to simplify reachable/unreachable display
- **network.json formatting** — prettier array formatting for services lists, unicode em dashes in desc/insight fields

## Session summary — 2026-06-11

- **#13 Service health sparkline** — `EngineStatusPanel.tsx`: rolling 30-sample history of ok/err/off proportions rendered as a stacked SVG bar chart inside the Issues tooltip. Each 3px-wide column = one telemetry poll (~1.5s), green (ok) / red (error) / amber (stopped/disabled) stacked vertically. Visible on hover of the Issues count regardless of whether problems exist.
- **Machine prefix in Issues tooltip** — `main.py:collect_telemetry()` builds a `service_id → machine_name` reverse-lookup from `network.json:machines` and injects it as a `machine` field on each remote telemetry entry. Frontend displays `BackOffice–hermes` instead of bare `hermes`.
- **Sparkline tally fix** — the health sparkline's status tally now checks `detail: "connection_refused"` (maps to amber, not red), matching the existing Issues tooltip logic.
- **#33 Confidence Filter Gauge** — `IntelligencePanel.tsx`: SVG donut chart inside the Memory Retrieval completed-state card showing used/total chunks ratio. Red arc when <50% relevant, teal otherwise. Label shows `{used}/{total} relevant` with `— low confidence` warning when most chunks are discarded. Placed between ChunkDisplay and VectorDistanceGraph.
- **Context Synthesis keyword highlighting** — `IntelligencePanel.tsx`: new `highlightKeyWords()` helper extracts significant words from `trace.prompt` (≥4 chars, excluding ~30 stopwords), cross-references them against step outputs, and wraps matches in teal bold `<span>`. Applied to the processing-state current stage output display. Lets the user see which of their query words the system latched onto during context assembly.
- **JSONL dedup** — `orchestrator.py:load_history()`: reverse-iterates sessions, keeps last occurrence of each trace_id via a `seen` set, then reverses back preserving file order. Before: 109 lines / 58 unique (51 duplicates). After: 58 unique traces. Directly doubles the effective Memory Retrieval pool for similarity search. No write-path changes — the raw file still has duplicates but every read is clean.
- **RAG Document Query (#36)** — added to Phase 3 — Deep Work in FUTURE_PLANS.md. Extends existing Memory Retrieval pipeline to ingest documents into a local vector store alongside past traces.
- **Enhanced Personality Profile (#37)** — `profile.py` adds 10 new fields to `ModelProfile`: `verbosity_score`, `avg_output_tokens`, `formatting_bullet/table/code/prose_pct`, `hedging_freq`, `lexical_diversity`, `directness_score`. Computed per-model from `trace.output`. `PersonalityProfile.tsx` completely redesigned with personality-first hierarchy: Linguistic Style (Verbosity slider, Directness slider, Formatting DNA donut) → Cognitive Fingerprint (Hedging gauge, Lexical Diversity slider) → collapsible Performance & Latency section. Performance is now secondary, one click away.
- **CSV data exports** — three new backend endpoints: `GET /api/export/traces.csv` (all traces with duration, confidence, output length), `profiles.csv` (per-model personality + performance metrics), `stages.csv` (per-stage breakdown with eval counts and resource usage). Plus `traces_with_steps.csv` — one row per trace with dynamic columns for each step's latency. Frontend download buttons in Runtime Metrics panel (`[ traces.csv ]` `[ stages.csv ]` `[ steps.csv ]`) and Personality Profiles panel (`[ export .csv ]`). Data flows through `StreamingResponse` with `text/csv` content type and attachment headers for browser download.
- **Standby mode (idle until observed)** — `main.py`: request-tracking middleware records `_last_activity` on every HTTP request; `_telemetry_loop` checks idle time and drops from 1.5s to 60s polling after 5 minutes of inactivity. On the next request, immediately resumes live telemetry. Frontend `useWebSocket.ts` made visibility-aware — stops polling when the browser tab is hidden, resumes with an immediate fetch when it becomes visible again. Combined effect: when nobody's looking at the dashboard, the observatory sips resources (~1 request/min instead of 40/min).

### Lessons Learned
- **`layout.tsx` had duplicate `<html>` tags** — Next.js 16 App Router auto-generates the `<html>` tag from `layout.tsx`; having a literal `<html>` in the returned JSX created a nested `<html>` in the DOM, causing hydration mismatch and blank page. The fix was to remove the explicit `<html>` wrapper from `layout.tsx`. (Discovered during an earlier session, documented here for completeness.)
- **`_compute_personality` import order in profile.py** — `_compute_personality` references `HEDGE_PATTERNS` and helper functions defined above it in the same module, which works fine. But `compute_profile()` uses a deferred import (`from services.orchestrator import load_history`) inside the function body to avoid circular imports. This pattern works correctly as long as the function is called after the module is fully loaded. If adding new functions that call `compute_profile()`, maintain the same deferred-import pattern.
- **Formatting DNA classification is heuristic** — the bullet/table/code/prose line classifier uses simple regex on each line of `trace.output`. Code fences (` ``` `) toggle an `in_code` flag. This is approximate — mixed-format outputs (e.g., a paragraph followed by a bullet list) will be proportionally correct, but deeply nested markdown may misclassify. Good enough for personality profiling.

## Session summary — 2026-06-10

*(Previous sessions collapsed for length — see git log for full history)*

## Phase 9 — Model-Agnostic Behavioural Mapping (★★☆)

*Shift from passive observation to intentional diagnostic probing. Ground the AI analysis in something credible.*

| # | Item | Effort | Est. Time | Notes |
|---|------|--------|-----------|-------|
| 1 | **Baseline current analysis** — run analysis on real trace data across relationship types; evaluate output against correctness, insight, meaningfulness, credibility, understandability. Identify gaps. | ★☆☆ | 30 min | Phase 1 — no code changes |
| 2 | **Diagnostic Probe Suite** — 6–10 prompts designed to expose default tone, verbosity, structure, constraint adherence, genre, ambiguity resolution. Tagged `source: "diagnostic"` so they appear in all classifiers separately from organic traffic. | ★☆☆ | 1 h | Phase 2 |
| 3 | **Diagnostic background task** — periodic submission of probe suite through normal orchestration pipeline; results flow into all existing views (grammar rings, mood/intent, DDC, LCC, latency). | ★★☆ | 2 h | Phase 2 |
| 4 | **Decouple analysis model** — enforce that the analysis endpoint uses a *different* model than the one being analyzed (break circular self-interpretation). | ★☆☆ | 20 min | Phase 3 |
| 5 | **Analysis system prompt** — "behavioural scientist" persona for the analysis model: frame it as examining another entity's behavior, not self-reflection. Include diagnostic baselines as reference frame. | ★☆☆ | 30 min | Phase 3 |
| 6 | **Stress-test probe suite** — prompts designed to expose failure modes: instruction obedience, precision, multi-step retention, structural reliability, hallucination tendency. | ★☆☆ | 1 h | Future |
| 7 | **Format-probe suite** — enumerate/table/structure expectations | ★☆☆ | 30 min | Future |
| 8 | **Persona-probe suite** — default role, empathy, gatekeeping patterns | ★☆☆ | 30 min | Future |
| 9 | **Reasoning-probe suite** — CoT tendency, confidence calibration, hedging | ★☆☆ | 30 min | Future |

### 2026-06-10
- **StageDebate component** — `frontend/src/components/StageDebate.tsx`: detects polar opposition between Context Synthesis and Response Generation outputs using sentence-level polarity scoring + topic domain overlap (`TOPIC_PAT` regex with words like `previous`, `access`, `history`). Neutral traces show collapsible "No stage conflicts detected ▸ Inspect"; conflicting traces show glowing violet "Internal Debate" panel with side-by-side claims. Exports `detectContradiction()` for reuse.
- **TraceRadar component** — `frontend/src/components/TraceRadar.tsx`: SVG pentagon radar chart with 5 axes (Confidence, Context Relevance, Constraint Adherence, Output Substance, Honesty). Computed from trace step metadata. Always renders in IntelligencePanel completed state with 8pt font labels.
- **History tab blank crash** — debugged: (1) FastAPI route ordering — `/api/traces/profile` AFTER `/{trace_id}`; wildcard caught "profile" as trace ID, returning null; (2) `PersonalityProfile` null guard missing — `profiles.length` on null unmounted entire React tree; (3) `next start` cached stale HTML from old build
- **ForkInTheRoad component** — `frontend/src/components/ForkInTheRoad.tsx`: decision tree visualization for intent classification. Chosen path highlighted in teal with branch line + confidence bar + reasoning; rejected paths dimmed at 50% opacity with strikethrough labels. Shows during processing state in IntelligencePanel
- **Backend prompt update** — intent classification prompt now asks for `reasoning` per intent explaining why each path was chosen/rejected
- **Memory Retrieval re-fix (variable shadowing)** — `orchestrator.py:626`: `for i in range(len(top_chunks))` shadowed outer stage index `i` in vector-graph code (second independent site, not caught by original c5ab0ff fix). Renamed to `vi`/`vj`. Step-4 now correctly marks complete
- **VectorDistanceGraph tooltips** — replaced `useState` mouse tracking with `useRef` to avoid re-renders on every mouse move; tooltip shows colored dot, trace ID, Used/Discarded status, relevance percentage
- **Duplicate React key fixes** — `MemoryConstellation` edge keys used source dot index instead of map index → `c-${ci}-${idx}`. `CelestialDistribution` dot keys used `entry.id` (duplicate trace IDs) → `${id}-${di}`

---

## Phase 10 — ML-Powered Optimizations for LLM Calls (★☆☆–★★☆)

*Replace expensive LLM inference with embedding-based classification or heuristics where quality permits. All items below are inspired by the successful embedding-based intent classifier (step-2: 137s → 73ms).*

| # | Item | Effort | Est. Time | Notes |
|---|------|--------|-----------|-------|
| 1 | **Synesthesia classifier (embeddings)** — replace `classifier_agent.py`'s LLM call (qwen2.5:1.5b, every 45s) with all-minilm embedding similarity. Define 5 input + 5 output categories with descriptions, classify via cosine similarity. Same pattern as `intent_classifier.py`. | ★☆☆ | 2-3 h | Background poller |
| 2 | **Trace narrative (template)** — replace `_generate_trace_explanation()` LLM call with a template that fills in step labels, statuses, durations, and model decisions from structured trace data. | ★★☆ | 3-4 h | ✓ *(2026-06-20)* |
| 3 | **Response rationale (template)** — replace `_generate_response_rationale()` with extractive summary: "Based on intent '{X}' and {N} relevant past traces, the model responded with..." | ★★☆ | 2-3 h | ✓ *(2026-06-20)* |
| 4 | **Performance insights (heuristic)** — replace `_generate_llm_insights()` with rule-based detection: outlier stages (>2× median), slowest stage, failure patterns. Static cards for common cases, LLM fallback for complex ones. | ★★☆ | 3-4 h | ✓ *(2026-06-20)* |

### 2026-06-20
- **Intent classifier (embeddings)** — `backend/services/intent_classifier.py`: 13 intent categories classified via all-minilm cosine similarity, 0.10 threshold, cached embeddings. Step-2 orchestrator: 137s → 73ms.
- **Context Synthesis (removed LLM)** — step-5 model call removed (was 13-74s per trace). Now echoes primary intent as context pass-through.
- **Diagnostic probe profiles (persistence)** — `backend/services/probe_manager.py`: per-model probe result files at `backend/data/model_profiles/{slug}.json`. `tools/run_diagnostic.py` saves results via `save_probe_result()` on completion. 12 probes submitted, 11 completed for qwen2.5:3b baseline.
- **LLM_TIMEOUT 180s → 300s** — to handle queued model calls from concurrent traces on single-CPU inference.
- **Phase 10 #2-4 complete** — all three per-trace post-processing LLM calls replaced:
  - `_generate_trace_explanation()` → template filling step labels, statuses, durations, model decisions, retrieval summary
  - `_generate_response_rationale()` → extractive summary: intent + chunk count + model name + output length/style
  - `_generate_llm_insights()` → heuristic rules: slowest stage (>5s, % of total), error stages, total pipeline time (<5s fast, >120s slow), cold start (first stage >3× median), unreachable services from architecture context
  - Combined saving: ~60-200s of LLM inference per trace eliminated, now completes in milliseconds

---

## Phase 13 — Knowledge Graph Integration (★★★)

*Add a graph database layer (Neo4j or similar) to model relationships between traces, classifications, models, and concepts as a connected knowledge graph.*

| # | Item | Effort | Est. Time | Notes |
|---|------|--------|-----------|-------|
| 1 | **Graph database setup** — deploy Neo4j (or ArangoDB/JanusGraph) as a sidecar service alongside the backend. Define schema: nodes (Trace, Prompt, Model, DDC_Category, LCC_Category, Intent, Synesth_Class) and edges (CLASSIFIED_AS, USED_MODEL, PRECEDES, SIMILAR_TO, CONFUSED_WITH). | ★★★ | 3-4 h | Infrastructure |
| 2 | **Trace ingestion into graph** — after each trace completes, insert/update nodes and edges into the graph. Prompt nodes link to DDC/LCC/Intent nodes via typed edges. Traces link to preceding traces via PRECEDES edges (temporal order). | ★★☆ | 2-3 h | Pipeline |
| 3 | **Classification confusion edges** — when margin < 0.05 between top-2 DDC categories, add a CONFUSED_WITH edge between those category nodes weighted by trace count. Query to find which categories the embedding model systematically conflates. | ★★☆ | 1 h | Graph analysis |
| 4 | **Model behaviour subgraphs** — query the graph for patterns like: "which DDC categories does model X produce shorter responses for?" or "which intents does model Y route to Refusal action?" Expose as graph queries from the API. | ★★☆ | 2 h | Analytics |
| 5 | **Graph visualization UI** — new "Knowledge Graph" tab or view displaying an interactive force-directed graph of the trace ecosystem. Nodes sized by degree, colored by type, edges labeled by relationship. Click to drill into trace details. | ★★☆ | 3-4 h | UI |
| 6 | **Temporal path queries** — "show me how DDC classifications evolved over the last 50 traces" as a path through the graph, not just a list. Visualize topic drift as a walk through the category graph. | ★★☆ | 2 h | Graph + UI |
| 7 | **Recommendation from graph** — given a new prompt, query the graph for similar prompts (via shared DDC/LCC/Intent nodes) and surface their traces as pre-emptive context. Like Memory Retrieval but using graph traversal instead of embedding similarity. | ★★★ | 3-4 h | Research |

## Phase 14 — Model Testing & Benchmarking (★★☆–★★★)

*A dedicated Tests tab for running comparative experiments across models: submit the same task to multiple models and measure how their outputs differ.*

| # | Item | Effort | Est. Time | Notes |
|---|------|--------|-----------|-------|
| 1 | **Tests tab** — new tab alongside Systems / Trace / History / Analysis. Shows a test runner UI: select a prompt, select target models, choose what to measure. | ★★☆ | 2 h | ✓ *(2026-06-23)* |
| 2 | **Multi-model submission** — submit the same prompt to N models in parallel (or sequentially). Each run is a separate trace tagged with `source: "test"` and a shared `test_batch_id`. Store results in the usual trace pipeline so all existing classifiers (DDC, LCC, synesthesia, mood/intent) apply automatically. | ★★☆ | 2 h | ✓ *(2026-06-23)* |
| 3 | **Comparison view** — side-by-side diff of outputs from different models for the same prompt. Highlight divergences: different DDC classifications, different mood/intent, different output structure. Show a mini TraceRadar per model in a grid. | ★★☆ | 2-3 h | ✓ *(2026-06-23)* |
| 4 | **Classification benchmarking** — e.g., "how would different models classify a set of responses?" Submit a fixed set of prompts to models A, B, C. Compare their DDC/LCC classification distributions as a grouped bar chart or confusion matrix (model × category). See which models agree and where they diverge. | ★★☆ | 1.5 h | UI |
| 5 | **Metric aggregation** — per-model aggregates across all test runs: average latency, token efficiency, output length, classification entropy (how spread out DDC scores are). Render as a comparative table with sparklines. | ★★☆ | 1.5 h | UI |
| 6 | **Test suites** — save reusable test prompt sets. Run a suite on demand (e.g., "run the 10 diagnostic probes across all available models"). Results logged per-suite, per-run, with trend lines over repeated runs. | ★★☆ | 2 h | Persistence + UI |
| 7 | **Automated regression detection** — when a model's behaviour changes across test runs (DDC distribution shift, latency spike, output structure change), flag it. Useful for catching model updates or prompt drift. | ★★★ | 3-4 h | Analytics |
| 8 | **Model-as-classifier benchmarking** — test how well models themselves can classify inputs against a fixed schema (DDC, LCC, Intent, etc.) when prompted. Unlike the existing probes (which classify *the model's output*), this tests the model as the classification engine: submit a labeled corpus, prompt each model to classify, measure accuracy vs. ground truth. Useful for orgs evaluating whether an LLM can replace a dedicated metadata classifier. | ★★☆ | 2-3 h | Separate from probe-based tests |

---

## Phase 15 — OpenClaw Integration (★★☆)

*Explore deeper integration between the Observatory and the OpenClaw gateway running on the same machine.*

| # | Item | Effort | Est. Time | Notes |
|---|------|--------|-----------|-------|
| 1 | **Investigate OpenClaw capabilities** — OpenClaw has cron jobs, system events, TaskFlow, webhook plugins, and the `session-logs` skill. Discover which of these can be productively wired to Observatory data (trace events, anomaly detection, model health changes, classification drift alerts). | ★★☆ | 2-3 h | Research |
| 2 | **OpenClaw → Observatory data channel** — pull Observatory trace data into OpenClaw's graph-memory (Neo4j) or session logs for cross-agent reasoning. | ★★☆ | 2-3 h | Integration |
| 3 | **Observatory → OpenClaw alerting** — replace direct Telegram bot calls with OpenClaw's native channel delivery pipeline for log alerts, anomaly notifications, and scheduled digests. | ★☆☆ | 1 h | After investigation |
| 4 | **OpenClaw agent as a supervisor** — use OpenClaw's agent capabilities to run periodic health checks, trigger reclassification backfills, or auto-generate summary reports from Observatory data. | ★★☆ | 2 h | Requires successful investigation |

---

## Phase 16 — Provider-Agnostic Agent API (★★★)

*Define and implement a generic Agent API so the Observatory can work with any agentic AI system, not just OpenClaw.*

| # | Item | Effort | Est. Time | Notes |
|---|------|--------|-----------|-------|
| 1 | **Abstract agent interface** — define a protocol/interface for agent operations: send message, receive response, query status, stream logs, subscribe to events. Model it after a minimal subset of OpenClaw's gateway contract plus Hermes's REST API. | ★★☆ | 2 h | Foundation |
| 2 | **Adapter for OpenClaw** — implement the interface against OpenClaw's WebSocket gateway + admin HTTP RPC. The adapter wraps OpenClaw-specific auth, message formatting, and event subscription into the generic contract. | ★★☆ | 2 h | After phase 15 |
| 3 | **Adapter for Hermes** — implement the interface against Hermes's REST API (BackOffice). Covers the existing hermes-bridge use case. | ★★☆ | 1.5 h | Parallel with above |
| 4 | **Adapter for generic LLM backends** — implement the interface for bare Ollama, OpenAI-compatible, or custom backends without an agent layer. This is the fallback — the Observatory can at minimum submit prompts and collect traces from any LLM endpoint. | ★★☆ | 1.5 h | Useful standalone |
| 5 | **Plugin system** — external adapter packages (npm/Python) that self-register with the Observatory. Third parties can write an adapter for their agent system without modifying core code. | ★★★ | 4-5 h | Advanced |
| 6 | **Unified trace view** — trace sessions from any agent source appear in the same History tab, MemoryConstellation, and IntelligencePanel. The source/agent is a property on the trace, not a different UI. | ★★☆ | 2 h | Once adapters exist |
| 7 | **Cross-agent comparison** — compare behavior across agents (OpenClaw vs Hermes vs bare Ollama) on the same prompt. Show latency, classification divergence, output structure differences. | ★★★ | 2-3 h | Requires phases 14 + 16 |


