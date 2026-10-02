#!/usr/bin/env bash
#
# backup_supabase.sh - logical backup of the lintas-dashboard Postgres database.
#
# Dumps the `public` and `auth` schemas in pg_dump custom format so the project
# can be rebuilt into a fresh Supabase project with scripts/relaunch_supabase.sh.
#
# Required (process env wins; otherwise read from .env.local in repo root):
#   SUPABASE_URL (or VITE_SUPABASE_URL)   https://<ref>.supabase.co
#   SUPABASE_DB_PASSWORD
# Optional:
#   BACKUP_PASSPHRASE       if set, the dump is gpg AES256-encrypted and the
#                           plaintext is deleted
#   SUPABASE_POOLER_HOST    override the pooler host (default ap-southeast-1)
#
# Usage:
#   scripts/backup_supabase.sh [--out-dir DIR]

set -euo pipefail
export LC_ALL=C

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/backups"
# Pooler hosts are region-scoped infrastructure and are NOT present in the
# project URL. ap-southeast-1 is this project's home region; override with
# SUPABASE_POOLER_HOST if the project is ever recreated elsewhere.
POOLER_HOST="${SUPABASE_POOLER_HOST:-aws-0-ap-southeast-1.pooler.supabase.com}"
# Session mode (5432) is required: pg_dump needs a long-lived, non-pooled
# connection, which transaction mode (6543) does not provide.
PG_PORT=5432

usage() {
  cat <<'EOF'
backup_supabase.sh - logical backup of the lintas-dashboard Postgres database.

Required env (process env wins; otherwise read from .env.local):
  SUPABASE_URL (or VITE_SUPABASE_URL)
  SUPABASE_DB_PASSWORD
Optional env:
  BACKUP_PASSPHRASE       encrypt the dump (gpg AES256) and delete plaintext
  SUPABASE_POOLER_HOST    override the pooler host (default ap-southeast-1)

Usage:
  scripts/backup_supabase.sh [--out-dir DIR]
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --out-dir)
      [ $# -ge 2 ] || { echo "ERROR: --out-dir needs a value" >&2; exit 2; }
      OUT_DIR="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

# Populate unset vars from .env.local (KEY=value, # comments). Process env
# always wins so CI secrets are never shadowed by a stale local file.
load_env_file() {
  local file="$1" line key value
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    case "$line" in ''|'#'*) continue ;; esac
    line="${line#export }"
    case "$line" in *=*) ;; *) continue ;; esac
    key="${line%%=*}"
    value="${line#*=}"
    key="${key%"${key##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    case "$value" in
      \"*\") value="${value#\"}"; value="${value%\"}" ;;
      \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    [ -n "$key" ] || continue
    case "$key" in *[!A-Za-z0-9_]*) continue ;; esac
    if [ -z "${!key:-}" ]; then export "$key=$value"; fi
  done < "$file"
}

load_env_file "${REPO_ROOT}/.env.local"

SUPABASE_URL="${SUPABASE_URL:-${VITE_SUPABASE_URL:-}}"
if [ -z "$SUPABASE_URL" ]; then
  echo "ERROR: SUPABASE_URL (or VITE_SUPABASE_URL) is required." >&2
  exit 1
fi
if [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "ERROR: SUPABASE_DB_PASSWORD is required." >&2
  exit 1
fi
if ! command -v pg_dump >/dev/null 2>&1; then
  echo "ERROR: pg_dump not found in PATH (install postgresql-client)." >&2
  exit 1
fi

REF="$(printf '%s' "$SUPABASE_URL" | sed -E 's#^https?://##; s#/+$##; s#\.supabase\.co$##')"
case "$REF" in
  ''|*/*|*.*)
    echo "ERROR: could not derive project ref from SUPABASE_URL." >&2
    exit 1
    ;;
esac
DB_USER="postgres.${REF}"

mkdir -p "$OUT_DIR"
if [ ! -d "$OUT_DIR" ]; then
  echo "ERROR: could not create output directory: $OUT_DIR" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="${OUT_DIR}/supabase-${REF}-${STAMP}.dump"

echo "Supabase backup"
echo "  project ref : ${REF}"
echo "  host        : ${POOLER_HOST}:${PG_PORT} (session pooler)"
echo "  user        : ${DB_USER}"
echo "  output      : ${OUT_FILE}"

# Dumps include user PII and auth password hashes - keep them owner-only.
umask 077
export PGPASSWORD="$SUPABASE_DB_PASSWORD"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-30}"

pg_dump \
  --host="$POOLER_HOST" \
  --port="$PG_PORT" \
  --username="$DB_USER" \
  --dbname=postgres \
  --format=custom \
  --no-owner \
  --no-privileges \
  --schema=public \
  --schema=auth \
  --file="$OUT_FILE"

if [ ! -s "$OUT_FILE" ]; then
  echo "ERROR: dump file is empty or missing: $OUT_FILE" >&2
  rm -f "$OUT_FILE" 2>/dev/null || true
  exit 1
fi

BYTES="$(wc -c < "$OUT_FILE" | tr -d ' ')"
HUMAN="$(du -h "$OUT_FILE" 2>/dev/null | cut -f1 || true)"

if [ -n "${BACKUP_PASSPHRASE:-}" ]; then
  if ! command -v gpg >/dev/null 2>&1; then
    echo "ERROR: BACKUP_PASSPHRASE is set but gpg is not installed." >&2
    exit 1
  fi
  ENC_FILE="${OUT_FILE}.gpg"
  # Passphrase arrives on stdin so it never shows up in the process list.
  if ! printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes \
        --symmetric --cipher-algo AES256 \
        --passphrase-fd 0 \
        --output "$ENC_FILE" "$OUT_FILE"; then
    echo "ERROR: gpg encryption failed; plaintext kept at $OUT_FILE" >&2
    rm -f "$ENC_FILE" 2>/dev/null || true
    exit 1
  fi
  if [ ! -s "$ENC_FILE" ]; then
    echo "ERROR: encrypted output is empty: $ENC_FILE" >&2
    exit 1
  fi
  rm -f "$OUT_FILE"
  OUT_FILE="$ENC_FILE"
  BYTES="$(wc -c < "$OUT_FILE" | tr -d ' ')"
  HUMAN="$(du -h "$OUT_FILE" 2>/dev/null | cut -f1 || true)"
  ENCRYPTED="yes (gpg symmetric, AES256)"
else
  ENCRYPTED="no"
fi

echo "  encrypted   : ${ENCRYPTED}"
echo
echo "Backup OK"
echo "  file : ${OUT_FILE}"
echo "  size : ${HUMAN:-${BYTES} bytes} (${BYTES} bytes)"
