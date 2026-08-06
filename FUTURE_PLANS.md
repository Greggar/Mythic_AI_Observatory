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

## Phase 0 — Open-Source Scrub ✓ *(completed)*

All personal infrastructure, IPs, hostnames, model tags, and credentials have been removed. Config templates use `0.0.0.0` / `127.0.0.1` defaults. `install.sh` auto-detects Ollama models. Docs use RFC 5737 documentation IPs where needed.

## Licensing & Attribution

The project is released under the standard MIT License (see `LICENSE`). The copyright notice and permission notice **must** be preserved in all copies or substantial portions of the Software, ensuring Gregory Long's authorship travels with every distribution.

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
| 13 | **Service health timeline** — mini sparkline in the Issues tooltip showing ok/err/off proportions over the last N telemetry polls ✓ *(already built in EngineStatusPanel)* | — | ★☆☆ | 30 min |
| 14 | **Stage descriptions & Assembled Context Viewer** — descriptive tooltips for each orchestration stage explaining what it does ✓ *(2026-06-05)* | — | ★☆☆ | 30 min |
| 15 | **Intent classification probabilities** — show top-3 intent labels and their confidence scores in IntelligencePanel stage 2, so the user sees not just *what* was classified but *how sure* the model was ✓ *(2026-06-07)* | — | ★☆☆ | 30 min |
| 16 | **Used vs discarded chunks indicator** — in Context Assembly step, tag each retrieved chunk as "used" or "discarded" with a relevance score; show both in the IntelligencePanel breakdown ✓ *(2026-06-07)* | — | ★★☆ | 1 h |
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
| 20 | **Context Assembly Breakdown** — split-pane comparison (system prompt / injected context) with token budget meter when clicking Context Assembly ✓ *(2026-06-28)* | List 1 | ★★☆ | 1 h |
| 21 | **Model Switcher / Hot-Reload** — toggle agent backend between model runners inline, orbital icon changes to reflect resource weight ✓ *(2026-06-28)* | List 1 | ★★☆ | 1 h |
| 22 | **Trace Annotations & Collaborative Memory** — attach notes, tags, and ratings to any trace ✓ *(2026-06-05)* | — | ★★☆ | 2–3 h |
| 23 | **Causal tracing** — when a trace produces a bad or unexpected output, click "trace root cause" to highlight the most likely culprit stage (e.g., misclassification in stage 2, missing context in stage 4, poor synthesis in stage 5). Derives from existing step data — no new instrumentation needed. ✓ *(2026-06-07)* | — | ★★☆ | 1.5 h |
| 24 | **Live thought stream** — during orchestration, a real-time scrolling log in the IntelligencePanel showing the exact text flowing through each stage: incoming prompt → classified intent → retrieved chunks → assembled context → raw model output. Like watching the AI think aloud. ✓ *(2026-06-07)* | — | ★★☆ | 1.5 h |
| 45 | **Synesthesia Cross-Ring Correlation Heatmap** — square heatmap showing how classifications across adjacent rings correlate (e.g., does Imperative mood correlate with Direct Execution action? Does Complex Syntax correlate with Technical/Code output?). Reveals systematic coupling between prompt- and response-side rings. Computed from historical trace data. ✓ *(2026-06-25)* | — | ★★☆ | 1.5 h |
| 46 | **Synesthesia Timeline Evolution** — line/area chart showing how the distribution of each ring's categories changes over chronological trace history. See shifts in user behavior (e.g., more Imperative moods over time) or model response patterns (e.g., shift toward Bulleted formatting). ✓ *(2026-06-28)* | — | ★★☆ | 1.5 h |

## Phase 3 — Deep Work (★★★)

> **Note on Galaxy design intent**: The 4-arm spiral is a **browsing metaphor** — a cross between a galaxy and a library. Arms are themed shelves (DDC main classes), not a claim about embedding geometry or emergent knowledge structure. The labels (Natural Sciences, Social Sciences, etc.) are navigation landmarks, not discovered natural laws. OrbitControls + zoom gives spatial memory ("the trace I want was toward the orange arm"). Three.js is just a more immersive alternative to the existing 2D SVG galaxy — no data-fabrication concern.

| # | Idea | List | Effort | Est. Time |
|---|------|------|--------|-----------|
| 25 | **3D Galaxy (Four-Arm Spiral)** — full Three.js 4-arm logarithmic spiral galaxy with OrbitControls, auto-rotation, dense constellation clusters per arm, zoom-dependent label fading | List 2 | ★★★ | 6–8 h |
| 26 | **Single Galaxy with 4 Coloured Arms** — Natural Sciences (blue), Social Sciences (teal), Arts (purple/magenta), Applied Sciences (orange/gold). Core = Universal Knowledge. Particles distributed by log-spiral formula. | List 2 | ★★★ | 4–6 h |
| 27 | **OrbitControls + Zoom-to-Cluster** — smooth camera zoom into an arm to reveal sub-domain constellation clusters with fade labels | List 2 | ★★★ | 4–5 h |
| 28 | **"Thought Stream" Full-Screen Terminal** — clicking the Intelligence panel expands to a full-screen live log viewer with both backend logs and token-velocity chart overlaid | List 1 | ★★★ | 3–4 h |
| 29 | **Comparative mode** — submit the same prompt to two different model providers simultaneously and watch both traces unfold side-by-side. A/B testing for LLMs with real-time comparison of latency, output quality, and stage durations. | — | ★★★ | 3–4 h |
| 36 | **RAG Document Query** — ingest documents (PDF, text, markdown) into a local vector store; the orchestrator retrieves relevant passages alongside past traces during Memory Retrieval. IntelligencePanel shows document source, chunk relevance, and passage-level confidence alongside the existing retrieved-chunks display. Enables comparative confidence analysis: does the model answer more confidently from document sources vs past trace patterns? Natively extends the existing Memory Retrieval / Context Assembly pipeline — no new stage needed. | — | ★★★ | 4–6 h |

## Phase 2b — Dual-Trace Visualization (Gemini-Inspired) (★★☆)

| # | Idea | Effort | Est. Time |
|---|------|--------|-----------|
| 30 | **Dual-Timeline Workspace** — synchronized side-by-side view pairing the Objective Trace (retrieval scores, system constraints, stage latencies) with the LLM Self-Rationale (intent explanations, path choices) for each stage. Cards scroll together, highlighting the gap between what the model *thought* it did and what the system *actually* did. ✓ *(2026-06-25)* | ★★☆ | 2–3 h |
| 31 | **Fork in the Road / Decision Tree** — for each decision stage (intent classification, context synthesis, response generation), render a mini decision tree showing the chosen path vs rejected alternatives with the model's stated reasoning for each branch. Visual A/B split (Confrontational vs Transparent, etc.). ✓ *(2026-06-10)* | ★★☆ | 2 h |
| 32 | **"Hover to Reveal the Ghost"** — interactive text-linking: hovering a sentence in the LLM's rationale highlights the corresponding system data in the objective trace and vice-versa. Proves the model's subjective "feeling" about the conversation matches the hard mathematical retrieval data. ✓ *(2026-06-29)* | ★★☆ | 2.5 h |
| 33 | **Confidence Filter Gauge** — donut/gauge showing the ratio of relevant retrievals to total searches (e.g., 3/5 relevant traces contextualized). If similarity scores are low but the model claims high confidence, the user spots a hallucination risk immediately. ✓ *(2026-06-11)* | ★☆☆ | 30 min |
| 34 | **The Synthesis Bridge** — highlighted text overlay connecting retrieved data fragments directly to the sentences they influenced in the final output. Proof that system instructions and past context actually shaped the text. ✓ *(2026-06-29)* | ★★☆ | 1.5 h |
| 35 | **Enhanced Radar Fingerprint** — extend TraceRadar with tone-specific axes (Transparency/Honesty, Conflict Avoidance, Data Constraint Adherence) so each trace has a scannable "fingerprint" that can be compared across runs. ✓ *(2026-06-28)* | ★☆☆ | 45 min |

## Phase 4 — Polish & Transition Aesthetic (★★☆)

| # | Idea | List | Effort | Est. Time |
|---|------|------|--------|-----------|
| 30 | **Smooth modal transitions** — modals don't pop; SVG geometric lines slide apart and reassemble to frame new data windows | List 1 | ★★☆ | 2 h |
| 31 | **Cluster density along arms** — within each arm, denser particle groups to represent sub-domain constellations (Physics cluster, Biology cluster, etc.) | List 2 | ★★☆ | 2 h |

---

## Phase 11 — Chat Traces (★★☆–★★★)

*Extend the observatory from single-prompt traces to full multi-turn chat sessions. UI keeps a **Single Prompt** tab and a **Chat** tab as *entry points* — both route into the same shared per-trace analysis surface. The backend data model stays unified (`chat_id`/`exchange_index`), so a single prompt is just a chat of length 1.*

### Core Idea

Tabs decide *what you load*, not which panels exist. **Single Prompt** = today's flow (prompt input → deep trace analysis). **Chat** = conversation spine (exchange cards, trajectory overlays, cross-turn links); clicking an exchange loads the *same* panels the Single Prompt tab uses. This reuses the existing History→Trace bridge pattern (click a constellation dot → Trace tab). No duplicated panels, no UI drift.

Backend: every trace gets optional `chat_id` (`None` = standalone, backward compatible) and `exchange_index`. Chat sessions are linked trace groups — no new storage table; `traces.jsonl` entries just carry the two new fields.

### Build Order (each phase ends at a verification boundary)

| # | Item | Effort | Est. Time | Notes |
|---|------|--------|-----------|-------|
| 1 | **TraceSession chat fields** — `chat_id: str | None`, `exchange_index: int | None` on the Pydantic model. Old jsonl entries parse with null fields (chat listings ignore them). | ★☆☆ | 30 min | Foundation |
| 2 | **OrchestrateRequest extension** — optional `chat_id` on POST /api/orchestrate; `orchestrate()` passes it through. Missing chat_id → current single-prompt behavior untouched. | ★☆☆ | 30 min | Backward compatible |
| 3 | **Chat listing endpoints** — `GET /api/chats` (id, exchange count, first prompt, last activity) + `GET /api/chats/{id}` (ordered exchanges). Scan of traces.jsonl; no new storage. | ★★☆ | 1 h | Plumbing |
| 4 | **Chat tab (entry point)** — new nav tab next to Single Prompt; conversation spine with exchange cards + chat input at the bottom. Empty state on first visit. | ★★☆ | 2 h | ✓ done |
| 5 | **Exchange → shared surface routing** — clicking an exchange sets the active tab to the analysis view and loads that trace via the existing `handleHistoryReplay`-style bridge. Zero panel duplication. | ★☆☆ | 30 min | ✓ done |
| 6 | **Chat ID generation** — frontend generates `crypto.randomUUID()` on first message, reuses it for subsequent exchanges (increments `exchange_index`). | ★☆☆ | 30 min | ✓ done (uses `generateId()` with getRandomValues fallback — `randomUUID` only exists in secure contexts) |
| 7 | **Per-exchange classification** — DDC/LCC/synesthesia/mood-intent run per exchange automatically via the existing pipeline; no new models. | ★★☆ | 1 h | ✓ done (each exchange is a full trace through the pipeline; verified live: ddc/intent_probs present per exchange) |
| 8 | **Context carry-over** — v1: the existing memory-retrieval stage treats prior exchanges in the same chat as retrievable context (no raw history injection). v2: explicit truncated history injection per model family. ⚠ **live-observed failure 2026-08-06** (chat `53f3b337`): EX2 ("write the lyrical narrative poem you suggested on the topic we were discussing") generated a generic shadow-cartography poem with no Mars despite EX0's moons-of-Mars response ranking 0.6179 `used: true`; the #1 chunk (0.6466) was the *previous exchange's own meta-commentary* (self-reference pollution). **Root cause (code-read 2026-08-06): content was never delivered, not ignored.** Step-4 appended only a similarity-score summary to `context` (`orchestrator.py`); the actual chunk texts never reached the generator, and chat history was never loaded — each exchange ran in isolation. "used" meant "counted in the summary", not "injected". EX3 only "bridged" because the correction message itself named the topic. **Fix ✓ done (2026-08-06)**: (a) step-4 now injects the used chunks' content (truncated 700 chars, `[Memory Retrieval · rel x.xx]` lines) at `MEMORY_USE_THRESHOLD=0.15`; (b) chat traces now carry prior exchanges into context (`[Chat History]` block, newest-first within `CHAT_HISTORY_CHARS`/`CHAT_HISTORY_EXCHANGES` budgets). Verified live: an elliptical "poem on that topic now" in a fresh 2-exchange chat produced a Prometheus-grounded poem. **Still open**: retrieval-rank hygiene (deprioritize the immediately-preceding exchange / filter self-referential responses from the corpus) — the top-2 chunks were still cross-chat poems, rescued only by the history block. | ★★★ | 4–6 h | Delivery fixed; hygiene open |
| 9 | **Chat-level metrics** — topic drift velocity (DDC/LCC change per exchange), mood volatility, intent consistency, context utilization per turn. | ★★☆ | 2 h | ✓ done — `ChatMetrics` (intent consistency %, DDC main-class drift prompt/response, mood volatility via client-side `classifyMood5`, context utilization + avg relevance per turn, entropy slope/direction sparkline, session summary) |
| 10 | **Conversation trajectory visualizations** — fingerprint drift (TraceRadar multi-trace overlay, already exists), classification evolution (DriftHeatmap, already temporal), mood/entropy trend line. | ★★☆ | 2 h | ✓ done — `ChatTrajectory` (mean/p95 entropy lines + per-exchange intent-colored dots + ΔH/peak summary + portaled tooltip; TraceRadar/DriftHeatmap already reusable) |
| 11 | **Cross-turn reference map** — arc links showing "exchange N responds to M" via SynthesisBridge's word-overlap logic lifted to conversation level. *One of two new viz genres.* | ★★★ | 2.5 h | ✓ done — `ChatReferenceMap` (teal solid arcs = memory retrieval pulled a chunk from an earlier exchange; violet dashed arcs = lexical echo of an earlier output; hover tooltip with sample + relevance; node hover dims non-involved arcs; verified on real 4-exchange chat `971c01bf`) |
| 12 | **Context-source composition** — per-exchange stacked bar: fresh prompt vs memory retrieval vs history carry-over (reuses used/discarded chunk tagging). *Second new viz genre.* | ★★☆ | 1.5 h | ✓ done — `ChatContextComposition` (per-exchange horizontal stacked bar split fresh/history/memory with used solid vs discarded hatched sub-segments, hover tooltip per source, aggregate avg bar; verified on real chat `971c01bf`: memory-dominated → history-dominated arc) |
| 13 | **Chat timeline + session replay** — horizontal timeline of exchanges; replay in IntelligencePanel with per-exchange ForkInTheRoad/ThoughtStream/TokenVelocity. | ★★★ | 3 h | ✓ done — `ChatTimeline` (horizontal exchange rail: intent-colored dots, EX labels, time + per-exchange entropy readout, click-to-load) + session replay controller in `page.tsx` (`playChatReplay` paces each exchange by its real step timings and routes it into the shared analysis surface where `useTraceReplay` already drives ForkInTheRoad/ThoughtStream/TokenVelocity) |

### Verification & Regression Checks (run at every phase boundary)

Backend:
- `cd backend && python -m pytest tests/ -v` — smoke tests (health, `/api/traces`) must stay green after every change.
- New tests added with items 1–3: chat trace round-trip (`POST /api/orchestrate` with chat_id → appears in `GET /api/chats/{id}` in exchange_index order); standalone trace (no chat_id) → absent from all chat listings; old-format jsonl entries load cleanly.
- API shape stability — `/api/traces`, `/api/traces/{id}`, `/api/traces/profile` must not rename or remove fields (frontend types only ever grow, never shrink).

Frontend:
- `npx tsc --noEmit` clean after every change.
- Manual regression walkthrough per phase: (1) all 5 existing tabs still render, (2) Single Prompt orchestration → full analysis identical to pre-chat behavior, (3) History→Trace dot bridge still works, (4) comparative radar still works, (5) no duplicate-key/console errors, (6) Chat tab empty state renders clean.
- New check: a single-exchange "chat" degrades to the identical render as a single prompt (graceful collapse).

Repo hygiene:
- Pre-commit scrub hook stays active (`core.hooksPath hooks`); chat feature adds no machine-specific IPs/hostnames, so commits pass automatically.

### Architecture Notes

- `chat_id` is a UUID generated by the frontend on session start (or by the orchestrator when absent); `exchange_index` is an incrementing integer per chat_id, enforced by the backend (out-of-sequence exchanges rejected).
- The content cleaner idea (from the original Phase 11) remains as a deferred item — it could piggyback on the existing embedding classifier pattern; deliberately dropped from the first cut to keep scope tight.
- Context carry-over (item 8) is the only research-heavy item. v1 uses the existing memory-retrieval stage so the chat ships without it; v2 (per-model context profiles, truncation strategy) can be a follow-up.

---

## Phase 11.5 — Chat Traces Follow-ups (deferred)

- **Context window research** — study how each deployed model (qwen2.5:3b, gpt-oss:20B) uses its context window across turns. Do responses degrade after N exchanges? At what token count does retrieval quality drop? Document per-model context profiles.
- **Content cleaner (collapsible)** — tag pleasantries/offensive language as `social_lubricant`/`toxic` with a frequency metric; original text collapsed behind a labelled badge rather than stripped.

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

### From "Stage Orbit, System Orbit, Intelligence Deep-Dive" (List 1)
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

### From "Stage Orbit, System Orbit, Intelligence Deep-Dive" (List 1)
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
2. **Used vs discarded chunks** — relevance-tagged retrieval results in Context Assembly ✓ *(2026-06-07)*
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
- **Two-tier model strategy** — `qwen2.5:1.5b` (local CPU) for ongoing background polling every 45s; `gpt-oss:20B` on worker GPU for bulk backfill (93 traces in ~45s, CONCURRENCY=1 to avoid crashes)
- **Separate cache file** — `synesth_cache.json` stores classifications independently of `traces.jsonl`; merged at API layer via `merge_synesth()` in `api_list_traces`. Backward-compatible: old traces get `synesth: null`.
- **`synesth_domain` field** — added to `TraceSession` model for domain-level aggregation (instruction-following, world-knowledge, creative-writing, technical-analysis, conversational)
- **Backfill complete** — `tools/backfill_synesth.py` classified 93/93 existing traces using worker GPU
- **Settings race condition fixed** — `fetchNetworkSources()` added to modal mount effect to fix stale model name in `handleSave` caused by race between `fetchModels` and `fetchNetworkSources`
- **Architecture documented** — added "Session 2026-06-18 — LLM-Powered Cognitive Synesthesia Classifier" section to ARCHITECTURE.md with problem statement, solution architecture, key decisions, problems table, and lessons learned.

### Lessons Learned
- **Schema-driven classification works** — the LLM correctly interpreted the plain-language schema, classifying traces with nuanced understanding that regex couldn't match.
- **Worker GPU is ~100x faster** — gpt-oss:20B classified traces in 1.2s each vs 120s+ for qwen2.5:3b on CPU. But it can't handle >1 concurrent request without crashing.
- **State sync is the hardest part** — React state + concurrent API calls + async effects create race conditions that are invisible until the wrong value persists across a save. Always test the "open settings → save without touching anything" path.
- **Separate cache from source of truth** — storing classifications in a separate file (`synesth_cache.json`) avoided coupling to the trace persistence layer and made backfill trivially idempotent.

## Session summary — 2026-06-17 (Analysis/Execution Model Split + Open-Source Prep)

- **Analysis/execution model split** — `ANALYSIS_MODEL` and `ANALYSIS_PROVIDER` in orchestrator.py are independent of the main execution model. Analysis can use a smaller model than the orchestrator.
- **"Analyze with AI" button** — new `POST /api/traces/analyze` endpoint with per-type analysis prompts (cross, synesthesia, mood-intent, intonation, grammar). Frontend shows loading/error/result states per relationship type.
- **Analysis model persistence** — config_manager.py reads/writes analysis model config to `network.json` under `"analysis"` key. Survives server restarts.
- **Open-source readiness** — Phase 0 checklist (13 items) added covering IP/hostname removal, config defaults, env vars, and docs scrubbing.
- **LICENSE file** — updated to standard MIT License.

## Session summary — 2026-06-12

- **Session review** — comprehensive project summary provided to user covering all panels, infrastructure, and lessons learned
- **TraceRadar "Honesty" → "Dishonesty" axis** — renamed axis label and updated descriptions; HONESTY_PAT regex now described as "self-limiting phrases" with 0 = direct, 1 = evasive framing
- **LLM insight prompt improvements** — added `active_local_model: {LOCAL_MODEL}` to trace data and instruction to use the active model from TRACE DATA; removed model label enrichment from `_build_architecture_context()` to simplify reachable/unreachable display
- **network.json formatting** — prettier array formatting for services lists, unicode em dashes in desc/insight fields

## Session summary — 2026-06-11

- **#13 Service health sparkline** — `EngineStatusPanel.tsx`: rolling 30-sample history of ok/err/off proportions rendered as a stacked SVG bar chart inside the Issues tooltip. Each 3px-wide column = one telemetry poll (~1.5s), green (ok) / red (error) / amber (stopped/disabled) stacked vertically. Visible on hover of the Issues count regardless of whether problems exist.
- **Machine prefix in Issues tooltip** — `main.py:collect_telemetry()` builds a `service_id → machine_name` reverse-lookup from `network.json:machines` and injects it as a `machine` field on each remote telemetry entry. Frontend displays machine-prefixed service names instead of bare service IDs.
- **Sparkline tally fix** — the health sparkline's status tally now checks `detail: "connection_refused"` (maps to amber, not red), matching the existing Issues tooltip logic.
- **#33 Confidence Filter Gauge** — `IntelligencePanel.tsx`: SVG donut chart inside the Memory Retrieval completed-state card showing used/total chunks ratio. Red arc when <50% relevant, teal otherwise. Label shows `{used}/{total} relevant` with `— low confidence` warning when most chunks are discarded. Placed between ChunkDisplay and VectorDistanceGraph.
- **Context Assembly keyword highlighting** — `IntelligencePanel.tsx`: new `highlightKeyWords()` helper extracts significant words from `trace.prompt` (≥4 chars, excluding ~30 stopwords), cross-references them against step outputs, and wraps matches in teal bold `<span>`. Applied to the processing-state current stage output display. Lets the user see which of their query words the system latched onto during context assembly.
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
- **StageDebate component** — `frontend/src/components/StageDebate.tsx`: detects polar opposition between Context Assembly and Response Generation outputs using sentence-level polarity scoring + topic domain overlap (`TOPIC_PAT` regex with words like `previous`, `access`, `history`). Neutral traces show collapsible "No stage conflicts detected ▸ Inspect"; conflicting traces show glowing violet "Internal Debate" panel with side-by-side claims. Exports `detectContradiction()` for reuse.
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
- **Context Assembly (removed LLM)** — step-5 model call removed (was 13-74s per trace). Now echoes primary intent as context pass-through.
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
| 9 | **Reasoning fragility probe (GSM-Symbolic method)** — small GSM-8K-derived subset re-parameterized the way Apple's paper does: (a) *symbolic variants* (same reasoning structure, re-randomized names/values), (b) *NoOp clauses* (an added sentence that looks relevant but contributes nothing). Submit all three forms to the same model and compare. Goal: observe reasoning collapse *in our own telemetry* — token entropy spikes on the NoOp clause, the irrelevant clause arriving as a retrieved "used" chunk, DDC margin collapse before a wrong answer — testing whether the paper's behavioural finding (up to 65% accuracy drop from one extra clause) has a mechanistic signature we can see. ✓ **done 2026-08-05** — `backend/services/reasoning_probe.py`: 5 parameterized word-problem templates (clips/fruit/train/pencils/baker) × base/symbolic/noop variants (symbolic re-rolls names + numbers and recomputes the answer; noop appends an entity-neutral distractor-number clause). `POST/GET /api/probe/reasoning` + `GET .../summary` (mirrors the test-run store + semaphore pattern). Per cell: exactness (robust scoring — answer-keyword regex, list-marker skip, and exact-mention check so a correct answer buried in CoT but never restated on its own line still scores right), entropy mean/p95, median `2^H`, DDC prompt margin, token count. `ReasoningProbePanel.tsx` on the Tests tab: model × template chips, live progress, per-model base/symbolic/noop accuracy cards with entropy/2^H/margin + fragility drops (symbolic−base, noop−base), expandable cell detail. Smoke-tested on backoffice `qwen3:latest` — all 3 variants correct; the symbolic-fruit cell reproduced the paper's "computes right, stops before the final line" failure mode, caught by the exact-mention scorer. | ★★☆ | 3-4 h | Reuses Tests tab + test suites; researchRefs `reasoning-fragility` (arXiv:2410.05229) already registered |
| 10 | **Reasoning effort curve (Illusion of Thinking method)** — companion probe: controllable *compositional complexity ladder* (puzzle generators that raise element count / depth while keeping logic identical, per Shojaee et al. 2025 — avoiding GSM-8K contamination) run across a reasoning-capable model + a plain model. Measure per-complexity accuracy *and* our trace shape: thinking tokens (`eval_count`/`token_count`), per-token entropy series, step durations, `2^H` branching factor. Questions: does the paper's counterintuitive *effort peak-then-decline* show up in our entropy/token telemetry? Can we flag the *overthinking regime* (correct answer early, then wasted exploration) as a trace-shape anomaly? Do we reproduce the three regimes (plain beats LRM at low complexity / LRM wins mid / both collapse)? | ★★★ | 4-6 h | Extends item 9 into a complexity ladder; researchRefs `reasoning-fragility` second entry (arXiv:2506.06941) already registered |
| 11 | **Model-runner control layer (swap/load/unload per runner)** — for EVERY inference runner our system can route to (Docker Model Runner, Ollama, vLLM, TGI, llama.cpp-server / any OpenAI-compat), document + script the model lifecycle so multi-model test sessions work: how a model is loaded/unloaded/swapped, idle-timeout/eviction policy, VRAM scheduling behaviour when memory is full (hold-in-flight vs 503 vs spawn-failure), and the health/metrics endpoint the freeze watcher (`tools/backoffice_watch.py`) should sample. **DMR fully mapped 2026-08-06**: CLI `docker model run --detach <full-name>` spawns reliably (verified: `qwen3` loaded, llama.cpp, resident); `docker model ps` shows residents + the idle-unload countdown (e.g. `4 minutes from now` = the **5-minute idle timeout**); `docker model unload [--all]` evicts early. **HTTP-triggered spawn is broken on this box** — a chat-completions request for a NON-resident model hangs silently (>120s, no response) on BOTH `/v1/chat/completions` AND the documented `/engines/v1/chat/completions`, and the held request never appears in the Docker Desktop Models tab ("no requests found"); it sits in the scheduler holding a slot until unload/restart. Resident models serve fast (0.3s) even while a foreign-model request is held (independent runners — the held request does NOT wedge the resident). Native API = `/models/create` (pull), `/models`, `/models/{ns}/{name}` GET/DELETE. **Per-model session workflow (the DMR answer)**: `docker model run --detach <full-name>` → wait for `docker model ps` → run the probe/suite over HTTP against the resident → `docker model unload --all` (or let idle) → preload the next. NEVER request a non-resident model over HTTP — it wedges the scheduler invisibly. **GPU telemetry**: Docker's own Prometheus exporter reads 0% during active generation (blind to the WSL GPU device) — `nvidia-smi` is the real signal and should back the freeze watcher. Ollama/vLLM differ (Ollama keeps every requested model resident with no idle eviction; vLLM pools KV across a model set via continuous batching). Goal: a `per-model test session` script per runner — load → run the probe/suite → unload — so the Phase 14 test matrix doesn't stall on spawn contention. | ★★★ | 3-4 h | Unblocks reliable multi-model benchmarking on the backoffice (single-GPU, DMR-held queues) |

### Notes

- **Items 9-10 came from outside the observatory's own data** — Mirzadeh et al. 2024 (GSM-Symbolic) demonstrates the *behaviour* (reasoning collapse from irrelevant context); Shojaee et al. 2025 (Illusion of Thinking) demonstrates the *effort curve* (reasoning effort peaks then declines near the complexity-collapse point, with an overthinking regime at low complexity). Our pipeline is positioned to explain the *mechanism* of both: which stage — retrieval, classification, generation — carries the failure, and whether the paper's token-budget findings have trace-shape signatures we can flag (entropy series, `eval_count`, `2^H`, step durations). This is the observatory's core move: take a published behavioural finding and reproduce it instrumented.
- **Item 11's lesson** (2026-08-06): "the model is frozen" is often a *runner-scheduling* artefact, not a server hang. DMR deliberately holds requests while it waits for VRAM; Ollama never evicts; vLLM pools. Before blaming a model or adding timeouts, know the runner's load/swap/eviction policy. Each runner our `_resolve_model_endpoint` registry can route to deserves the same swap-forensics treatment the DMR just got (API surface, idle timeout, scheduling, unload path, watcher signal).

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
| 3 | **Adapter for Hermes** — implement the interface against Hermes's REST API. Covers the existing hermes-bridge use case. | ★★☆ | 1.5 h | Parallel with above |
| 4 | **Adapter for generic LLM backends** — implement the interface for bare Ollama, OpenAI-compatible, or custom backends without an agent layer. This is the fallback — the Observatory can at minimum submit prompts and collect traces from any LLM endpoint. | ★★☆ | 1.5 h | Useful standalone |
| 5 | **Plugin system** — external adapter packages (npm/Python) that self-register with the Observatory. Third parties can write an adapter for their agent system without modifying core code. | ★★★ | 4-5 h | Advanced |
| 6 | **Unified trace view** — trace sessions from any agent source appear in the same History tab, MemoryConstellation, and IntelligencePanel. The source/agent is a property on the trace, not a different UI. | ★★☆ | 2 h | Once adapters exist |
| 7 | **Cross-agent comparison** — compare behavior across agents (OpenClaw vs Hermes vs bare Ollama) on the same prompt. Show latency, classification divergence, output structure differences. | ★★★ | 2-3 h | Requires phases 14 + 16 |

---

## Session summary — 2026-06-25 (Synesthesia Cross-Ring Correlation Heatmap)

- **Phase 2 #45 Synesthesia Cross-Ring Correlation Heatmap** — `frontend/src/components/charts/SynesthCorrelationHeatmap.tsx`: 24×24 Pearson correlation matrix across all 6 grammar rings (Depth, Mood, Syntax, Action, Tone, Form). One-hot vectors per trace category, only cross-ring pairs computed (same-ring forced to 0). Teal = positive, red = negative, intensity via sqrt scaling. Filter buttons (\`|r| ≥ 0\` to \`≥ 0.5\`) hide weak correlations. Ring-group dividers with colored headers and matching row labels. Hover tooltip via `createPortal` to `document.body` showing ring name, category, and `r = ±0.xxx`.
- **Axis descriptions** — SVG `<title>` elements on every row label (24 category descriptions) and column header (6 ring descriptions) so users can hover to learn what "Interjection", "Subjunctive", "Direct Execution" etc. mean.
- **Registered in chartOptions.ts** — `"correlation"` chart type added to synesthesia dropdown; `DEFAULT_CHART` unchanged.
- **Wired into RelationshipsPanel** — import + routing branch in the synesthesia charting IIFE after the heatmap block.

### Lessons Learned
- **Pearson on one-hot vectors works for co-occurrence** — a 1/0 vector per category across traces gives correlations that parallel co-occurrence counts. Same-ring categories yield zero by design (mutually exclusive), cross-ring correlations reveal systematic couplings like Imperative → Direct Execution.
- **SVG `<title>` is the simplest tooltip** — no state, no portal, no positioning logic needed for axis labels. Native browser tooltip on hover. Use for labels that need a static explanation; use `createPortal` for data-driven tooltips that need dynamic positioning.
- **Duplicate classifiers are acceptable in a standalone chart component** — rather than importing from RelationshipsPanel (tight coupling), the heatmap duplicates the 6 grammar ring classifiers inline. The classifiers are stable regex and unlikely to drift. This keeps the component self-contained and portable.
- **Response-side rings need response text** — the heatmap requires `output` on each trace. Traces with no output are handled gracefully (defaults to "Conversational Phatic" / "Informative" / "Continuous Prose").

## Session summary — 2026-06-25 (Dual-Timeline Workspace + Cross-Ring Correlation Heatmap)

- **Phase 2b #30 Dual-Timeline Workspace** — `frontend/src/components/charts/DualTimeline.tsx`: synchronized side-by-side cards for each orchestration stage, pairing Objective Trace (teal, system-recorded metrics: duration, tokens, velocity, chunks, confidence) with LLM Self-Rationale (violet, model's stated reasoning: intent explanations, chunk relevance, synthesized intent, response rationale). Vertical timeline line with stage labels on centered pill badges. Overall summary card at end. Wired into IntelligencePanel completed state after trace explanation.
- **Phase 2 #45 Synesthesia Cross-Ring Correlation Heatmap** — 24×24 Pearson correlation matrix across all 6 grammar rings. Teal = positive, red = negative, sqrt intensity. Filter buttons hide weak correlations. SVG `<title>` on every axis label for plain-English descriptions. Portaled tooltip on data cells.

### Lessons Learned
- **The richest self-rationale data is intent_probs** — each intent carries a `reasoning` string explaining why it was chosen/rejected. Even though these are currently template-based (not LLM-generated), they provide a meaningful comparison against the system's recorded metrics.
- **Chunks naturally bridge both columns** — objective metrics (count, avg relevance) belong on the left, while individual chunk content with used/discarded status and relevance sits naturally in the self-rationale column as evidence of what the model *could* have used.
- **Self-contained component keeps IntelligencePanel clean** — the DualTimeline takes a single `TraceSession` and derives all data internally via `useMemo`. No new props or state needed in the parent.
- **Centered timeline with side cards handles variable data density** — stages with rich data (Intent Classification, Memory Retrieval) fill both columns naturally; stages with thin data (Model Routing, Output Packaging) show "No data" gracefully rather than looking broken.

## Session summary — 2026-08-03 (Token Entropy Everywhere + Memory Grounding + Local llama.cpp Node)

- **Token-level uncertainty capture (entropy)** — `_call_openai` in the orchestrator requests top-5 logprobs on every generated token; `_compute_token_entropy()` derives mean entropy, p95, max surprisal, and a per-token series, stored on `TraceSession.token_entropy` + step-6 metadata. Surfaces in `/api/traces/profile` and personality fingerprints (Decisiveness axis).
- **UncertaintySparkline** — `frontend/src/components/UncertaintySparkline.tsx`: mini SVG sparkline of the entropy series in the trace output card; DualTimeline gained per-stage entropy cards.
- **Memory Grounding panel** — `frontend/src/components/charts/MemoryEntropyPanel.tsx`: buckets traces by used/discarded/absent chunks and compares mean entropy across groups (Δ readout + verdict, **always labeled anecdotal** on small samples). New `memory` relationship type wired through RelationshipsPanel, chartOptions (`memory → grounding`), and the Analysis sidebar.
- **Local llama.cpp node** — downloaded llama.cpp b10240 + `Qwen2.5-3B-Instruct-Q4_K_M.gguf` (1.93 GB) to `~/llama-cpp/`; `tools/start_local_llm.sh` runs llama-server on `127.0.0.1:12435` (OpenAI-compat, logprobs, `/health` verified). This makes the **primary** node entropy-capable, not just the backoffice worker.
- **Registry-driven routing** — `_resolve_model_endpoint()` replaces the binary local/worker URL switch with ordered node chains read from `network.json` (`local` prefers `local_llm` → falls back to `ollama`; `worker` → `worker_llm`). Any OpenAI-compat+logprobs node becomes first-class via config.
- **Node-qualified identity** — `session.model_used` is now `<node>/<model>` (`primary/qwen2.5:3b`, `backoffice/gpt-oss:20B`) via `get_service_node()`, so profiles/entropy don't merge same-named models across machines. Legacy traces keep unqualified names.
- **Verified end-to-end** — real trace `699dd317c300` produced `model_used: primary/qwen2.5:3b`, session entropy (mean 0.0101, p95 0.0778, 8 tokens), and a distinct `primary/qwen2.5:3b | n=1 | entropy n=1` profile row.
- **Honest data** — only 2/317 legacy traces carried entropy (both backoffice gpt-oss); the MemoryEntropyPanel excludes entropy-less traces and shows an empty state explaining the corpus predates the feature. Near-zero entropy on canonical facts ("capital of France") is the correct signal.
- **Performance tradeoff** — the i7-6700 CPU generates ~0.63 tok/s on Q4 3B through llama.cpp; slow but honest. `restart_backend.sh` (setsid + disown) restarts uvicorn so it survives the launching shell.

### Lessons Learned
- **Ollama silently drops logprobs** — its OpenAI-compat endpoint returns no `logprobs`/`top_logprobs` field (no error). If a metric needs token probabilities, detect the absence explicitly and route the model through a logprobs-capable node (llama.cpp-server/vLLM/TGI). Entropy through Ollama is silently lost, not absent-by-design.
- **The worker was already a llama.cpp-server** — the backoffice "Docker Model Runner" is actually llama.cpp-server v0.1.0 speaking OpenAI-compat; the same protocol family now serves the local node. Convergence on one protocol (OpenAI-compat + timings + logprobs) is what made a single routing/entropy path possible.
- **Node-qualify at the single assignment point** — `session.model_used` is set in exactly one place (`orchestrate()`), which made qualification a one-line change. A qualified identity is only as good as the registry behind it (`get_service_node`).
- **Registry-driven > hardcoded switch** — a binary `if provider == "local"` can't express fallback chains or admit new nodes without code changes. `_resolve_model_endpoint` reads chains from `network.json`, so adding a node is pure config.
- **`setsid nohup … & disown` for daemons** — agent tools (opencode, CI) kill the whole process group on timeout/shell-exit; inline `uvicorn &` dies when the tool returns. A dedicated script that fully detaches (see `restart_backend.sh`) is the reliable pattern; verify with `ss -ltn` + `/health` curl.
- **Canonical-fact near-zero entropy is a feature** — the model's own token probabilities confirm "The capital of France is Paris" has ~zero uncertainty. That validation makes the entropy signal trustworthy for the traces where it's meaningful.

## Phase 17 — Token-Level Uncertainty & Multi-Node Scaling (★☆☆–★★★)

*The entropy signal now exists on both nodes (primary + backoffice). These items extend it from a per-trace curiosity into a first-class uncertainty lens — and harden the registry routing that made it possible.*

| # | Idea | Effort | Est. Time | Notes |
|---|------|--------|-----------|-------|
| 1 | **Entropy trajectory chart** — line chart of the per-token entropy *series* over the generation (we already store it). See exactly *where* uncertainty spikes mid-generation (e.g. at the first answer token vs. trailing prose). ✓ done | ★☆☆ | 45 min | `EntropyTrajectoryChart.tsx` in TimelineStep |
| 2 | **Entropy ↔ classifier-confidence calibration** — compare embedding margin (DDC/LCC) and intent confidence against response entropy. Are uncertain prompts also low-margin classifications? ✓ done | ★☆☆ | 1 h | `EntropyCalibrationPanel.tsx` (memory → calibration); real-data r≈0 so far, verdict gates at MIN_N=6 |
| 3 | **Entropy-aware analysis prompts** — inject mean/p95 entropy + trajectory into the "Analyze with AI" relationship prompts so the analysis model reasons about the model's uncertainty, not just its text. ✓ done | ★☆☆ | 30 min | `_build_analysis_prompt(entropy_summary=)` + frontend per-trace entropy block |
| 4 | **Health-aware node failover** — `_resolve_model_endpoint` currently uses a hardcoded preferred node per provider. Make the chain read live telemetry reachability so a dead node is skipped at resolution time. | ★★☆ | 1.5 h | Registry + telemetry |
| 5 | **Settings coupling fix** — the Models tab edits `model_provider.model`, but execution actually uses `local_llm.model` when the node is enabled. Wire the Models tab to the node registry (or document per-node model fields) so "change local model" means what it says. | ★★☆ | 1.5 h | SettingsModal + config_manager |
| 6 | **Backfill legacy corpus** — logprobs can't be recovered retroactively; the 317 legacy traces will never have entropy. Option: re-run a diagnostic probe suite through the logprobs node to build an entropy baseline per model. | ★★☆ | 1 h | Probe suite exists (Phase 9) |
| 7 | **Hidden-state probe service** — on-demand endpoint that serves a model's true hidden states (deep-layer probes) for confidence calibration, instead of token-logprob proxies. Deliberately deferred: needs 50+ entropy traces to be worth the complexity; probe runs via a standalone HF-transformers sidecar, not Ollama/llama.cpp. | ★★★ | 4-6 h | Research-heavy |
| 8 | **Memory-grounding significance testing** — the MemoryEntropyPanel verdict is labeled anecdotal until the entropy-bearing corpus grows. Add a Mann-Whitney/t-test + minimum-N gate so the verdict self-upgrades from "anecdotal" to "statistically meaningful" when data allows. | ★★☆ | 1.5 h | Truth over polish |
| 9 | **Cross-node entropy comparability** — document/measure how tokenizer + logprob semantics differ between primary and backoffice nodes; decide whether to normalize before cross-node comparison. | ★★☆ | research | Node-local by default |

---

## Phase 18 — Conversation Phenomena (★☆☆–★★★)

*Shift the unit of observation from the model to the conversation. Everything here builds on data already captured (entropy series, top-5 logprobs, embeddings, per-exchange DDC/LCC/intent, chat sessions) — no new telemetry needed to start. Inspired by Cal, 2026-08-04.*

| # | Item | Effort | Est. Time | Notes |
|---|------|--------|-----------|-------|
| 1 | **Branching factor (effective continuations)** — `2^H` per token from existing logprobs = "how many competing continuations were plausible." Median across the generation is the headline number. Viz: the single glowing stream splits at high-uncertainty tokens. ✓ **done 2026-08-05** — `_compute_token_entropy` now emits `median_branching` + `branching_series` (2^H per downsampled token, aligned with `series`); `TokenEntropy` model + frontend type extended; `EntropyTrajectoryChart` stats row shows `2^H med` and draws a teal stream-fan around the mean line whose half-width grows with (2^H − 1), collapsing to a single thread at near-deterministic tokens; hover shows the live-continuation count per token. | ★★☆ | 1.5 h | Reuses `token_entropy.series` |
| 2 | **Conversation topology** — embed every exchange (all-minilm `embedding` field exists), MDS to 2D (VectorDistanceGraph already does this), then draw the chat's path as an animated landscape. Watch discussions drift topic-space. ✓ **done 2026-08-05** — `ChatConversationTopology.tsx`: per-exchange embeddings → all-pairs cosine distances → MDS (shared `utils/mds.ts`), intent-colored nodes sized by token count, animated comet looping the topic-space path (synced to session replay), per-hop drift labels (`1 − cos`), click-through to the shared analysis surface. "Poetic No" projection: EX2↔EX3 nearest neighbours (sim 0.482, drift 0.518 — the correction stays grounded near the poem) while EX0 diverges (drift 0.784/0.856). | ★★☆ | 2 h | Sequel to ChatTrajectory |
| 3 | **Phase transitions** — label each exchange with a higher-level "phase" (exploration / technical / reflective / creative / meta-analysis / problem-solving), detect where the state shifts, correlate the shift with entropy / retrieval similarity / prompt length. Question to answer: does retrieval similarity above some threshold predict a mode shift? | ★★★ | 3 h | Extends ChatMetrics; the correlation query is the real work |
| 4 | **Surprise score (v1 heuristic)** — quantify topic-jump *magnitude* between consecutive exchanges (DDC main-class distance, not just change/no-change). v2 (research): predictive baseline model → true "expected vs actual" surprise. ✓ v1 done — DDC-dist + intent-flip implementable via ChatMetrics lens | ★★☆ | 2 h | Drift metric exists; jump magnitude is new; seed **correction detector** shipped 2026-08-05 (see note below) |
| 5 | **Emergent vocabulary** — track n-gram/concept first-appearance date + subsequent frequency across prompts, outputs, trace_explanations. "Watch concepts be born, then spread." | ★★☆ | 2 h | Script + time-series viz |
| 6 | **Behaviour Atlas (capstone)** — per-trace behavioural feature vector (entropy, branching, intent stability, DDC drift, grammar rings, ghost-ref rate, tokens, confidence) → cluster across the corpus (k-means/UMAP) → LLM-name the clusters ("Explorer", "Architect", "Mirror") → show a conversation moving between attractors over time. | ★★★ | 4–6 h | Feature vectors already exist; new clustering backend |
| 7 | **Constellations of Minds** — overlay per-model behaviour landscapes ("this region belongs to GPT-OSS, nobody else goes there"). | ★★☆ | 2 h | Extends ComparativeRadarPanel |
| 8 | **Mythic Layer** — name recurring phenomena as UI garnish (high entropy = "The Whispering Forest", self-reference = "The Mirror Pool"). Technical definition must stay visible beside the name. | ★☆☆ | 1 h | Cheap delight; guard truth over polish |
| 9 | **Observatory Journal / self-observation** — scheduled background report (weekly) written by the analysis model over the last N traces: drift, entropy trend, new patterns, notable transitions. Nineteenth-century astronomy journal, automated. | ★★☆ | 2 h | Reuses ANALYSIS_MODEL + insight infra |
| 10 | **North Star — the conversation as phenomenon** — meta-doc framing the observatory's long-term subject as conversation itself (its laws, attractors, ecology), not any particular model. | ★☆☆ | 30 min | Vision note only |
| 11 | **Input-side ambiguity (the operator's branching factor)** — measure prompt-side complexity per exchange (mood: interrogative vs imperative, hedging language, multi-intent density, prompt length) and correlate it with the model's output entropy. Question: do *ambiguous prompts from the human* predict the model's uncertainty spikes? Flips the observatory to observe its operator — the scientist's branching factor. *(added by opencode, 2026-08-04)* | ★★☆ | 2 h | Testable now: prompt + `token_entropy` already captured; reuses ChatMetrics mood/intent extraction |

### Notes

- Deliberately deferred: raw hidden-state probes (already Phase 17 #7); hand-authored phase schemas (item 3 keeps phases simple; item 6 is where structure *emerges* statistically).
- Cal's items 6 + 8 ("Observatory Watching Itself" + "Observatory Journal") are **one engine** — a scheduled analysis-model report — merged into item 9.
- Item 6 is the capstone precisely because items 1–5 feed its feature vector.
- **Correction detector (seed, 2026-08-05)** — `frontend/src/utils/correctionDetector.ts` flags human corrections of the model (validated on the "Poetic No" chat, chat `478badb9`). Three weighted signals: `meta-language` (0.6, correction framing like "I was not intending", "you misunderstood"), `margin-collapse` (0.2, DDC prompt margin < 0.03 = classifier confident-but-near-tie), `self-ref-retrieval` (0.2, prior exchange retrieved as grounding). Threshold 0.6 → meta-language alone is insufficient, corroborators alone are insufficient. Corpus check: fires on exactly 1 of 6 chats' transitions (the true correction), 0 false positives. Rendered as a self-nulling amber strip in ChatMetrics. The finding it encodes: corrections reuse the topic surface, so topic-distance surprise *inverts* for them — the tell is classifier margin collapse + retrieval re-feeding the disputed artifact.

---

## Phase 19 — AI Art Observatory (Generative Image Observability) (★★☆–★★★)

*Status: **DEFERRED** — the LLM phases are the active workstream. Investigation complete; do not start until the LLM roadmap is finished. Full investigation notes + ComfyUI inventory + the LLM→diffusion mapping live in `RESEARCH.md` (see link below).*

*Extend the observatory's "put the black box on a bench" philosophy from text LLMs to diffusion image/video models. The text trace pipeline becomes a second session kind: per-step denoising telemetry instead of per-token. Cross-attention entropy replaces token entropy; CLIP/T5 embedding probes replace DDC/intent classification; DAAM-style attribution replaces SynthesisBridge. The same truth-over-polish rule applies — scalars and downsampled maps, not raw tensors.*

### Core Idea

Where a text trace records tokens, an image trace records **denoising steps** (20–30 for SDXL/Flux, more for Wan video). The harness submits a workflow to ComfyUI (backoffice, RTX 5070 Ti 16 GB) and captures per-step scalars via the existing sampling-hook infrastructure (`advanced/hooks` in the 0.27.0 install), then routes them through the same `traces.jsonl`-style persistence + shared visualization spine. A generation gets a DDC/LCC/synesthesia-style fingerprint of its own: prompt-encoder dominance, per-step attention dispersion, noise-velocity divergence.

### Pre-requisite

- Backoffice ComfyUI reachable from primary over Tailscale (confirmed 2026-08-05). Addresses in `~/.config/opencode/AGENTS.md` — never in the repo (SECURITY.md scrub SOP).

### Build Order (each phase ends at a verification boundary)

| # | Item | Effort | Est. Time | Notes |
|---|------|--------|-----------|-------|
| 1 | **Decision: harness shape** — custom ComfyUI node vs `advanced/hooks` sampling hook vs external API+WebSocket harness. The API route needs zero ComfyUI modification but yields only node-level timing; true cross-attention entropy needs a hook/custom node. | ★★★ | research | First gate |
| 2 | **Image trace model** — per-step scalars: step index, sigma, noise-pred divergence, cross-attention mean entropy, attention sparsity/focus, latent tensor norm. Separate `image_traces.jsonl` or `kind` discriminator on the existing file. | ★★☆ | 2 h | Foundation |
| 3 | **Cross-attention entropy capture** — forward hook on UNet/DiT cross-attention layers; per-step mean entropy + 64×64 downsampled attention heatmaps (the one image artifact worth persisting). *Fresh math — `CrossAttentionEntropy`, not a port of `TokenEntropy`.* | ★★★ | 4–6 h | The hard 20% |
| 4 | **Prompt-encoder probe** — pre-generation CLIP/T5 vector analysis: keyword dominance ("plum" → Fruit 0.82 vs Color 0.12), concept proximity/collision. The image analog of the intent/DDC stage. | ★★☆ | 2–3 h | Reuses embedding-classifier pattern |
| 5 | **Persistence + API** — `/api/image-traces` list/detail mirroring `/api/traces`; scalars only + heatmap refs. Kilobytes, not gigabytes. | ★★☆ | 1.5 h | Plumbing |
| 6 | **Denoising entropy curve** — `UncertaintySparkline` analog over steps; pin the exact timestep where composition locks in vs detail-guessing begins. | ★☆☆ | 45 min | Frontend |
| 7 | **Attention heatmap scrubber** — slider across steps showing 64×64 maps; hover a heatmap cell → which prompt words drive it. The DAAM view. | ★★☆ | 2 h | Frontend |
| 8 | **Diffusion Dual-Timeline** — Objective Trace (per-step scalars) vs Self-Rationale (which prompt tokens hold attention at step N). 1:1 port of the text DualTimeline. | ★★☆ | 2 h | Frontend |
| 9 | **Conditioning/ControlNet influence** — measure injection weight of reference images, IP-Adapter, ControlNet depth/line maps into UNet/DiT layers. Image analog of Context Assembly used/discarded. | ★★★ | 3–4 h | Research-heavy |
| 10 | **CLIP concept-space viz** — sunburst/scatter of prompt-word concept proximity; warn when words collide in latent space (the "Astronomy" misclassification equivalent). | ★★☆ | 2 h | Frontend |
| 11 | **Image fingerprint radar** — TraceRadar analog per generation (attention focus, prompt adherence, structural coherence, detail richness, noise stability); comparative multi-seed/multi-model overlay. | ★★☆ | 2 h | Frontend |
| 12 | **Image corpus analytics** — MemoryConstellation-style gallery over image traces, drift/confusion charts over seeds, models, LoRAs. | ★★☆ | 2 h | Frontend |
| 13 | **Cloud-node parity** — partner API generations (Flux/BFL, Kling, Veo, etc.) through the same trace pipeline for comparative insight. | ★★☆ | 2 h | Extends registry pattern |

### Verification & Regression Checks

- Backend: pytest smoke tests stay green; image-trace endpoints independent of text pipeline (no regressions to `/api/traces`).
- Frontend: `npx tsc --noEmit` clean; all 6 text tabs still render; image tabs are additive.
- Telemetry honesty: absence of a signal (e.g. node without hooks) must render as an explicit empty state, never silently — the Ollama-drops-logprobs lesson applied verbatim.
- Repo hygiene: scrub hook stays active; no Tailscale IPs / machine hostnames enter the repo (they live in AGENTS.md only).

### Links

- Full investigation + inventory + mapping: **`RESEARCH.md`**
- Live infrastructure addresses: `~/.config/opencode/AGENTS.md` (never committed)

---

## Phase 20 — Research Provenance (★★☆☆–★★★)

*The observatory's claims should be traceable to the literature. This phase adds a lightweight citation layer: every panel/metric gets a "why does this exist" reference — the paper that grounds the measurement. A help popover (ⓘ) on panel headers surfaces the citation, its URL, and a plain-language relevance line. Turned-inward ethos: the observatory doesn't just observe models, it documents its own epistemology.*

### Core Idea

A static, frontend-only registry keyed by metric/panel ID maps each measurement to its source. Example — our token-entropy stack is grounded by:

- **Kadavath et al. (2022), "Language Models (Mostly) Know What They Know"** — arXiv:2207.05221. Token-level entropy and conditional log-probabilities directly reflect whether a model "knows" a fact or is guessing. This is the exact justification for `token_entropy`, the EntropyTrajectoryChart, the Decisiveness fingerprint axis, and the entropy-aware analysis prompts.

A `<ResearchPopover>` component (portaled, following the existing tooltip pattern) renders the entry from a ⓘ button in the panel header.

### Build Order

| # | Item | Effort | Est. Time | Notes |
|---|------|--------|-----------|-------|
| 1 | **ResearchRefs registry** — `frontend/src/data/researchRefs.ts`: static `metricId → { title, authors, year, venue, url, relevance }`. Pure frontend, no backend. ✓ done | ★☆☆ | 1 h | Seed with the citations below |
| 2 | **ResearchPopover component** — ⓘ button in panel headers; portaled popover with citation(s), URL link, and one-line relevance in our own words. Reuses the `createPortal` + `fixed` tooltip pattern. ✓ done | ★☆☆ | 1.5 h | Zero data dependencies; click-to-open, outside-click/Esc closes |
| 3 | **Wire the entropy panels first** — EntropyTrajectoryChart, MemoryEntropyPanel, EntropyCalibrationPanel, Decisiveness axis → Kadavath et al. (2022). Then calibration → Guo et al. (2017); memory retrieval → Lewis et al. (2020); DDC/LCC → the classification standards themselves. ✓ done (entropy surfaces) | ★☆☆ | 1 h | Trajectory/Calibration/Memory wired; Decisiveness axis deferred (no header surface yet) |
| 4 | **Editorial rule: truth over polish, applied to provenance** — every ref must (a) be real and verifiable, (b) carry a URL, (c) include a relevance line written in our own words, and (d) be verified before adding. No hallucinated citations — same rule as the metric data. ✓ done | ★☆☆ | 30 min | Enforced at commit review |

### Seed citations

| Metric / panel | Citation | Relevance (our words) |
|---|---|---|
| Token entropy, Decisiveness axis, entropy trajectory | Kadavath et al. (2022), *Language Models (Mostly) Know What They Know*, arXiv:2207.05221 | Token-level entropy / conditional log-probs tell us when the model is guessing vs confident — the foundation of the whole uncertainty workstream |
| Confidence calibration (DDC/LCC margin, intent confidence, EntropyCalibrationPanel) | Guo et al. (2017), *On Calibration of Modern Neural Networks*, ICML | Classifier confidence ≠ accuracy; calibration must be measured, not assumed |
| Memory retrieval (used/discarded chunks, memory grounding) | Lewis et al. (2020), *Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks*, arXiv:2005.11401 | Grounding generation in retrieved context — the architectural basis for the memory stage |
| Entropy itself (definition) | Shannon (1948), *A Mathematical Theory of Communication* | The definition of the quantity every uncertainty panel reports |
| DDC / LCC classification | Dewey Decimal Classification (Melvil Dewey, 1876); Library of Congress Classification (1897) | The ontologies the classifier maps prompts/responses onto |
| (Seed research) Conversation topology | Tomasello (2014) / conversation-analysis literature | The framing for chat-phase phenomena (Phase 18) |

### Verification & Regression Checks

- Frontend: `npx tsc --noEmit` clean; popovers render from registry keys only — a missing key renders nothing, never a crash.
- Every added citation verified to exist before commit (truth over polish).
- Repo hygiene: registry contains only paper URLs (arXiv/DOI/ACM), never infra addresses.



