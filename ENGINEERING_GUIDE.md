# Mythic AI Observatory — Engineering Guide

*Prepared 2026. A plain-but-complete explanation of how the Observatory works, written for answering technical questions from a visiting scientist. Diagrams are described as image-generation prompts at the end.*

---

## 1. What the Observatory Is, in One Paragraph

The Mythic AI Observatory is a self-hosted **observability and introspection platform for a small LLM system**. You give it a prompt, it runs a fixed **7-stage pipeline** (receiving, classifying intent, routing to a model, retrieving relevant memory, assembling context, generating a response, and packaging the output), and it records *everything* that happens during that run — the time each stage took, which model answered, how confident the intent classification was, which historical "memory" chunks were retrieved and whether they were used, the DDC/LCC library-classification of both prompt and response, and a structural grammar analysis of the text. It then visualizes all of that as a web dashboard (the "Solar Interface"), and it can analyze patterns across many traces: model personality profiles, what-if model comparisons, confusion matrices, correlation heatmaps, drift over time, and more.

The design motto is **"truth over polish"** — the tool deliberately shows raw signal, honest margins, and uncertainty rather than hiding it behind slick visuals.

---

## 2. Topology: The Machines and Services

The Observatory spans two machines on a home/LAN network, plus an optional agent gateway.

| Component | Where it runs | Port | Role |
|---|---|---|---|
| **Frontend — "Solar Interface"** | `primary-server` (primary) | **3001** | Next.js dashboard, charts, panels |
| **Backend — "Conductor"** | `primary-server` (primary) | **8001** | FastAPI orchestrator + all logic + telemetry |
| **Ollama (local models)** | `primary-server` | **11434** | Runs small local models (default `qwen2.5:3b`) |
| **Local LLM (llama.cpp)** | `primary-server` | **12435** | Local execution model served via llama.cpp-server — OpenAI-compat + **logprobs** (Ollama can't expose them) |
| **Worker LLM (GPU)** | `backoffice` machine | **12434** | Bigger model on GPU: `docker.io/ai/gpt-oss:20B` |
| **OpenClaw gateway** | `primary-server` | **18789** | Optional agent gateway (SSE) — currently enabled |
| **Prometheus** | `backoffice` | **9090** | Optional metrics source — currently **disabled** (unreachable guard) |

The two machines are defined in a network topology file (`network.json`):
- **`primary`** at `127.0.0.1` — hosts Ollama and OpenClaw.
- **`backoffice`** at `198.51.100.100` — hosts the worker LLM.

Because Prometheus is unreachable from `primary`, the Conductor uses a **circuit breaker**: it probes Prometheus for ~2s, and if unreachable it marks it "unavailable (amber)" and falls back to a healthy status, so the vitals panel responds quickly instead of hanging for 20 seconds.

**Key concept — provider health probing:** the telemetry loop probes every configured LLM provider roughly every ~45 seconds and keeps a reachability flag per provider. Frontend reachability uses OS-level port probing with short timeouts.

---

## 3. The Core Flow: Orchestrating One Prompt

### 3.1 How a request travels

1. The user types a prompt into the Solar Interface (`:3001`).
2. The frontend calls `POST /api/orchestrate` on the Conductor (`:8001`).
3. The Conductor launches an **asynchronous background task** (asyncio) so the request doesn't block the server.
4. The frontend **polls** `GET /api/traces/{trace_id}` every ~1.5 seconds until the trace status is `complete` or `error`.

> **Design note:** The frontend uses **HTTP polling, not WebSockets**, for live updates. (A `/ws/telemetry` WebSocket endpoint exists, but the client intentionally polls REST every 1.5s with visibility-aware rescheduling — when the tab is hidden, polling pauses.) This is more robust than WebSockets across a LAN.

### 3.2 The 7 orchestration stages

The pipeline is fixed and sequential. Only **one** stage actually calls an LLM — the rest are deterministic Python.

| # | Stage | What happens | LLM? |
|---|---|---|---|
| 1 | **Request Received** | Accept and timestamp the prompt | — |
| 2 | **Intent Classification** | Embedding-based classifier assigns intent categories with confidence probabilities (top-3 with confidence scores + reasoning) | No (embeddings) |
| 3 | **Model Router** | Choose which model/provider serves this trace (local vs worker) | No |
| 4 | **Memory Retrieval** | Find past traces similar to the current prompt | No (embeddings) |
| 5 | **Context Assembly** | Build the context window: retrieved chunks + architecture context | No |
| 6 | **Response Generation** | Call the chosen LLM to write the answer | **Yes** |
| 7 | **Output Packaging** | Format/structure the final output, record final metrics | No |

Each stage records: its duration, status, and structured metadata (tokens, confidence, chunk IDs, etc.). The LLM-generated response is *only* produced in stage 6; stages 2 and 5 are lightweight deterministic steps.

### 3.3 Trace persistence

- Completed traces are kept in an in-memory store (`dict[str, TraceSession]`) for instant reads.
- They are also **persisted to `backend/data/traces.jsonl`** (JSON Lines) using in-place line replacement on update.
- The history file is **trimmed at 5MB** to prevent unbounded growth (oldest traces are dropped).

---

## 4. Classification: How the System "Understands" Text

The Observatory uses **embedding-based classification** rather than asking an LLM to label things (for the core classifiers). A **small embedding model (`all-minilm:22m`)** converts text into a vector; then cosine similarity against a fixed set of category descriptions picks the best match. This is fast, deterministic, and free of LLM drift.

> **Key honest-data fact:** all-minilm's 22M-parameter embedding space is *narrow* — typical similarity scores are compressed into the 0.05–0.25 range, and the top two candidates can be within 0.01 of each other. So the system reports a **margin** (winner minus runner-up) and a low **absolute threshold (0.10)**, and it treats low margins as low confidence — truth over polish.

### 4.1 DDC classification (Dewey Decimal Classification)

- **`backend/services/ddc_embeddings.py`** — 55 DDC categories, each with an enriched plain-language description including concrete examples (so "rainbow" maps to Physics/QC, not Religion/200).
- Produces a primary label plus **top-5 candidate scores**.
- Threshold 0.10, no margin requirement (the score distribution is too compressed for margin checks to be meaningful).

### 4.2 LCC classification (Library of Congress Classification)

- **`backend/services/lcc_embeddings.py`** — 70+ LCC subclasses (e.g., HA = Statistics, HB = Economic Theory).
- **Single-letter main classes (Q, H, ...) were deliberately removed**: their generic descriptions matched nearly every prompt at 0.12–0.14 similarity. The main class is now derived from the *first letter* of the chosen subclass.

### 4.3 Intent classification

- **`backend/services/intent_classifier.py`** — embedding-based intent categories with confidence scores, returned as top-3 probabilities with reasoning in stage 2.

### 4.4 Synesthesia grammar classification

A **6-ring structural grammar schema** describes the *shape* of text, prompt→response:

| Ring | Dimension | Categories |
|---|---|---|
| 1 | **Depth** | Interjection / Minor Sentence / Full Verb Phrase |
| 2 | **Mood** | Imperative / Indicative / Interrogative / Conditional / Subjunctive |
| 3 | **Syntax** | Simple / Compound / Complex |
| 4 | **Action Type** | Direct Execution / Conversational Phatic / Refusal / Guardrail |
| 5 | **Pragmatic Tone** | Informative / Instructional / Creative / Analytical / Corrective |
| 6 | **Output Form** | Structured / Bulleted / Continuous Prose |

There are **two implementations** of the synesthesia classifier:

1. **Client-side regex classifiers** (in the frontend `RelationshipsPanel` and a standalone correlation heatmap) — fast, deterministic, used for charts.
2. **LLM-powered background classifier** (`backend/services/classifier_agent.py`) — runs a local small model (`qwen2.5:1.5b`) in the background every ~45s against a plain-language **editable schema** (`backend/services/synesthesia_schema.md`). Editing the schema file changes classification behavior without code changes. It also computes a **`synesth_domain`** field (e.g., instruction-following, creative-writing, technical-analysis, conversational).

The LLM classifier writes to its own cache (`backend/data/synesth_cache.json`), which is **merged** with traces at the API layer — backward compatible (old traces get `synesth: null`).

### 4.5 Multi-label classification

A dedicated `classify_multi()` returns the **top-3 categories above threshold**, used for a 3-level sunburst visualization (primary main class → primary category → alternative main class). The single `classify()` early-returns on the best match, so it can't be reused for multi-label.

---

## 5. Memory Retrieval and Context Assembly

This is the system's "memory." During stage 4:

- The current prompt is embedded.
- Past traces are compared by **word-overlap similarity** (and embedding cosine similarity for the vector graph).
- The top chunks are tagged **`used`** (relevance ≥ 0.08) or **`discarded`**.
- A **vector graph** is built: points (past traces) connected by edges weighted by embedding cosine similarity.

Because chat exchanges are ordinary traces, **prior turns in the same chat are naturally retrievable** here — cross-turn influence is implicit via this stage (no raw history injection). The "context-source composition" idea (Phase 11, item 12) would make exactly this per-turn retrieval visible.

During stage 5, retrieved chunks and the **architecture context** (a live description of which network services are reachable) are interleaved into the prompt that goes to the LLM in stage 6.

---

## 6. Model Profiles: "Personality Fingerprinting"

The Observatory computes a **behavioral fingerprint** per model over many traces:

- **Quick stats:** count, average latency, p50/p95/p99 latency, tokens, failure rate, confidence.
- **Per-stage averages:** how long each orchestration stage takes for that model.
- **Hedging patterns** (`HEDGE_PATTERNS`): counts of self-limiting/evasive language in outputs.
- Exposed via `GET /api/traces/profile` (frontend `PersonalityProfile` panel).

These profiles power comparisons of how different models *behave*, not just how fast they are.

---

## 7. Relationship Analysis ("Analyze with AI")

For each trace there are 5 **relationship types** describing how prompt properties relate to response properties:

| Relationship | Question it answers |
|---|---|
| **cross** | Persona tensions between prompt and response |
| **synesthesia** | 2D→3D / structure shifts between input and output |
| **mood-intent** | How mood maps to intent |
| **intonation** | Tone analysis of the output (CoPilot-style) |
| **grammar** | Structural patterns |

The user clicks **"Analyze with AI"** → `POST /api/traces/analyze` → the Conductor generates a **type-specific LLM prompt** (`_build_analysis_prompt()`) and produces structured analysis.

**Important: analysis uses its own model** — `ANALYSIS_MODEL` / `ANALYSIS_PROVIDER` are independent of the execution model. Analysis settings persist in `network.json` under an `"analysis"` key so they survive restarts.

**Sample-size honesty:** if the sample of traces is small, the analysis *explicitly discloses it*: N < 10 forces an "anecdotal sample" disclaimer; N < 30 forces cautious-language instructions (`SAMPLE_SIZE_THRESHOLD = 30`). This is the "truth over polish" ethos applied to the LLM's own output.

---

## 8. What-If Testing: The Model-as-Classifier Lab

- **Diagnostic probes** (`backend/data/diagnostic_probes.json`) — a fixed corpus of test prompts.
- **Test Runner** — `POST /api/tests/run` runs a set of probes across **multiple models concurrently**, then compares results in the `TestComparison` panel.
- **Model-as-classifier** (`backend/services/classify_task.py`) — a background task that prompts each model to *classify* inputs against DDC/LCC/Intent schemas, measuring accuracy vs ground truth. Useful for evaluating whether an LLM could replace the dedicated embedding classifiers. Results are ephemeral (in-memory), limited to 20 traces, with a 60s per-call timeout.
- `POST /api/tests/classify` + `GET /api/tests/classify/{task_id}` drive the grid: **probes × models × traces**.

---

## 9. The Dashboard ("Solar Interface")

### 9.1 Tabs

The frontend is organized into tabs (header toggle):

- **Systems tab** — vitals, runtime metrics, system orbit, activity feed.
- **Single Prompt tab** — nexus/prompt input, timeline, intelligence, memory constellation.
- **Chat tab** — multi-turn conversation spine with per-session trajectory + metrics (below).
- **History tab** — the full trace archive, memory constellation, trace table, personality profiles.

Chat is a **two-entry-point → shared render layer** design: Single Prompt and Chat both load traces into the *same* analysis panels. A chat exchange is just a trace with `chat_id`/`exchange_index`; clicking an exchange (or a trajectory dot) routes it into the identical surface the Single Prompt tab uses — zero panel duplication. A standalone prompt is formally a chat of length 1.

### 9.2 Key panels

| Panel | What it shows |
|---|---|
| **PromptInput / BatchInput** | Single prompt or batch submission |
| **SolarNexus** | The active trace, step-by-step with orbital animation |
| **TraceTimeline** | Chronological stage timeline |
| **IntelligencePanel** | Stage descriptions, intent confidence bars, fork-in-the-road decision tree, live thought stream, causal tracing (finds root cause of failures), Dual-Timeline workspace, Synthesis Bridge (sentence→chunk links), radar chart |
| **MemoryConstellation** | Dot map of every historical trace (dots colored/grouped by DDC/LCC/multi-label/keyword cluster); dot size = trace age; click to jump to that trace |
| **TraceTable** | Sortable/filterable pivot table of all traces with classification badges + confidence dots; per-trace document download |
| **ResourceConstellation** | System orbit of machines/planets (including the OpenClaw "sentinel" satellite); dynamic orbit radii, portaled tooltips |
| **SystemVitalsPanel** | Machine vitals + virtual "Trace Logs" machine |
| **EngineStatusPanel** | Throughput, latency, error count, mini duration bar charts (15s visibility-aware auto-refresh) |
| **LatencyBreakdown** | Per-stage colored progress bars + live-trace overlay |
| **PerformanceInsights** | Heuristic rules + LLM-generated insight cards |
| **PersonalityProfile** | Per-model behavioral fingerprints |
| **ChatPanel** | Multi-turn conversation spine — EX-# exchange cards with model/DDC/LCC/entropy chips, ⌘+Enter input, "New chat". Clicking a completed exchange loads it into the shared analysis surface |
| **ChatTrajectory** | Per-session entropy arc — mean entropy line (teal area) + p95 band, dots colored by intent, ΔH + peak summary, clickable intent strip, portaled tooltip. The 4-turn chat that inspired it: open 0.391 → tension 0.443 → meta-pivot 0.548 → reconnection 0.467 |
| **ChatMetrics** | Per-session KPIs — intent consistency %, DDC main-class drift (prompt/response), mood volatility (client-side `classifyMood5`), context utilization + avg relevance per turn, entropy slope/direction sparkline, session summary (tokens, runtime, models) |
| **ChatReferenceMap** | Cross-turn arc diagram — teal solid arcs show Memory Retrieval pulling a chunk from an earlier exchange in the same chat (ground truth); violet dashed arcs show a later exchange lexically echoing an earlier output (SynthesisBridge word-overlap lifted to conversation level). Hover an arc for sample + relevance/overlap; node hover dims non-involved arcs |
| **ChatContextComposition** | Per-exchange context-source stacked bar — fresh prompt vs history carry-over (chunks from earlier exchanges in the same chat) vs external memory (chunks from other traces), estimated token weights with used chunks solid and discarded hatched at 0.35× weight. Hover a segment for the source breakdown + chunk samples; aggregate avg bar across the session |
| **ChatTimeline** | Horizontal exchange rail — intent-colored dots, EX labels, time + per-exchange entropy readout, click-to-load. "Replay session" paces every complete exchange into the shared analysis surface: the loop lives in `page.tsx` (`playChatReplay`, paced by each exchange's real step timings) because switching to the Trace tab unmounts the chat components; `useTraceReplay` then drives ForkInTheRoad/ThoughtStream/TokenVelocity per exchange |
| **RelationshipsPanel** | The 6 relationship charts (below) + per-type "Analyze with AI" + classifier profile |
| **CelestialDistribution** | Distribution of model usage over time |
| **ActivityFeed** | Live event feed |
| **DiscoveryEvents** | Newly discovered machines/events |
| **TestRunner / TestComparison** | What-if model testing UI |
| **TraceSummaryModal** | Full trace document viewer |
| **LogTerminal** | Real-time log stream (`$_` button in header) — SSE-driven, filter/search/pause/auto-scroll |

### 9.3 Chart gallery (in RelationshipsPanel)

- **Confusion Matrix** — 3-mode normalization (total/row/col), totals row+column, inline % toggle, CSV export.
- **Sunburst** — 2- or 3-level radial treemap (DDC/LCC/multi-label), portaled tooltip, CSV export.
- **Drift Heatmap / Drift Scatter** — temporal evolution of classification over time.
- **Correlation Heatmap** — 24×24 Pearson matrix across the 6 grammar rings; reveals couplings like Imperative → Direct Execution.
- **Sankey** — 7-column flow from Depth→Mood→Syntax→Action→Tone→Form→DDC.
- **Grouped bars / stacked bars / chord / timeline** per relationship type.
- **Fingerprint radar** — multi-trace comparative radar (5/7 axes: Confidence, Context Relevance, Constraint Adherence, Output Substance, Honesty, + more).
- **Token velocity, drift, embedding confusion profile** (margin-based near-tie analysis).
- **Memory Grounding** (`MemoryEntropyPanel`, analysis type `memory`) — compares response **token entropy** conditioned on whether retrieved memory chunks were `used`, `discarded`, or absent. Grouped mean/p95 entropy bars with a Δ(used − discarded) readout and a verdict string that discloses small samples ("treat as anecdotal"). Lower entropy when chunks are used = evidence that memory grounds responses. CSV export + portaled per-group tooltip (traces, p95, surprisal, uncertain-token ratio, model mix). Honest-data rule: traces without `token_entropy` are excluded, and the empty state explains the corpus predates the feature.
- **Entropy trajectory** (`EntropyTrajectoryChart`, in TimelineStep "Response Generation" step) — full SVG line+area of the per-token entropy `series` over the generation, with mean/p95 dashed reference lines, an amber peak marker mapped back to its output word, and a stats row (peak @ token, mean, p95, n). Replaces the old `UncertaintySparkline` mini-sparkline in the step view.
- **Entropy ↔ classifier-confidence calibration** (`EntropyCalibrationPanel`, analysis type `memory` → `calibration`) — scatter mini-plots of mean entropy vs each classifier confidence metric (DDC prompt/response margin, LCC prompt margin, intent confidence), Pearson r per metric, CSV export, and a verdict that self-upgrades past the anecdotal gate (MIN_N=6). Real corpus (n=9): r≈+0.03 / −0.02 — correctly reports the two signals are independent so far.
- **Research provenance** (`ResearchPopover` + `researchRefs.ts`) — a quiet ⓘ glyph on panel headers opens a portaled glass popover citing the paper(s) that ground each metric (Kadavath 2022 → entropy, Guo 2017 → calibration, Lewis 2020 → memory retrieval), with URL link and a relevance line written in our own words. Registry-driven: a missing key renders nothing. Rule: citations must be real and verified before commit.

Each chart type is registered in `frontend/src/data/chartOptions.ts` with a `DEFAULT_CHART` per relationship type.

---

## 10. Telemetry, Vitals, and the Event System

- **Telemetry loop** (backend, asyncio task): polls active/passive providers every **1.5s while active**, drops to **60s standby after 300s idle**.
- **Vitals collection** (`backend/services/vitals.py`): assembles per-machine vitals plus the synthetic **"Trace Logs"** machine (error/warn counts, log rate, ring-buffer fill) — rendered automatically by the existing panel because it's just another entry in the vitals payload.
- **Event bus** (`emit_event`): the orchestrator emits events into an activity deque that feeds the ActivityFeed and log stream.
- **Model warm-up**: on startup the Conductor preloads `qwen2.5:3b` into Ollama to avoid cold-start latency; intent embeddings are pre-warmed too.

---

## 11. Configuration: Three Layers

Runtime config is resolved newest-first:

1. **`network.json`** (`backend/data/network.json`) — runtime-editable via the Settings UI (models, providers, machines, analysis config).
2. **Environment variables** — all deployed values can be overridden (documented in `CONFIGURATION.md` and `.env` files).
3. **Python defaults** in code.

Key variables: `CONDUCTOR_PORT` (8001), `FRONTEND_PORT` (3001), `OLLAMA_MODEL` (qwen2.5:3b), `ANALYSIS_MODEL`, `LLM_TIMEOUT` (120s), `CLASSIFIER_POLL_INTERVAL` (45s), `MODEL_PROFILES_DIR`.

Provider mapping: the `"worker"` provider maps to the `worker_llm` service via `_PROVIDER_SERVICE_MAP`. `service_url()` returns `""` for disabled providers; `local` is always reachable.

### 11.1 Model-node registry (network-wide scaling)

Model execution nodes are resolved from the service registry, not a hardcoded pair:

- **`local_llm`** — local llama.cpp-server (`127.0.0.1:12435`, protocol `openai`, model `qwen2.5:3b`). Logprobs-capable, so the primary node now captures token entropy. Started via `tools/start_local_llm.sh` (daemon logs to `~/llama-cpp/local_llm.log`).
- **`worker_llm`** — backoffice GPU node (`198.51.100.100:12434`, protocol `openai`, model `docker.io/ai/gpt-oss:20B`).
- **`ollama`** — fallback for the `local` provider (no logprobs) and used by embeddings/classifier/analysis.

`_resolve_model_endpoint()` in the orchestrator prefers `local_llm` when enabled+reachable and falls back to Ollama, so the entropy signal survives node failures. Any machine that speaks OpenAI-compat + top-k logprobs (llama.cpp-server, vLLM, etc.) becomes a first-class node by adding a `network.json` service entry — no orchestrator changes.

**Node-qualified identity**: `session.model_used` is now `{node}/{model}` — e.g. `primary/qwen2.5:3b`, `backoffice/gpt-oss:20B` — via `_current_execution_model()` + `config_manager.get_service_node()`. Profiles and entropy comparisons therefore aggregate per model×node instead of merging same-named models across machines. Existing unqualified traces remain as-is (honest data; corpus turns over).

**Known coupling**: the Settings "Models" tab edits `model_provider.model`, but when `local_llm` is enabled the execution model is `local_llm.model` (what the server actually loaded). Changing the local model in Settings requires loading that model into the llama.cpp node too.

**Current runtime config snapshot:** Ollama `127.0.0.1:11434` (enabled), OpenClaw `127.0.0.1:18789` (enabled), worker LLM `198.51.100.100:12434` model `docker.io/ai/gpt-oss:20B` (enabled), local LLM `127.0.0.1:12435` model `qwen2.5:3b` (enabled), Prometheus (disabled). Analysis model provider: worker. Execution model: local `qwen2.5:3b`. Embeddings: `all-minilm:22m` (cache dir `/tmp`).

---

## 12. Logging and Alerting

- **LogBroadcaster** (`backend/services/log_broadcaster.py`): in-memory ring buffer (500 entries) + `RotatingFileHandler` (10MB × 3 backups) writing to `backend/logs/conductor.log`.
- **`GET /api/logs/stream`** — SSE live stream (drives LogTerminal).
- **`GET /api/logs/recent`** — REST polling endpoint with `limit`/`level`/`since` filters and a summary block (error/warn counts over 5m/24h, entries/min, top loggers).
- **`tools/log_alerter.sh`** — cron/systemd-timer script that polls `/api/logs/recent` and sends a **Telegram alert** if errors appear or warnings exceed 5 in 5 minutes. Uses direct Telegram Bot API (the OpenClaw CLI `message send` hangs locally, so it's avoided for cron alerts).

---

## 13. Persistence Summary

| Data | Location | Notes |
|---|---|---|
| Traces | `backend/data/traces.jsonl` | JSON Lines, trimmed at 5MB |
| Synesthesia cache | `backend/data/synesth_cache.json` | Merged at API layer |
| Network config | `backend/data/network.json` | Runtime-editable |
| Annotations | `backend/data/annotations.jsonl` | Via annotation_service |
| Model profiles | `backend/data/model_profiles/` | Per-model fingerprint stats |
| Diagnostic probes | `backend/data/diagnostic_probes.json` | What-if test corpus |
| Logs | `backend/logs/conductor.log` | Rotating 10MB × 3 |
| Latency cache (CLI) | `~/.latency_monitor_cache.json` | CLI tool cache |

---

## 14. API Reference (Key Endpoints)

**Health & metrics:** `GET /health`, `GET /metrics` (Prometheus format), `GET /api/telemetry`, `GET /api/vitals`.

**Config:** `GET /api/config/first-run`, `POST /api/config/setup`, `GET/PUT /api/network-config`, `POST /api/network/scan`, `GET /api/config/providers`, `POST /api/config/services`, `GET/POST /api/config/model`, `GET/POST /api/config/analysis-model`.

**Models:** `GET /api/models`, `GET /api/models/network`, `GET /api/models/current`, `POST /api/models/select`.

**Orchestration:** `POST /api/orchestrate` (accepts optional `chat_id`; backend stamps `chat_id` + assigns `exchange_index`), `POST /api/traces/batch`, `GET /api/traces/batch/{id}`.

**Chats:** `GET /api/chats` (session summaries, newest-first), `GET /api/chats/{chat_id}` (ordered exchanges; 404 unknown).

**Testing:** `POST /api/tests/run`, `GET /api/tests/run/{id}`, `POST /api/tests/classify`, `GET /api/tests/classify/{task_id}`, `POST /api/tests/classify/{task_id}/cancel`.

**Logs:** `GET /api/logs/stream` (SSE), `GET /api/logs/recent`.

**Traces:** `GET /api/traces`, `GET/DELETE /api/traces/{trace_id}`, `POST /api/traces/bulk-delete`, `GET /api/traces/profile`, `POST /api/traces/analyze`, `POST /api/traces/classify-synesth`, annotation routes (`POST/DELETE /api/traces/{trace_id}/annotations/...`).

**Schema:** `GET/PUT /api/schema`.

**Export:** `GET /api/export/traces.csv`, `GET /api/export/profiles.csv`.

---

## 15. Deployment and Operations

- **`restart.sh`** (project root): kills `next-server`/`uvicorn`, sources `backend/.env`, starts backend (port from `CONDUCTOR_PORT`) and frontend (`FRONTEND_PORT`, `pnpm dev`), logs to `logs/backend.log` / `logs/frontend.log`, uses `setsid` + `disown` so servers survive the shell, and uses `.venv/bin` Python when available.
- **Ports:** frontend 3001, backend 8001, Ollama 11434, worker LLM 12434, OpenClaw 18789.
- **Known ops lessons** (recorded in ARCHITECTURE.md):
  - Use `pnpm dev` not `next start` — `next start` caches stale HTML in memory.
  - Port 3001 `EADDRINUSE` = zombie `next` → `kill -9 $(lsof -t -i:3001)`.
  - Stale `.next` corruption → `rm -rf .next`.
  - WebSockets are fragile across LAN → prefer HTTP polling.
  - VRAM fit check via `nvidia-smi`.
  - Hydration mismatches from floating-point SVG → round to `.toFixed(4)`.

---

## 16. Data Model: The TraceSession

A `TraceSession` (Python `backend/models/trace.py`, mirrored in `frontend/src/types/trace.ts`) contains:
- `trace_id`, `status`, `timestamps`, `prompt`, `output`
- `chat_id` / `exchange_index` — optional chat-session linkage (`None`/`null` = standalone single prompt; every trace is interchangeable between single-prompt and chat views)
- `steps` — the 7 stages, each with duration, status, and metadata (`gen_started_at`, token counts, etc.)
- `model`, `model_provider`, latency, token counts, eval count/duration (for tok/s)
- `intent_probs` — top-3 intent confidences + reasoning
- `retrieved_chunks` — memory chunks with used/discarded status + relevance
- `context_assembled` — what went into the model call
- `response_rationale`, `trace_explanation` — the model's self-reported reasoning
- `token_entropy` — mean/p95 entropy + high-entropy token count + per-token series (captured from top-5 logprobs on the generation stage)
- `ddc` / `lcc` — each: prompt + response classifications with `code`, `label`, `action`, `domain`, `score`, `margin`, `top_scores`
- `synesth` — grammar rings + `synesth_domain` (may be `null` for old traces)
- `vector_graph` — points + edges for the memory visualization

---

## 17. The "Truth over Polish" Design Values (how to explain it)

1. **Show the margin.** Low-confidence classifications are shown as amber/red, not hidden.
2. **Disclose small samples.** LLM analysis explicitly says "anecdotal sample" when N < 10.
3. **Distinguish system-recorded truth from LLM self-report.** The Dual-Timeline pairs Objective Trace (what the system measured) with LLM Self-Rationale (what the model claims) — and Ghost Reference detection highlights where the model's claims reference system metrics.
4. **Prefer deterministic classification for core labels** (embeddings), reserving LLMs for open-ended analysis.
5. **Fail visibly.** Unreachable providers show amber "unavailable," never silent failure.

---



*End of engineering guide. For deeper detail: `ARCHITECTURE.md`, `CONFIGURATION.md`, `FUTURE_PLANS.md`, `backend/services/orchestrator.py`, `backend/main.py`.*
