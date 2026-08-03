#!/usr/bin/env bash
# Pre-commit scrub check — blocks commits that would publish secrets or real
# infrastructure info. See SECURITY.md for the full SOP.
#
# Generic patterns (safe to commit) are embedded below. Machine-specific
# values (real hostnames, LAN IPs) go in ~/.config/mythic/scrub_extra.txt,
# one extended-regex pattern per line, which is never committed.
#
# Escape hatch for false positives: `git commit --no-verify`.
set -u

# Files that legitimately name the patterns themselves (skip their diffs).
SELF_FILES='^(tools/scrub_check.sh|hooks/|SECURITY.md|\.git/)'

EXTRA_FILE="${SCRUB_EXTRA_FILE:-$HOME/.config/mythic/scrub_extra.txt}"

staged=$(git diff --cached --name-only --diff-filter=ACM)
[ -z "$staged" ] && exit 0

violations=""

# 1) Forbidden paths (runtime data must never be committed).
for f in $staged; do
  case "$f" in
    *.env)
      case "$f" in
        *.env.example) ;; # allowed
        *) violations="${violations}  path '${f}' — commit only *.env.example, never real env files\n" ;;
      esac
      ;;
    traces.jsonl|*/traces.jsonl) violations="${violations}  path '${f}' — runtime trace data must stay out of git\n" ;;
    *model_profiles/*|model_profiles/*) violations="${violations}  path '${f}' — runtime model profile data must stay out of git\n" ;;
    *logs/*|logs/*) violations="${violations}  path '${f}' — runtime log data must stay out of git\n" ;;
  esac
done

# 2) Secret / infra patterns on ADDED lines only.
patterns=(
  -e '[0-9]{8,}:[A-Za-z0-9_-]{30,}'                          # Telegram bot tokens
  -e '\bsk-[A-Za-z0-9]{16,}\b'                                # OpenAI-style keys
  -e '\bghp_[A-Za-z0-9]{20,}\b|\bgho_[A-Za-z0-9]{20,}\b|\bgithub_pat_\b'
  -e 'AKIA[0-9A-Z]{16}'                                       # AWS access key prefix
  -e '(token|api[_-]?key|apikey|password|passwd|secret|authorization)[[:space:]]*[:=][[:space:]]*["'"'"']?[A-Za-z0-9+/=_-]{14,}'
  -e '\b(10|192\.168|172\.(1[6-9]|2[0-9]|3[01]))\.([0-9]{1,3}\.){2}[0-9]{1,3}\b'       # RFC1918
  -e '\b100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.([0-9]{1,3}\.){2}[0-9]{1,3}\b'   # CGNAT (100.64/10)
)

# Machine-specific patterns (real hostnames/IPs), if the local file exists.
if [ -r "$EXTRA_FILE" ]; then
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    patterns+=(-e "$line")
  done < "$EXTRA_FILE"
fi

hits=$(
  for f in $staged; do
    case "$f" in
      tools/scrub_check.sh|hooks/*|SECURITY.md) continue ;;
      *.png|*.jpg|*.jpeg|*.gif|*.ico|*.woff2|*.docx|*.pdf) continue ;;
    esac
    git diff --cached -U0 -- "$f" 2>/dev/null \
      | grep -E '^\+' | grep -v '^+++' \
      | grep -nE "${patterns[@]}" && printf '      ^ in %s\n' "$f"
  done
)

if [ -n "$violations" ] || [ -n "$hits" ]; then
  echo -e "SCRUB CHECK FAILED — commit blocked."
  [ -n "$violations" ] && echo -e "\nForbidden paths:\n$violations"
  if [ -n "$hits" ]; then
    echo -e "\nPotentially sensitive content in staged diff:"
    echo "$hits"
  fi
  echo
  echo "If a match is a false positive, review it and retry."
  echo "To force anyway: git commit --no-verify"
  exit 1
fi
exit 0
