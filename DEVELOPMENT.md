# Development Workflow

**Known issue:** `pnpm dev` (Turbopack [^turbopack]) is unstable on this machine due to slow filesystem I/O. The reliable testing path is `build + start` — see below.

**⚠️ `next start` caches HTML in memory.** Rebuilding `.next` while the server runs has no effect — kill and restart to see changes. For active development, use `pnpm dev` (hot-reloads). Use `restart.sh` in the project root for a combined kill→build→start cycle.

This project has two modes:

| Mode | Binding | Access | Primary Command | Stable? |
|---|---|---|---|---|
| **Development** | `127.0.0.1` | localhost only | `pnpm dev` | Unstable — use for quick HMR edits on the server |
| **Production preview** | `127.0.0.1` | localhost only | `pnpm build && next start` | ✅ Stable — use for testing with the user |
| **Production** | `0.0.0.0` | LAN-wide | `build + start -H 0.0.0.0` | ✅ Stable |

---

## 1. Sprint Lifecycle — Dev First, Prod Second

Only ONE mode runs at a time. Never run dev and prod simultaneously — they'll conflict on ports.

### Sprint start: Kill prod, start dev or preview

Use the convenience script for a clean restart:

```bash
~/mythic-ai-observatory/restart.sh
```

Or manually:

```bash
# 1. Kill anything on the ports
fuser -k 3001/tcp 2>/dev/null
fuser -k 8001/tcp 2>/dev/null

# 2. Start backend
cd ~/mythic-ai-observatory/backend
source .venv/bin/activate
uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# 3. Frontend — choose one:
#    A) Dev mode (hot-reloads, avoids HTML caching issue — PREFERRED for active dev)
#    B) Production preview (stable, but caches HTML — use for demos)
#
# Option A — dev mode (RECOMMENDED):
cd ~/mythic-ai-observatory/frontend
NEXT_PUBLIC_API_URL=http://198.51.100.1:8001 pnpm dev

# Option B — production preview (for demos):
cd ~/mythic-ai-observatory/frontend
NEXT_PUBLIC_API_URL=http://198.51.100.1:8001 pnpm build
next start -p 3001
```

### Sprint work loop

```
   ┌──────────────────┐
   │  Make code change │
   └────────┬─────────┘
            ▼
   ┌──────────────────┐
   │  pnpm build      │  ← catches type errors
   │  next start      │  ← stable preview
   └────────┬─────────┘
            ▼
   ┌──────────────────┐
   │  Test in browser │  ← localhost or LAN
   │  User verifies   │
   └────────┬─────────┘
            │
     ┌──────┴──────┐
     ▼             ▼
   More work    All good →
                 deploy
```

**Key rule:** Before any commit or deploy, always run `pnpm build` first. The build step catches TypeScript errors that dev mode hides.

### Sprint end: Test together, then deploy prod

When done, run the pre-production test checklist (section 3). Only if all checks pass, kill preview and start prod (section 4).

---

## 2. Development Mode (localhost-only)

### Backend

```bash
cd ~/mythic-ai-observatory/backend
source .venv/bin/activate
python main.py
# → http://127.0.0.1:8001
```

### Frontend — dev mode (hot reload, but can crash)

```bash
cd ~/mythic-ai-observatory/frontend
pnpm dev
# → http://localhost:3001
```

Only use this when you're on the server's own browser and need fast HMR. For anything else, use production preview.

### Frontend — production preview (stable, preferred)

```bash
cd ~/mythic-ai-observatory/frontend
pnpm build
next start -p 3001
# → http://localhost:3001
```

The frontend talks to `http://localhost:8001` by default — no env file needed when testing from the server's own browser.

### LAN access during testing (testing from another machine)

Set `NEXT_PUBLIC_API_URL` to the server's LAN IP so the frontend JS calls the right backend:

```bash
cd ~/mythic-ai-observatory/frontend
NEXT_PUBLIC_API_URL=http://198.51.100.1:8001 pnpm build
next start -p 3001 -H 0.0.0.0
```

Then open `http://198.51.100.1:3001` from your workstation.

---

## 3. Pre-Production Test Checklist

Before deploying to production (LAN-accessible), the AI assistant MUST run through these tests WITH you:

```bash
# Kill any dev servers first
fuser -k 3001/tcp 2>/dev/null
fuser -k 8001/tcp 2>/dev/null

# Build frontend (catches type errors)
cd ~/mythic-ai-observatory/frontend
pnpm build
```

Then start a local-only production preview:

```bash
NEXT_PUBLIC_API_URL=http://127.0.0.1:8001 pnpm start
```

And the backend:

```bash
cd ~/mythic-ai-observatory/backend
source .venv/bin/activate
python main.py
```

Visit `http://localhost:3001` on the server and verify with the user:

- [ ] **Page loads without errors** — Open browser console, confirm 0 errors
- [ ] **Settings gear icon** visible top-right, click opens the modal
- [ ] **Telemetry loads** — System Vitals show CPU/Memory/GPU data
- [ ] **Solar Nexus** shows the 7-stage pipeline visualization
- [ ] **Orchestration works** — Submit a prompt, trace completes with output
- [ ] **Activity feed populates** — Events appear during orchestration
- [ ] **Memory Retrieval** traces appear in the constellation view
- [ ] **Network Settings** — Open the settings modal, edit a service host, save, verify telemetry reflects the change
- [ ] **Model Switcher** — Settings → Models tab, switch from local → worker → local, verify model changes
- [ ] **Context pane** — Click a model-calling step node in SolarNexus, confirm the split-pane shows system prompt + assembled context + token meter
- [ ] **Build passes** — `pnpm build` exits 0 with no warnings
- [ ] **Unit tests pass** — `pnpm test` exits 0 (vitest; network layer + `usePoll` suites, Phase 22). Since Phase 22, the frontend verification command is `tsc + test + build` — **`pnpm test` is a non-negotiable gate** before any frontend commit.
- [ ] **Backend tests pass** — `cd backend && ./.venv/bin/pytest -q` exits 0 (22 tests: `test_chats.py`, `test_probes.py`, `test_smoke.py`, `test_traces_summary.py`). **`pytest` is a non-negotiable gate** before any backend/deploy.
- [ ] **Unified release gate** — `./tools/release_check.sh` runs the full backend + frontend chain in one shot (backend `pytest` + `ruff`, frontend `tsc` + `vitest` + `eslint` [tracked budget, non-fatal] + `build`), failing fast. Run it before any release.

Only after ALL checks pass, proceed to production deploy.

---

## 4. Production Mode (LAN-accessible)

### Sprint end: Kill dev, deploy prod

```bash
# 1. Kill dev servers
fuser -k 3001/tcp 2>/dev/null
fuser -k 8001/tcp 2>/dev/null

# 2. Backend
cd ~/mythic-ai-observatory/backend
source .venv/bin/activate
CONDUCTOR_HOST=0.0.0.0 nohup python main.py > /tmp/backend-prod.log 2>&1 &

# 3. Frontend — build with LAN IP baked in
cd ~/mythic-ai-observatory/frontend
NEXT_PUBLIC_API_URL=http://198.51.100.1:8001 pnpm build
next start -p 3001 -H 0.0.0.0
```

### Frontend (detailed)

Build once, then start the production server:

```bash
cd ~/mythic-ai-observatory/frontend
pnpm build

# Bind to LAN so remote machines can reach it:
next start -p 3001 -H 0.0.0.0
```

Set the API URL to the server's LAN IP so the built frontend knows where to find the backend:

```bash
NEXT_PUBLIC_API_URL=http://198.51.100.1:8001 next build
```

Or create `frontend/.env.production` (not committed — see `.env.example`):

```
NEXT_PUBLIC_API_URL=http://198.51.100.1:8001
```

---

## 5. Test Workflow — Always Test Before Production

```
 ┌─────────────────────────────────────────────────┐
 │                 SPRINT START                     │
 │  Kill prod → Start dev → Make changes            │
 └─────────────────────┬───────────────────────────┘
                       │
                       ▼
 ┌─────────────────────────────────────────────────┐
 │           PRE-PRODUCTION TEST (with user)        │
 │  Kill dev → pnpm build → next start (localhost)  │
 │  Run checklist → Verify with user in browser     │
 └─────────────────────┬───────────────────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
         Pass all?          Failed?
              │                 │
              ▼                 ▼
    ┌─────────────────┐  ┌─────────────────┐
    │  DEPLOY PROD     │  │  Fix & re-test   │
    │  next start      │  │  (back to dev)   │
    │  -H 0.0.0.0     │  │                  │
    └─────────────────┘  └─────────────────┘
```

**Golden rule:** Never skip the `pnpm build && next start` test on localhost before enabling LAN access. The build step catches type errors, the production start catches SSR/routing issues that dev mode hides.

**Standing verification rule (Phase 22):** before finalizing any change, run the full frontend chain `npx tsc --noEmit` → `pnpm test` → `pnpm build` → `pnpm lint` (and `ruff check`/`pytest` for backend). The one-shot runner is `./tools/release_check.sh` (see §3). Leave the tree cleaner than you found it: zero compiler warnings, zero unused vars/imports/parameters you introduced, zero new lint errors, zero dead code you authored. Existing/deferred eslint debt (a deliberately-tracked 97 problems, see FUTURE_PLANS Phase 22) may be left but must not regress; fix new items autonomously.

---

## 6. Environment Variables

| Variable | Dev default | Dev LAN test | Production | Where used |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8001` | `http://198.51.100.1:8001` | Server LAN IP | `useWebSocket.ts`, `useOrchestrate.ts`, `page.tsx` |
| `CONDUCTOR_HOST` | `127.0.0.1` | `127.0.0.1` | `0.0.0.0` | `backend/main.py` |
| `ORCHESTRATOR_MODEL` | `local` | `local` | `local` | `orchestrator.py` — model provider default |

## 7. Model Provider API

Switch between local and worker LLM inference at runtime without restarting the backend:

```bash
# Check current provider
curl http://localhost:8001/api/config/model

# Switch to worker
curl -X POST http://localhost:8001/api/config/model \
  -H "Content-Type: application/json" \
  -d '{"provider": "worker"}'

# Switch back to local
curl -X POST http://localhost:8001/api/config/model \
  -H "Content-Type: application/json" \
  -d '{"provider": "local"}'
```

The frontend SettingsModal exposes this via the "Models" tab. No restart needed — the next LLM call picks up the new provider.

## 8. Context Assembly Breakdown

Each trace step that calls a model stores `context_assembled` — the exact concatenated text sent to the inference endpoint. This is visible by clicking a node in the SolarNexus visualization during or after a trace.

The split-pane shows:
- **Left pane:** The stage's system prompt
- **Right pane:** The assembled context (accumulated previous outputs + current user prompt)
- **Token meter:** Estimated token count (`Math.round(text.length / 4)` [^tokencount]) versus the model's context window (4096 for local 3B)

This makes the opaque LLM call transparent and debuggable.

---

## 9. Footnotes

[^turbopack]: **Turbopack.** The Rust-based incremental bundler that Next.js's dev server uses (replacing webpack in `next dev`). It is a build tool, not an algorithm — cite the official docs only: https://nextjs.org/docs/app/getting-started/development-and-production

[^tokencount]: **~4 characters ≈ 1 token.** The `text.length / 4` estimate mirrors the common "4 characters per token" rule of thumb used by the OpenAI tokenizer (tiktoken): https://platform.openai.com/docs/concepts/tokens and https://github.com/openai/tiktoken. It is a display heuristic only — real tokenization is subword-based (byte-pair encoding), which is why per-token entropy in this project reads `logprobs`/`top_logprobs` from the model endpoint rather than estimating.

For the full citation corpus (entropy, calibration, embeddings, MDS, chart types, etc.), see **§18 Footnotes & Bibliography** in `ENGINEERING_GUIDE.md` — the two references here are the only ones DEVELOPMENT.md itself needs, since the rest of this document is procedural.
