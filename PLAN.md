# Phase 14 #10 — Reasoning Effort Curve (Illusion of Thinking)

## Objective

Reproduce the "effort peak-then-decline" finding from Shojaee et al. 2025 (arXiv:2506.06941) using the observatory's telemetry. The paper shows reasoning effort (thinking tokens) rises with problem complexity, peaks around 60% accuracy, then declines as models give up — while accuracy collapses. We measure this with token count, entropy series, branching factor (2^H), and step durations.

## Problem Generators

Two generators, avoiding GSM-8K contamination:

### 1. Arithmetic Chain (linear complexity)

Sequential addition/subtraction, evaluated left-to-right. Complexity = number of operations (2-10).

```
Complexity 3: "Compute step by step: 7 + 3 - 2 + 8"
Answer: 16 (7 -> 10 -> 8 -> 16)
```

- 5 random instances per complexity level
- Operands drawn from [1..15], signs randomly +/-
- Post-filter: ensure intermediate results and final answer are non-negative
- Optimal tokens grow linearly (~3-4 tokens per operation)

### 2. Tower of Hanoi (exponential complexity)

"What is the minimum number of moves to solve Tower of Hanoi with N discs?"

Exact answer: 2^N - 1. Tests whether the model derives or memorizes.

Complexity levels: N = 2,3,4,5,6,7,8 (answers: 3,7,15,31,63,127,255)
- 3 random instances per level (vary peg names)
- For N >= 6: rephrase to force derivation ("Show the recursive reasoning, do not just state a formula")
- Optimal tokens grow exponentially

## Per-Cell Metrics

Same as existing ProbeCell pattern plus:
- `complexity: int` — operation count or disc count
- `generator: str` — "arithmetic_chain" | "tower_of_hanoi"
- `optimal_tokens: int` — estimated tokens for ideal solution

Aggregated per-complexity:
- `accuracy` — fraction correct
- `mean_tokens` / `mean_entropy` / `mean_branching` — effort signals
- `efficiency_ratio` — actual_tokens / optimal_tokens

## Backend

### New file: `backend/services/complexity_probe.py`

- `COMPLEXITY_SEMAPHORE = asyncio.Semaphore(2)`
- Generator functions: `_gen_arithmetic_chain(complexity, rng)`, `_gen_tower_of_hanoi(complexity, rng)`
- `ComplexityCell` Pydantic model
- `ComplexityProbeStatus` Pydantic model (same store pattern as reasoning_probe)
- `_run_cell()` — calls `_call_model()`, captures entropy, scores answer
- `start_complexity_probe()` — builds cells for generators x complexity x models
- `aggregate_complexity_probe()` — per-generator per-complexity accuracy + effort
- In-memory store: `_probe_store: dict[str, ComplexityProbeStatus]`

### API endpoints in main.py

```
POST /api/probe/complexity              — start run
GET  /api/probe/complexity/{run_id}     — poll status
GET  /api/probe/complexity/{run_id}/summary — aggregated results
```

Same pattern as /api/probe/reasoning (main.py lines 1080-1112).

## Frontend

### New: `frontend/src/components/ComplexityLadderPanel.tsx`

Self-contained, same pattern as ReasoningProbePanel.tsx:

Controls:
- Model selector (multi-select chips)
- Generator selector (Arithmetic Chain / Tower of Hanoi toggles)
- Run button

Results:
- **Accuracy curve** — SVG line chart, complexity (x) vs accuracy (y), one line per model. Dashed horizontal at 50% and 100%.
- **Effort curve** — SVG line chart, complexity (x) vs mean tokens (y), one line per model. Overlay dashed line showing optimal token count.
- **Entropy progression** — SVG line chart, complexity (x) vs mean entropy (y), one line per model. Shows the peak-then-decline signature.
- Per-model summary cards: accuracy at each complexity, mean branching factor, efficiency ratio.
- Expandable cell detail (same pattern as existing).

### Wire into page.tsx

Import + add `<ComplexityLadderPanel />` after `<ReasoningProbePanel />` in the Tests tab (line 544).

## Build Order

1. `backend/services/complexity_probe.py` — generators + cell model + run logic + aggregation
2. `backend/main.py` — 3 API endpoints
3. `frontend/src/components/ComplexityLadderPanel.tsx` — full panel
4. `frontend/src/app/page.tsx` — import + render
5. Verify: `pytest` + `npx tsc --noEmit`

## Key Design Decisions

- **Arithmetic chains as primary**: cleaner linear scaling, guaranteed deterministic answers, no formula-recall confound
- **Tower of Hanoi as secondary**: tests derivation vs memorization at high N, exponential scaling reveals the collapse point
- **Left-to-right evaluation**: no operator precedence ambiguity — the model either tracks state or it does not
- **Separate from reasoning_probe.py**: different data model (complexity axis), different aggregation (per-complexity curves), different viz (line charts). Shares `_call_model()` and entropy infrastructure only.
- **In-memory store**: same as reasoning_probe — sessions are ephemeral, probe runs are short-lived
- **Efficiency ratio**: actual_tokens / optimal_tokens reveals overthinking (ratio >> 1) vs give-up (ratio drops with complexity)
