# Security — Commit SOP & Secret Handling

**Policy: nothing real leaves this repo.** No live credentials, no real IP addresses, no real hostnames, no runtime data. The repo is public on GitHub and there is no way to reliably un-leak a value that has been pushed — so the goal is to never let one in.

A live Telegram bot token, a real LAN IP, and a real hostname have all been found in the public history at various points. This SOP exists so that never happens again.

---

## 1. The Automated Guard (pre-commit hook)

A pre-commit hook runs `tools/scrub_check.sh` against **staged content** before every commit and blocks it on:

| What | Pattern |
|---|---|
| Telegram bot tokens | `\d{8,}:[A-Za-z0-9_-]{30,}` |
| OpenAI-style keys | `sk-[A-Za-z0-9]{16,}` |
| GitHub tokens | `ghp_` / `gho_` / `github_pat_` |
| AWS keys | `AKIA` |
| Generic secret assignments | `token`/`api_key`/`apikey`/`password`/`passwd`/`secret`/`authorization` `=`/`:` `<value>` |
| RFC1918 IPs | `10.x`, `172.16–31.x`, `192.168.x` (4 octets) |
| CGNAT IPs | `100.64/10` (e.g. `100.100.x`) |
| Runtime paths | `traces.jsonl`, `model_profiles/`, `logs/`, real `.env` files |

**Machine-specific values** (real hostnames, LAN IPs like `<lan-ip>`/`192.168.x.y`) must **not** be hardcoded in the committed scanner. They go in `~/.config/mythic/scrub_extra.txt`, one extended-regex pattern per line, e.g.:

```
<hostname>
192\.168\.0\.187
```

That file lives outside the repo and is never committed. `SCRUB_EXTRA_FILE` overrides its location.

### Install (one time, per checkout)

```bash
git config core.hooksPath hooks
```

### Escalation

The hook fails loudly but can be bypassed with `git commit --no-verify` — use only when you have personally reviewed the staged diff and the match is a false positive.

---

## 2. Manual Pre-Commit Checklist

Even with the hook, run this before every push:

1. **`git diff --cached`** and read every added line. Your eyes are the last line of defense.
2. **Real IPs** — any `192.168.`, `10.`, `172.16–31.`, `100.64/10` address must be replaced with an RFC 5737 documentation IP (`198.51.100.x`, `192.0.2.x`, `203.0.113.x`).
3. **Hostnames** — replace real machine names (`<hostname>`, `backoffice`) with role labels (`primary`, `worker`). `backoffice` remains an acceptable role **key** in `network.json` config; never pair it with a real address.
4. **Credentials** — no token, key, or password value, ever. Config files use `${VAR}` placeholders; secrets go in `~/.config/mythic/` (see `tools/log_alerter.sh`).
5. **Model tags** — strip private registry paths / internal model tags; use the model name only (`qwen2.5:3b`, `gpt-oss:20B`).
6. **Runtime data** — `traces.jsonl`, `backend/data/model_profiles/`, `backend/logs/` must stay untracked. Only `.env.example` files are committed, never `.env`.
7. **`.gitignore` sanity** — if a new runtime artifact appeared, add it to `.gitignore` rather than relying on memory.

---

## 3. Live Config vs Committed Config

`backend/data/network.json` is the runtime source of truth and may contain the real worker address locally. The committed copy is scrubbed to documentation IPs; the live copy is excluded from `git` via:

```bash
git update-index --skip-worktree backend/data/network.json
```

`skip-worktree` keeps local changes to that file out of future commits (your working copy keeps the real IP, GitHub keeps the scrubbed one). Note: `git stash` and checkout of a branch **will not** touch a skip-worktree file; run `git update-index --no-skip-worktree backend/data/network.json` if you ever need to commit a change to it deliberately.

---

## 4. If Something Leaks Anyway

You cannot "un-push" — GitHub exposes every commit until the repository is deleted. If a secret or real address reaches the remote:

1. **Rotate the credential immediately** (revoke the Telegram bot / API token). Treat it as compromised regardless of any rewrite.
2. **Rewrite history** to purge the value:
   ```bash
   git clone git@github.com:Greggar/Mythic_AI_Observatory.git /tmp/scrub
   cd /tmp/scrub
   # patterns.txt: literal==>replacement, or regex:EXPR==>replacement
   git filter-repo --replace-text patterns.txt --force
   git remote add origin git@github.com:Greggar/Mythic_AI_Observatory.git
   git push --force origin main
   ```
3. **Sync every checkout**: `git fetch origin && git reset --hard origin/main`.
4. If a credential was ever in history, assume it is public forever — GitHub forks, caches, and archive services may retain it. Rotation is the only real fix.

---

## 5. Contact

Project & security contact: Gregory Long <gregory@greole.com>
