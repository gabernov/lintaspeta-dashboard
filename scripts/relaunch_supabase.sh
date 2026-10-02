#!/usr/bin/env bash
#
# relaunch_supabase.sh - rebuild the lintas-dashboard database into a NEW
# Supabase project (disaster recovery). See docs/RELAUNCH.md for the runbook.
#
# Required env:
#   NEW_SUPABASE_URL      https://<newref>.supabase.co
#   NEW_DB_PASSWORD       database password of the new project
# Exactly one of:
#   --dump FILE           pg_dump custom-format file (.dump or .dump.gpg)
#   --seed                rebuild draft tables from portal parquet
#                         (requires PORTAL_PATH)
# Options:
#   --migrations-dir DIR  default supabase/migrations (relative to repo root)
#   --yes                 required; confirms destructive writes to the new project
# Optional env:
#   PORTAL_PATH           path to a lintaspeta-web checkout (for --seed)
#   BACKUP_PASSPHRASE     required to decrypt a *.gpg dump
#   NEW_SUPABASE_POOLER_HOST  override pooler host (default ap-southeast-1)
#   PYTHON_BIN            python interpreter for --seed (default python3)

set -euo pipefail
export LC_ALL=C

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR=""
DUMP_FILE=""
SEED=0
CONFIRMED=0
# Pooler hosts are region-scoped infrastructure and are not encoded in the
# project URL. Override NEW_SUPABASE_POOLER_HOST if the new project is created
# outside ap-southeast-1.
POOLER_HOST="${NEW_SUPABASE_POOLER_HOST:-aws-0-ap-southeast-1.pooler.supabase.com}"
# Session mode (5432) is required for pg_restore / psql DDL and long COPYs.
PG_PORT=5432

usage() {
  cat <<'EOF'
relaunch_supabase.sh - rebuild lintas-dashboard into a NEW Supabase project.

Required env:
  NEW_SUPABASE_URL      https://<newref>.supabase.co
  NEW_DB_PASSWORD       database password of the new project
Exactly one of:
  --dump FILE           pg_dump custom-format file (.dump or .dump.gpg)
  --seed                rebuild draft tables from portal parquet
                        (requires PORTAL_PATH)
Options:
  --migrations-dir DIR  default supabase/migrations (relative to repo root)
  --yes                 required; confirms destructive writes to the new project
Optional env:
  PORTAL_PATH           path to a lintaspeta-web checkout (for --seed)
  BACKUP_PASSPHRASE     required to decrypt a *.gpg dump
  NEW_SUPABASE_POOLER_HOST  override pooler host (default ap-southeast-1)
  PYTHON_BIN            python interpreter for --seed (default python3)
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dump)
      [ $# -ge 2 ] || { echo "ERROR: --dump needs a value" >&2; exit 2; }
      DUMP_FILE="$2"
      shift 2
      ;;
    --seed)
      SEED=1
      shift
      ;;
    --migrations-dir)
      [ $# -ge 2 ] || { echo "ERROR: --migrations-dir needs a value" >&2; exit 2; }
      MIGRATIONS_DIR="$2"
      shift 2
      ;;
    --yes)
      CONFIRMED=1
      shift
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

if [ -z "$MIGRATIONS_DIR" ]; then
  MIGRATIONS_DIR="${REPO_ROOT}/supabase/migrations"
fi
case "$MIGRATIONS_DIR" in
  /*) : ;;
  *) MIGRATIONS_DIR="${REPO_ROOT}/${MIGRATIONS_DIR}" ;;
esac

if [ "$CONFIRMED" -ne 1 ]; then
  cat >&2 <<'EOF'
REFUSED: relaunch_supabase.sh is destructive and writes to NEW_SUPABASE_URL.
Review the target project, then re-run with --yes to confirm.
EOF
  exit 1
fi

if [ -z "${NEW_SUPABASE_URL:-}" ] || [ -z "${NEW_DB_PASSWORD:-}" ]; then
  echo "ERROR: NEW_SUPABASE_URL and NEW_DB_PASSWORD are required." >&2
  exit 1
fi
if [ -n "$DUMP_FILE" ] && [ "$SEED" -eq 1 ]; then
  echo "ERROR: use either --dump or --seed, not both." >&2
  exit 1
fi
if [ -z "$DUMP_FILE" ] && [ "$SEED" -eq 0 ]; then
  echo "ERROR: one of --dump FILE or --seed is required." >&2
  exit 1
fi
if [ -n "$DUMP_FILE" ] && [ ! -f "$DUMP_FILE" ]; then
  echo "ERROR: dump file not found: $DUMP_FILE" >&2
  exit 1
fi
if [ ! -d "$MIGRATIONS_DIR" ]; then
  echo "ERROR: migrations directory not found: $MIGRATIONS_DIR" >&2
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "ERROR: psql not found in PATH (install postgresql-client)." >&2
  exit 1
fi

NEW_REF="$(printf '%s' "$NEW_SUPABASE_URL" | sed -E 's#^https?://##; s#/+$##; s#\.supabase\.co$##')"
case "$NEW_REF" in
  ''|*/*|*.*)
    echo "ERROR: could not derive project ref from NEW_SUPABASE_URL." >&2
    exit 1
    ;;
esac
NEW_USER="postgres.${NEW_REF}"

MODE="exact restore from dump"
[ "$SEED" -eq 1 ] && MODE="baseline rebuild from portal parquet"

cat <<BANNER
============================================================
 Supabase relaunch (disaster recovery)
============================================================
 new project ref : ${NEW_REF}
 new host        : ${POOLER_HOST}:${PG_PORT} (session pooler)
 new db user     : ${NEW_USER}
 migrations dir  : ${MIGRATIONS_DIR}
 mode            : ${MODE}
============================================================
BANNER

export PGPASSWORD="$NEW_DB_PASSWORD"
export PGCONNECT_TIMEOUT="${PGCONNECT_TIMEOUT:-30}"

psql_new() {
  psql \
    --host="$POOLER_HOST" \
    --port="$PG_PORT" \
    --username="$NEW_USER" \
    --dbname=postgres \
    --set=ON_ERROR_STOP=1 \
    --no-psqlrc \
    "$@"
}

pg_restore_new() {
  pg_restore \
    --host="$POOLER_HOST" \
    --port="$PG_PORT" \
    --username="$NEW_USER" \
    --dbname=postgres \
    --data-only \
    --no-owner \
    --no-privileges \
    "$@"
}

# --- b. schema -----------------------------------------------------------------
mapfile -t MIGRATIONS < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | LC_ALL=C sort)
if [ "${#MIGRATIONS[@]}" -eq 0 ]; then
  echo "ERROR: no *.sql migrations found in $MIGRATIONS_DIR" >&2
  exit 1
fi
echo ">>> Applying ${#MIGRATIONS[@]} migrations in lexical order"
for f in "${MIGRATIONS[@]}"; do
  echo "    - $(basename "$f")"
  psql_new --file="$f"
done

# --- c. exact restore ----------------------------------------------------------
if [ -n "$DUMP_FILE" ]; then
  RESTORE_FILE="$DUMP_FILE"
  if [ "${DUMP_FILE##*.}" = "gpg" ]; then
    if ! command -v gpg >/dev/null 2>&1; then
      echo "ERROR: dump is encrypted but gpg is not installed." >&2
      exit 1
    fi
    if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
      echo "ERROR: dump is encrypted; set BACKUP_PASSPHRASE to decrypt it." >&2
      exit 1
    fi
    RESTORE_FILE="$(mktemp "${TMPDIR:-/tmp}/relaunch-dump.XXXXXX.dump")"
    cleanup_dump() { rm -f "$RESTORE_FILE"; }
    trap cleanup_dump EXIT
    printf '%s' "$BACKUP_PASSPHRASE" | gpg --batch --yes --decrypt \
      --passphrase-fd 0 --output "$RESTORE_FILE" "$DUMP_FILE"
  fi

  # Auth must be restored first: public.* has FKs into auth.users, and the
  # on_auth_user_created trigger is dropped for the COPY (it would auto-create
  # profile rows that the public profiles COPY then duplicates) and recreated after.
  auth_ok=1

  echo ">>> Dropping on_auth_user_created trigger before auth restore"
  if ! psql_new -c 'drop trigger if exists on_auth_user_created on auth.users;'; then
    echo "WARNING: could not drop on_auth_user_created; continuing." >&2
  fi

  echo ">>> Best-effort restore of auth.users / auth.identities"
  if ! pg_restore_new --table=auth.users "$RESTORE_FILE"; then
    auth_ok=0
    echo "WARNING: could not restore auth.users." >&2
  fi
  if [ "$auth_ok" -eq 1 ] && ! pg_restore_new --table=auth.identities "$RESTORE_FILE"; then
    auth_ok=0
    echo "WARNING: could not restore auth.identities." >&2
  fi

  echo ">>> Restoring public schema data"
  if ! pg_restore_new --schema=public "$RESTORE_FILE"; then
    echo "ERROR: public data restore failed." >&2
    if [ "$auth_ok" -eq 1 ]; then
      echo "ERROR: auth restored, so this is not a user-FK problem." >&2
    else
      echo "ERROR: auth was not restored, so public rows referencing auth.users" >&2
      echo "ERROR: likely failed on foreign keys. See docs/RELAUNCH.md section 4.5." >&2
    fi
    exit 1
  fi

  echo ">>> Recreating on_auth_user_created trigger"
  psql_new -c 'drop trigger if exists on_auth_user_created on auth.users;'
  psql_new -c 'create trigger on_auth_user_created after insert on auth.users for each row execute procedure public.handle_new_user();'

  if [ "$auth_ok" -eq 0 ]; then
    echo "" >&2
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" >&2
    echo "!! WARNING: auth.users / auth.identities were NOT restored." >&2
    echo "!! Recreate users via the Admin API (docs/RELAUNCH.md section 6)." >&2
    echo "!! Restored public rows whose created_by / updated_by /" >&2
    echo "!! published_by / opened_by / audit_log.user_id reference" >&2
    echo "!! missing users may be absent or dangling - verify the counts" >&2
    echo "!! below before using the dashboard." >&2
    echo "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!" >&2
    echo "" >&2
  fi
fi

# --- d. baseline seed ----------------------------------------------------------
if [ "$SEED" -eq 1 ]; then
  if [ -z "${PORTAL_PATH:-}" ]; then
    echo "ERROR: --seed requires PORTAL_PATH (path to a lintaspeta-web checkout)." >&2
    exit 1
  fi
  if [ ! -d "$PORTAL_PATH" ]; then
    echo "ERROR: PORTAL_PATH is not a directory: $PORTAL_PATH" >&2
    exit 1
  fi
  PYTHON_BIN="${PYTHON_BIN:-python3}"
  if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
    echo "ERROR: '$PYTHON_BIN' not found; set PYTHON_BIN to a Python interpreter." >&2
    exit 1
  fi
  echo ">>> Seeding draft tables from ${PORTAL_PATH}"
  # bootstrap_seed.py reads SUPABASE_URL / SUPABASE_DB_PASSWORD from the env.
  SUPABASE_URL="$NEW_SUPABASE_URL" SUPABASE_DB_PASSWORD="$NEW_DB_PASSWORD" \
    "$PYTHON_BIN" "${REPO_ROOT}/scripts/bootstrap_seed.py" --portal "$PORTAL_PATH" --drop
fi

# --- e. verification -----------------------------------------------------------
echo ">>> Verification (row counts)"
psql_new --command="
  select 'profiles' as table_name, count(*) as rows from public.profiles
  union all select 'edit_windows', count(*) from public.edit_windows
  union all select 'ruas_jalan_draft', count(*) from public.ruas_jalan_draft
  union all select 'sekolah_draft', count(*) from public.sekolah_draft
  union all select 'rambu_draft', count(*) from public.rambu_draft
  union all select 'apj_draft', count(*) from public.apj_draft
  order by table_name;"

# --- f. follow-up --------------------------------------------------------------
cat <<'STEPS'

============================================================
 Relaunch complete - required follow-up
============================================================
 1. Update the dashboard .env.local (from the NEW project's
    Settings > API):
      VITE_SUPABASE_URL
      VITE_SUPABASE_ANON_KEY
      SUPABASE_SERVICE_ROLE_KEY
      SUPABASE_DB_PASSWORD

 2. Update Cloudflare Pages env vars for the dashboard project
    (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY), then redeploy.

 3. Update the GitHub repository secrets:
      SUPABASE_URL              = NEW project URL
      SUPABASE_SERVICE_ROLE_KEY = NEW service_role key
      SUPABASE_DB_PASSWORD      = NEW database password
    (keep BACKUP_PASSPHRASE; add it if it does not exist yet)

 4. Re-open edit windows as super_admin (dashboard "Buka" button or
    the SQL in docs/RELAUNCH.md).

 5. Verify sign-in, dataset counts, and run one publish to confirm.
============================================================
STEPS
