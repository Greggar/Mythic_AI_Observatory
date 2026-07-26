# Mythic AI Observatory — Alpha Tester Guide

## What Is This?

The Mythic AI Observatory is a **real-time AI orchestration monitor and intelligence analysis platform**. It doesn't just run AI models — it watches itself think. Every prompt passes through a 7-stage pipeline, and every stage is recorded, measured, classified, and visualized.

The goal: **make AI reasoning transparent, measurable, and improvable.**

---

## Core Philosophy

Most AI tools are black boxes. You send a prompt, you get a response, and you have no idea what happened in between. The Observatory inverts this:

1. **Every trace is a full audit log** — not just input/output, but the intent classification, memory retrieval, context assembly, and routing decisions that shaped the response.
2. **Every trace is classified** — automatically categorized by subject matter (DDC/LCC), grammatical structure (6-ring synesthesia), and intent — then visualized across your entire history.
3. **Every trace is comparable** — side-by-side radar charts, confusion matrices, drift analysis, and correlation heatmaps reveal patterns across hundreds of traces.

---

## What We're Trying to Achieve

| Goal | How |
|---|---|
| **Trust through transparency** | Show users exactly what the AI did, why it chose certain paths, and what it discarded — in real time |
| **Detect model drift** | Track how classification distributions change over time; surface when a model starts behaving differently |
| **Understand prompt structure** | Classify every prompt by grammatical mood, depth, syntax, action type, and tone — revealing how prompt design affects output quality |
| **Measure retrieval quality** | Show which memory chunks were used vs discarded, with relevance scores — so you know if the RAG pipeline is actually helping |
| **Compare models objectively** | Same prompt, different models — radar fingerprints, latency profiles, personality metrics side by side |
| **Find patterns at scale** | When you have 100+ traces, the Sunburst charts, confusion matrices, and drift heatmaps reveal systemic patterns invisible at the individual trace level |

---

## Features Overview

### The Pipeline (What Happens to Every Prompt)

When you submit a prompt, it flows through 7 stages. Each is recorded with timing, tokens, and reasoning:

1. **Request Received** — Raw prompt enters the system
2. **Intent Classification** — Embedding-based classifier assigns one of 13 intent categories in ~73ms (no LLM call)
3. **Model Routing** — Maps intent to the available execution model
4. **Memory Retrieval** — Vector similarity search over all past traces; top-5 chunks tagged as used/discarded
5. **Context Assembly** — Retrieved chunks + user input assembled into the context window
6. **Response Generation** — The model generates a response (streamed in real time)
7. **Output Packaging** — Trace stored, heuristic insights computed

**Why it matters:** You can see exactly where time is spent, which memory chunks influenced the response, and whether the model followed the assembled context.

---

### Classification Systems

Every trace is automatically classified along multiple dimensions:

#### Subject Matter (DDC + LCC)
- **Dewey Decimal Classification** — 55 categories covering all human knowledge (Computer Science, Physics, Medicine, Philosophy, etc.)
- **Library of Congress Classification** — 70+ academic subclasses for fine-grained subject tagging
- **Multi-Label** — Top-3 categories with confidence scores per trace
- Both prompt AND response are classified independently, so you can see if the model drifted from the topic

#### Grammatical Structure (Synesthesia)
6 concentric rings classifying both prompt and response:
- **Depth** — Interjection / Minor Sentence / Full Verb Phrase
- **Mood** — Imperative / Indicative / Interrogative / Conditional / Subjunctive
- **Syntax** — Simple / Compound / Complex
- **Action** — Direct Execution / Conversational Phatic / Refusal / Guardrail
- **Tone** — Informative / Instructional / Creative / Analytical / Corrective
- **Form** — Structured / Bulleted / Continuous Prose

**Why it matters:** Reveals how the structure of your prompt shapes the structure of the response. "Tell me about X" (imperative, simple) produces different output than "What are the implications of X?" (interrogative, complex).

#### Intent
13 categories: Factual Query, Creative Writing, Enumeration, Instructional, Constraint Testing, Ambiguity Testing, Formatting Request, Reasoning, Hallucination Probe, Confidence Calibration, Persona Interaction, Mathematical, Comparison.

---

### Trace Visualization

#### SolarNexus (Main Trace View)
Animated orbital visualization of the 7-stage pipeline. Click any stage node to see:
- The exact text sent to the model (context assembly)
- Token velocity (tok/s) with real-time animation
- Whether memory chunks were used or discarded
- The model's own reasoning vs the system metrics (DualTimeline)

#### MemoryConstellation (History View)
All past traces plotted as orbiting dots in a spiral galaxy, clustered by DDC/LCC/Multi-Label classification. Features:
- **Search** — filter traces by keyword
- **Compare mode** — select 2+ traces for side-by-side radar comparison
- **Click to replay** — loads the full trace back into the main view
- **Delete** — right-click or press Delete to remove traces

#### Galaxy3D (Experimental)
Three.js 4-arm logarithmic spiral for 3D trace exploration. Same data as MemoryConstellation, but in full 3D with orbit controls.

---

### Analysis Charts (Relationships Panel)

These charts operate across your entire trace history:

| Chart | What It Shows |
|---|---|
| **Confusion Matrix** | How often DDC/LCC categories are confused (margin < 0.05); reveals embedding space weaknesses |
| **Semantic Drift Heatmap** | How classification distributions shift over time — are you asking different questions this week than last week? |
| **Semantic Drift Scatter** | Prompt DDC vs Response DDC — does the model stay on topic? Off-diagonal points reveal topic drift |
| **Synesthesia Correlation** | 24x24 Pearson correlation matrix across all grammar rings — "Do imperative prompts produce direct-execution responses?" |
| **Sankey Flow** | 7-column flow diagram showing how Depth -> Mood -> Syntax -> Action -> Tone -> Form -> DDC connect across traces |
| **Embedding Confusion Profile** | Which DDC categories does the embedding model struggle to distinguish? |
| **"Analyze with AI"** | LLM-generated narrative analysis for each relationship type |

---

### Multi-Model Testing

#### ModelSwitcher
Switch between local (Ollama) and worker (Docker Model Runner / remote GPU) providers at runtime — no restart needed.

#### TestRunner
Submit the same prompt to N models in parallel. Each run is tagged with model name and batch ID. Side-by-side comparison shows exact output differences.

#### PersonalityProfile
Per-model performance profiles:
- Latency: avg / p50 / p95 / p99
- Token velocity
- Failure rate
- Per-stage averages
- Linguistic style (verbosity, directness, formatting preferences)
- Cognitive fingerprint (hedging tendency, lexical diversity)

---

### System Monitoring

#### System Vitals
Real-time CPU, RAM, GPU metrics per machine. Works across your LAN — Prometheus scrapes node-exporter on each machine.

#### System Orbit
Solar system visualization: each machine is a planet, services orbit as glyphs that pulse during activity. The OpenClaw gateway renders as a hexagon satellite with scanning animation.

#### Log Terminal
Dark terminal UI with live log streaming, level filtering (INFO/WARN/ERR), search, and pause. Toggle with the `$_` button in the header.

#### Runtime Metrics
Throughput (req/s), average latency, error count, and per-stage duration bar charts.

---

### Data Export

Every visualization has a CSV export option:
- Traces (with all classification columns)
- Synesthesia (6-ring grammar data)
- Confusion matrix cells
- Personality profiles
- Per-stage latency breakdowns
- Full trace document (structured .txt with steps, classifications, and explanations)

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 22+
- pnpm
- Ollama OR Docker Model Runner with at least one model

### Install
```bash
git clone https://github.com/Greggar/Mythic_AI_Observatory.git
cd Mythic_AI_Observatory
bash install.sh
bash restart.sh
```

Open `http://localhost:3003` — a setup wizard will walk through provider configuration.

### Multi-Machine Setup
If you have models running on another machine (Docker Model Runner, remote Ollama, etc.):
1. Settings -> Machines tab -> "Scan Network"
2. Click the discovered machine to add it
3. Settings -> Models tab -> Select "Worker" provider and pick a model

---

## What to Test (Alpha Priorities)

### High Priority
1. **First-run experience** — Does install.sh detect your setup? Does the wizard work?
2. **Model switching** — Can you switch between local and worker providers?
3. **Trace quality** — Are the 7 stages all completing? Are classifications reasonable?
4. **Memory retrieval** — Are used chunks actually relevant? Are discarded chunks noise?

### Medium Priority
5. **History navigation** — Does the constellation load quickly? Can you search and filter?
6. **Analysis charts** — Do confusion matrices and drift charts make sense with your data?
7. **Multi-model comparison** — Do different models produce meaningfully different fingerprints?
8. **System vitals** — Do CPU/RAM/GPU metrics match what you see in `htop`/`nvidia-smi`?

### Nice to Have
9. **Export** — Does CSV export contain all expected columns?
10. **Log terminal** — Does it stream in real time? Do filters work?
11. **Settings persistence** — Do your changes survive server restarts?

---

## Known Limitations

- **Embedding model required** — DDC/LCC/Intent classification all depend on `all-minilm:22m`. If your model runner doesn't serve embeddings (Docker Model Runner), you need a separate Ollama instance for embeddings.
- **First trace is slow** (~25s) — Embedding cache warms on startup, but if the backend restarted recently, the first trace pays the cold-start cost.
- **Port 3001 may ghost-hold** — Next.js 16 can leave stale processes. Use port 3003 if 3001 refuses to start.
- **Remote vitals require node-exporter** — BackOffice/remote machines need Prometheus node-exporter running on port 9100.

---

## Feedback

Please report issues at: https://github.com/Greggar/Mythic_AI_Observatory/issues

Include:
- What you were doing
- What you expected
- What actually happened
- Any error messages or screenshots

---

*Built by Gregory Long — greg@mythic-ai.dev*
