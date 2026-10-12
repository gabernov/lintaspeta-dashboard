#!/usr/bin/env bash
# Rotate the Cloudflare API token used to deploy the portal (peta.dishubjabar.com).
#
# Usage:
#   bash scripts/set-cf-token.sh [token-file]
#
#   token-file   optional path to a file containing ONLY the token.
#                If omitted you are prompted for hidden input.
#                The file is deleted after a successful update.
#
# The token is never printed. It is verified against the Cloudflare Pages API,
# stored as the CLOUDFLARE_API_TOKEN GitHub secret, and the deploy is triggered.
set -euo pipefail

REPO="gabernov/lintaspeta-dashboard"
WORKFLOW="publish-data.yml"
DATASETS="none"
ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-4b6f662c08a19365554f2c2d961e471c}"

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

GH_BIN="${GH_BIN:-$(find_gh || true)}"
if [ -z "${GH_BIN:-}" ]; then
  echo "ERROR: GitHub CLI (gh) not found. Set GH_BIN=/path/to/gh" >&2
  exit 1
fi

TOKEN_FILE="${1:-}"
if [ -n "$TOKEN_FILE" ]; then
  [ -f "$TOKEN_FILE" ] || { echo "ERROR: token file not found: $TOKEN_FILE" >&2; exit 1; }
  TOKEN="$(tr -d ' \t\r\n' < "$TOKEN_FILE")"
else
  printf 'Paste Cloudflare API token (hidden), then press Enter: '
  read -rs TOKEN
  printf '\n'
fi

if [ -z "${TOKEN:-}" ]; then
  echo "ERROR: no token provided." >&2
  exit 1
fi
case "$TOKEN" in
  cfat_*|????????????????????????????????????????) ;;
  *) echo "WARNING: value does not look like a Cloudflare API token (cfat_… or 40 hex chars)." >&2 ;;
esac

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
