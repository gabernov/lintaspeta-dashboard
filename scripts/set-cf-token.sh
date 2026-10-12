#!/usr/bin/env bash
# Rotate the Cloudflare API token used to deploy the portal (peta.dishubjabar.com).
#
# Usage:
#   bash scripts/set-cf-token.sh [token-file]
#
#   token-file   optional path to a file. It may contain ONLY the token, or the
#                whole block copied from the Cloudflare dashboard (Account ID,
#                "Your API Token", R2 credentials, ...). The API token and
#                Account ID are extracted automatically; R2 keys are ignored.
#                If no file is given you are prompted for hidden input.
#                The file is deleted after a successful update.
#
# The token is never printed. It is verified against the Cloudflare Pages API,
# stored as the CLOUDFLARE_API_TOKEN GitHub secret, and the deploy is triggered.
set -euo pipefail

REPO="gabernov/lintaspeta-dashboard"
WORKFLOW="publish-data.yml"
DATASETS="none"
DEFAULT_ACCOUNT_ID="4b6f662c08a19365554f2c2d961e471c"

find_gh() {
  if command -v gh >/dev/null 2>&1; then command -v gh; return 0; fi
  local p
  for p in \
    "$HOME/AppData/Local/gh-cli/bin/gh.exe" \
    "/c/Users/$USER/AppData/Local/gh-cli/bin/gh.exe" \
    "/c/Program Files/GitHub CLI/gh.exe"; do
    [ -x "$p" ] && { printf '%s' "$p"; return 0; }
  done
  return 1
}

extract_field() {
  python - "$1" "$2" <<'PY'
import re, sys

blob = open(sys.argv[1], encoding="utf-8-sig", errors="replace").read()
field = sys.argv[2]

HEX = lambda n: re.compile(r"(?<![0-9a-fA-F])[0-9a-fA-F]{%d}(?![0-9a-fA-F])" % n)

def after_label(label, pattern, text):
    m = re.search(re.escape(label) + r"[^\n]*\n\s*(\S+)", text, re.IGNORECASE)
    if m and pattern.fullmatch(m.group(1).strip()):
        return m.group(1).strip()
    return None

if field == "token":
    m = re.search(r"cfat_[A-Za-z0-9_\-]+", blob)
    if m:
        print(m.group(0)); sys.exit()
    m = after_label("Your API Token", HEX(40), blob) or HEX(40).search(blob)
    print(m.group(0) if hasattr(m, "group") else (m or ""))
elif field == "account":
    val = after_label("Account ID", HEX(32), blob)
    if not val:
        for cand in HEX(32).findall(blob):
            val = cand; break
    print(val or "")
PY
}

GH_BIN="${GH_BIN:-$(find_gh || true)}"
if [ -z "${GH_BIN:-}" ]; then
  echo "ERROR: GitHub CLI (gh) not found. Set GH_BIN=/path/to/gh" >&2
  exit 1
fi

TOKEN_FILE="${1:-}"
if [ -n "$TOKEN_FILE" ]; then
  [ -f "$TOKEN_FILE" ] || { echo "ERROR: token file not found: $TOKEN_FILE" >&2; exit 1; }
  TOKEN="$(extract_field "$TOKEN_FILE" token)"
  ACCOUNT_ID="$(extract_field "$TOKEN_FILE" account)"
else
  printf 'Paste Cloudflare API token (hidden), then press Enter: '
  read -rs RAW_INPUT
  printf '\n'
  TMP_IN="$(mktemp)"
  printf '%s' "$RAW_INPUT" > "$TMP_IN"
  TOKEN="$(extract_field "$TMP_IN" token)"
  rm -f -- "$TMP_IN"
  RAW_INPUT=""
  ACCOUNT_ID=""
fi

ACCOUNT_ID="${ACCOUNT_ID:-$DEFAULT_ACCOUNT_ID}"

if [ -z "${TOKEN:-}" ]; then
  echo "ERROR: could not find an API token (cfat_… or 40 hex chars) in the input." >&2
  exit 1
fi

echo "Found token: ${TOKEN:0:9}… (hidden)   Account ID: $ACCOUNT_ID"

echo "Verifying token against the Cloudflare Pages API…"
RESP="$(curl -s -m 25 "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/pages/projects?per_page=1" -H "Authorization: Bearer $TOKEN")"
if ! printf '%s' "$RESP" | python -c "import sys,json; d=json.load(sys.stdin); sys.exit(0 if d.get('success') and d.get('result') is not None else 1)" 2>/dev/null; then
  echo "ERROR: Cloudflare rejected the token:" >&2
  printf '%s\n' "$RESP" | head -c 400 >&2
  echo >&2
  exit 1
fi
echo "Token OK."

echo "Updating GitHub secrets on $REPO…"
printf '%s' "$TOKEN" | "$GH_BIN" secret set CLOUDFLARE_API_TOKEN -R "$REPO"
printf '%s' "$ACCOUNT_ID" | "$GH_BIN" secret set CLOUDFLARE_ACCOUNT_ID -R "$REPO"

echo "Triggering deploy (project lintaspeta-web, datasets=$DATASETS)…"
"$GH_BIN" workflow run "$WORKFLOW" -R "$REPO" -f "datasets=$DATASETS"
sleep 6
"$GH_BIN" run list -R "$REPO" --workflow="$WORKFLOW" -L 1

if [ -n "$TOKEN_FILE" ]; then
  rm -f -- "$TOKEN_FILE"
  echo "Deleted $TOKEN_FILE"
fi

echo "Done. Watch the run above, then hard-refresh https://peta.dishubjabar.com/?mode=rambu"
