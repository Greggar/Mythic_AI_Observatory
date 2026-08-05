# Research — AI Art Observatory (Generative Image Observability)

**Status:** Investigation complete, plan deferred. The LLM phases are the active workstream; this branch is scoped but not started.

**Date:** 2026-08-05 · **Origin:** Gemini consultation on whether anyone is observability-instrumenting diffusion art models (Stable Diffusion / Flux / Wan / HiDream) the way this project instruments text LLMs.

---

## Question Asked

"Is anyone building an observatory for generative image pipelines — pairing prompt-encoder classification, per-step denoising entropy, and CLIP-vector drift into a single cohesive timeline?"

### Answer (summary)

Almost exclusively in specialized research labs and niche developer tools (PyTorch hooks on UNet/DiT layers, scattered ComfyUI custom nodes) rather than a cohesive, production-ready observability suite. Nobody has built the "solar interface" equivalent for image pipelines: prompt-encoder classification + per-step noise entropy + CLIP drift in one timeline.

Existing partial solutions:

| Capability | Where it exists today |
|---|---|
| Latent-space inspection at intermediate steps | ComfyUI "Latent Preview" nodes, custom profiling packs |
| Cross-attention attribution (which prompt word → which pixels) | **DAAM** (Diffusion Attentive Attribution Maps) — the image analog of our SynthesisBridge |
| Text-encoder artifact detection (CLIP/T5 leakage, e.g. "plum-colored umbrella" → literal fruit) | Activation Atlases, CLIP-space probes in research notebooks |

---

## The Structural Translation (LLM → Diffusion)

| Observatory stage (text) | Generative art equivalent | What to measure |
|---|---|---|
| Intent / Knowledge classification | CLIP / T5 embedding probe | Prompt vector distribution *before* generation; keyword dominance (does "plum" pull toward Fruit or Color?) |
| Context Assembly | Conditioning & ControlNet injection | Influence weight of reference images, IP-Adapter, ControlNet depth/line maps interleaved into UNet/DiT layers |
| Response Generation | Multi-step denoising loop | Per-step metrics across 20–30 denoising steps instead of per-token |
| Token entropy | Cross-attention dispersion + noise delta | How focused spatial attention is per step. High entropy at early steps = structural confusion (extra limbs, overlapping subjects, style blending) |

### Corrections to the naive mapping (from our review)

- **"Per-step entropy" is NOT token entropy.** Diffusion steps refine the *same* latent (no causal sequential chain like autoregressive tokens). The right signal is **cross-attention dispersion** (does the text→latent map flatten?) plus **noise-prediction divergence**, not a surprisal curve. The `TokenEntropy` math (mean/p95/max-surprisal) does not port directly — `CrossAttentionEntropy` is a fresh computation.
- **The "gigabytes of telemetry" scare is a strawman.** Save per-step *scalars* (mean cross-attention entropy, attention sparsity/focus, latent tensor norm, sigma/noise variance) — that's kilobytes via a forward hook on the UNet/DiT cross-attention layers. The one thing worth persisting as images: 64×64 downsampled attention heatmaps for a UI scrubber (DAAM already does this pattern).
- **Hardware is the gate, not the concept.** Image diffusion on the primary CPU node (i7-6700) is a non-starter. The backoffice GPU is required.

---

## Infrastructure Discovery (2026-08-05)

Backoffice runs **ComfyUI 0.27.0** (PyTorch 2.12.1+cu130) on an **RTX 5070 Ti, 16 GB VRAM**. Reachable over Tailscale from the primary node; ComfyUI binds `0.0.0.0` and answers on its default port. (Real addresses live in `~/.config/opencode/AGENTS.md` — never in this repo; see SECURITY.md scrub SOP.)

### Inventory via `/object_info` (985 nodes)

**Checkpoints (26):** SD 1.5 family, SDXL base + refiner, Pony lineage (cyberrealisticPony, realismByStableYogi, mklanAIONSFW), Flux dev FP8, HiDream, Hunyuan3D, plus heavy comics/inkpunk styling (Comics Factory, M4RV3L, Inkpunk, Romain Bonnet, z_image_turbo).

**LoRAs (29):** SDXL/Pony-era style LoRAs (3DMM, Art Nouveau, Frazetta, Steampunk ×3, Ancient Robots, Dwemer ruins, EldritchComics, Cave Ruins POV, Lineart) + 2 Wan2.2 video LoRAs (lightx2v 4-step high/low noise).

**Video is first-class (134 nodes):** Wan2.2 **14B image-to-video** (high + low noise UNets), Wan VAE, LTXV, Hunyuan video, camera/motion/move/control suites.

**3D (39+ nodes):** Hunyuan3D, triposplat, splatting, plus partner pipelines (Tripo, Rodin, Meshy, Tencent).

**The observability hooks are already installed:**
- `advanced/hooks` + 30+ sampling/guidance/sigma nodes — sampling-time hook infrastructure exists for step telemetry
- Full **ControlNet Preprocessors** suite (depth/normal/pose/line/tile/segmentation) + SDXL Union ControlNet
- **IPAdapter (37 nodes)** + CLIP-ViT-H — the "context injection" path
- `ArtVenture/LLM` + `experimental/attention_experiments`
- **~30 partner cloud API node sets** (Flux/BFL, Gemini, OpenAI, Grok, Kling, Veo, Recraft, Runway, Stability, Luma, MiniMax, Vidu, PixVerse, Wan + text/audio/3D) — local *and* cloud generations could run through one harness

### Key architectural facts

- ComfyUI exposes a JSON HTTP API: `GET /object_info` (node registry), `GET /system_stats`, workflow submission + WebSocket progress events with per-node timing. This is the same shape as our `/api/traces` spine — a telemetry harness can submit a workflow and read back step-level progress without modifying ComfyUI.
- Real-time step data flows over the WebSocket (execution progress, node outputs). Cross-attention maps require a custom node or hook (sampling hooks / attention hooks exist in the installed `advanced/hooks` category).
- RTX 5070 Ti 16 GB fits quantized Flux/SDXL and the Wan 14B (fp8) models already resident.

---

## What Transfers From the Existing Codebase (high reuse)

- **SynthesisBridge = our DAAM** — same word-overlap attribution logic, target becomes a spatial canvas instead of a sentence.
- **DualTimeline** — Objective Trace (per-step scalars) vs Self-Rationale (which prompt tokens hold attention at step N) maps 1:1.
- **UncertaintySparkline / entropy trajectory** — becomes the denoising entropy curve over steps.
- **TraceRadar / comparative overlay** — per-image fingerprints, multi-seed/model comparison.
- **traces.jsonl + `/api/traces` spine, MemoryConstellation, drift/confusion charts** — model-agnostic; image traces slot in as another session kind.
- **The Ollama-drops-logprobs lesson applies verbatim** — verify the telemetry backend actually exposes the hook data before trusting it; silent absence of a signal must render as an explicit empty state.

---

## Deferred Decision Points (recorded for when the branch opens)

1. **Runner choice:** custom ComfyUI node vs `advanced/hooks` sampling hook vs external harness that submits workflows over the API and listens on the WebSocket. The WS route needs no ComfyUI modification but gives only node-level timing; true cross-attention entropy needs a hook/custom node.
2. **Storage:** separate `image_traces.jsonl` vs extending `traces.jsonl` with a `kind` discriminator. Scalars-only + downsampled heatmaps keeps it light.
3. **Which base model is the first target** (Flux fp8 vs SDXL vs Wan 14B video) — the harness should be model-agnostic; picking one as the reference corpus mirrors how the text project started.
4. **Cloud-node parity** — whether partner API generations (Flux via BFL, etc.) flow through the same trace pipeline for comparative insight.

---

## Links

- Plan / build order: **FUTURE_PLANS.md → Phase 19 — AI Art Observatory**
- Live infrastructure addresses: `~/.config/opencode/AGENTS.md` (never committed)
- Scrub rules for infra data: `SECURITY.md`, `tools/scrub_check.sh`
