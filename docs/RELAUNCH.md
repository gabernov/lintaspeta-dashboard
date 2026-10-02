# Supabase Disaster Recovery & Relaunch Runbook

Operational guide for the `lintas-dashboard` Supabase project
(`ievtxzlxosqsewvsgmft`, region `ap-southeast-1`).

The Free-plan project was auto-paused in 2026-09 because the old keep-alive only
probed GoTrue (`/auth/v1/health`), which does not count as database activity.
This runbook is the recovery path for a paused, deleted, or corrupted project.
It assumes the daily backup workflow (`.github/workflows/backup-supabase.yml`)
has been running; if it has not, use Tier 3.

> Never commit secrets. Passphrases and passwords come from `.env.local`
> (gitignored), GitHub Actions secrets, or your shell environment.

---

## 1. Symptoms of a paused or deleted project

The real 2026-09 incident proved that **a paused project also returns NXDOMAIN**:
the `<ref>.supabase.co` hostname stops resolving while the project is paused.
DNS alone therefore **cannot distinguish paused from deleted** - the Supabase
dashboard is the deciding signal (section 2).

| Signal | Paused | Deleted |
| --- | --- | --- |
| `dig <ref>.supabase.co` | **NXDOMAIN** | **NXDOMAIN** |
| REST `/rest/v1/...` | unreachable (DNS failure) | unreachable (DNS failure) |
| Pooler (`psql`/`pg_dump`) | `tenant/user ... not found`, or DNS failure | `tenant/user ... not found`, or DNS failure |
| `GET /auth/v1/health` | DNS failure | DNS failure |
| Supabase dashboard | project **listed** with a **Paused** badge + Restore/Resume button | project **absent** from the project list |

The pooler host is `aws-0-ap-southeast-1.pooler.supabase.com`; the database user
is `postgres.<ref>`, port `5432` (session mode). Both `psql` and `pg_dump`
connections require `sslmode=require` (the scripts pass it via the pooler).

Quick DNS check (Windows Git Bash / Linux):

```bash
dig +short ievtxzlxosqsewvsgmft.supabase.co
# NXDOMAIN / empty answer => paused OR deleted; open the dashboard (section 2) to tell which
```

---

## 2. Paused vs deleted

1. Open <https://supabase.com/dashboard/projects>.
2. If `lintas-dashboard` is present with a **Paused** badge -> **paused**
   (Tier 1). Free projects are restorable for a limited window.
3. If it is absent from the project list, the project was **deleted** and its
   ref can no longer be recovered -> Tier 2 or Tier 3.

Check whether you still have a recent backup artifact before deciding:

```bash
gh run list --workflow=backup-supabase.yml --limit 10
```

---

## 3. Tier 1 - Resume the paused project (preferred)

1. In the dashboard, open the project and click **Restore / Resume**.
2. Wait until the status is **Active**.
3. Verify the database is reachable and unchanged:

```bash
bash scripts/backup_supabase.sh --out-dir backups
```

A successful dump means no data was lost - you are done. If the dump fails or
the project cannot be resumed, continue to Tier 2.

---

## 4. Tier 2 - Exact restore from the latest backup (new project)

Use when the backup artifact contains the data you need. Restore order is
schema first (migrations), then data, then users.

### 4.1 Create a new Supabase project

Create it in the **same region** (`ap-southeast-1`) and save the database
password. Capture the new project URL (`https://<newref>.supabase.co`).

`relaunch_supabase.sh` derives `<newref>` from the URL and derives the pooler
host for the default region. If the project is created in another region,
pass `NEW_SUPABASE_POOLER_HOST`.

### 4.2 Download the backup artifact

Via the GitHub UI: Actions -> **Backup Supabase** -> latest run -> Artifacts ->
download `supabase-backup-<date>-<run_id>`.

Via `gh`:

```bash
gh run list --workflow=backup-supabase.yml --limit 5
gh run download <run-id> -n "supabase-backup-<date>-<run_id>" -D /tmp/lp-restore
find /tmp/lp-restore -name 'supabase-*.dump*'
```

Artifacts are retained for 90 days.

### 4.3 Install a matching PostgreSQL client

The project is Postgres 17. `pg_dump`/`pg_restore` must be version 17 or newer.

```bash
# Ubuntu / Debian (PGDG)
sudo install -d /usr/share/postgresql-common/pgdg
sudo curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
  https://www.postgresql.org/media/keys/ACCC4CF8.asc
. /etc/os-release
echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
  | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
sudo apt-get update && sudo apt-get install -y postgresql-client-17
pg_dump --version

# macOS
brew install postgresql@17
```

### 4.4 Run the restore

```bash
export NEW_SUPABASE_URL="https://<newref>.supabase.co"
export NEW_DB_PASSWORD="<new database password>"

# If the dump is encrypted, also set:
# export BACKUP_PASSPHRASE="<backup passphrase>"

bash scripts/relaunch_supabase.sh \
  --dump /tmp/lp-restore/supabase-<ref>-<timestamp>.dump \
  --yes
```

What the script does:

1. Guards on `--yes` (destructive).
2. Applies every `supabase/migrations/*.sql` in lexical order via `psql`.
3. Temporarily drops the `on_auth_user_created` trigger on `auth.users` so the
   auth COPY does not auto-create `public.profiles` rows that the public COPY
   would then try to insert again.
4. Best-effort `pg_restore --table=auth.users` then `--table=auth.identities`
   (users before identities). A new project has **zero** auth users, so this
   normally succeeds; failures are non-fatal.
5. `pg_restore --data-only --no-owner --no-privileges --schema=public`. Auth is
   already loaded, so FKs into `auth.users` resolve. If this fails after auth
   succeeded, the script stops with an error.
6. Recreates the `on_auth_user_created` trigger (done even if auth failed).
7. Prints row counts for `profiles`, `edit_windows` and the four `*_draft`
   tables.
8. Prints the follow-up checklist (section 8).

### 4.5 Foreign keys into `auth.users`

`public.*` references `auth.users(id)` in several places: `public.profiles.id`
(`profiles_id_fkey`), the `created_by`/`updated_by` columns on the four
`*_draft` tables, `published_by` on the four `*_published` tables, `opened_by`
on `edit_windows`, and `user_id` on `audit_log`.

The script restores `auth.users`/`auth.identities` **before** `public` so those
FKs resolve on a normal run. If auth restore fails, the public restore may hit
FK violations on rows whose user columns point at users that no longer exist.
Two recovery options:

**(a) Recreate the users, then re-run the public restore (preferred).** Follow
section 6 to create users via the Admin API. To preserve the original UUIDs,
restore auth first, then the public data:

```bash
# decrypt if needed
gpg --batch --decrypt --output /tmp/supa.dump backup.dump.gpg   # prompts for passphrase

PGPASSWORD="$NEW_DB_PASSWORD" pg_restore \
  --host=aws-0-ap-southeast-1.pooler.supabase.com --port=5432 \
  --username="postgres.<newref>" --dbname=postgres \
  --data-only --no-owner --no-privileges \
  --table=auth.users --table=auth.identities /tmp/supa.dump

PGPASSWORD="$NEW_DB_PASSWORD" pg_restore \
  --host=aws-0-ap-southeast-1.pooler.supabase.com --port=5432 \
  --username="postgres.<newref>" --dbname=postgres \
  --data-only --no-owner --no-privileges --schema=public /tmp/supa.dump
```

If the first public attempt partially inserted rows, re-run against a fresh
project (or clear the affected tables) to avoid duplicate-key errors.

**(b) Last resort - keep the data, drop attribution.** Users cannot be
recovered, so you accept losing all `created_by`-style attribution. Plain COPY
cannot insert dangling FK values, so drop the constraints, restore the public
data, repair the orphaned references, then re-add the constraints. Run all of
this against the NEW project (psql / SQL editor):

```sql
-- 1. drop the FKs into auth.users
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.ruas_jalan_draft drop constraint if exists ruas_jalan_draft_created_by_fkey;
alter table public.ruas_jalan_draft drop constraint if exists ruas_jalan_draft_updated_by_fkey;
alter table public.sekolah_draft     drop constraint if exists sekolah_draft_created_by_fkey;
alter table public.sekolah_draft     drop constraint if exists sekolah_draft_updated_by_fkey;
alter table public.rambu_draft       drop constraint if exists rambu_draft_created_by_fkey;
alter table public.rambu_draft       drop constraint if exists rambu_draft_updated_by_fkey;
alter table public.apj_draft         drop constraint if exists apj_draft_created_by_fkey;
alter table public.apj_draft         drop constraint if exists apj_draft_updated_by_fkey;
alter table public.ruas_jalan_published drop constraint if exists ruas_jalan_published_published_by_fkey;
alter table public.sekolah_published    drop constraint if exists sekolah_published_published_by_fkey;
alter table public.rambu_published      drop constraint if exists rambu_published_published_by_fkey;
alter table public.apj_published        drop constraint if exists apj_published_published_by_fkey;
alter table public.edit_windows drop constraint if exists edit_windows_opened_by_fkey;
alter table public.audit_log    drop constraint if exists audit_log_user_id_fkey;
```

```bash
# 2. restore just the public data (constraints are still absent)
PGPASSWORD="$NEW_DB_PASSWORD" pg_restore \
  --host=aws-0-ap-southeast-1.pooler.supabase.com --port=5432 \
  --username="postgres.<newref>" --dbname=postgres \
  --data-only --no-owner --no-privileges --schema=public /tmp/supa.dump
```

```sql
-- 3. orphaned profile rows are unusable without their auth user - remove them
delete from public.profiles p
 where not exists (select 1 from auth.users u where u.id = p.id);

-- and NULL the (nullable) attribution columns
update public.ruas_jalan_draft set created_by = null, updated_by = null;
update public.sekolah_draft   set created_by = null, updated_by = null;
update public.rambu_draft     set created_by = null, updated_by = null;
update public.apj_draft       set created_by = null, updated_by = null;
update public.ruas_jalan_published set published_by = null;
update public.sekolah_published    set published_by = null;
update public.rambu_published      set published_by = null;
update public.apj_published        set published_by = null;
update public.edit_windows set opened_by = null;
update public.audit_log    set user_id = null;
```

```sql
-- 4. re-add the constraints (now every value is NULL or valid)
alter table public.profiles
  add constraint profiles_id_fkey foreign key (id) references auth.users (id) on delete cascade;

alter table public.ruas_jalan_draft
  add constraint ruas_jalan_draft_created_by_fkey foreign key (created_by) references auth.users (id),
  add constraint ruas_jalan_draft_updated_by_fkey foreign key (updated_by) references auth.users (id);
alter table public.sekolah_draft
  add constraint sekolah_draft_created_by_fkey foreign key (created_by) references auth.users (id),
  add constraint sekolah_draft_updated_by_fkey foreign key (updated_by) references auth.users (id);
alter table public.rambu_draft
  add constraint rambu_draft_created_by_fkey foreign key (created_by) references auth.users (id),
  add constraint rambu_draft_updated_by_fkey foreign key (updated_by) references auth.users (id);
alter table public.apj_draft
  add constraint apj_draft_created_by_fkey foreign key (created_by) references auth.users (id),
  add constraint apj_draft_updated_by_fkey foreign key (updated_by) references auth.users (id);

alter table public.ruas_jalan_published
  add constraint ruas_jalan_published_published_by_fkey foreign key (published_by) references auth.users (id);
alter table public.sekolah_published
  add constraint sekolah_published_published_by_fkey foreign key (published_by) references auth.users (id);
alter table public.rambu_published
  add constraint rambu_published_published_by_fkey foreign key (published_by) references auth.users (id);
alter table public.apj_published
  add constraint apj_published_published_by_fkey foreign key (published_by) references auth.users (id);

alter table public.edit_windows
  add constraint edit_windows_opened_by_fkey foreign key (opened_by) references auth.users (id);
alter table public.audit_log
  add constraint audit_log_user_id_fkey foreign key (user_id) references auth.users (id);
```

---

## 5. Tier 3 - Baseline rebuild from the portal parquet

Use when no usable backup exists. This rebuilds the four `*_draft` tables from
the public portal's parquet (the public site is the source of truth for
geospatial baseline data). `profiles` and `edit_windows` start empty and must be
recreated (sections 6 and 7).

Prerequisites: a `lintaspeta-web` checkout and `pyarrow` + `psycopg2`.

```bash
python -m pip install pyarrow psycopg2-binary   # psycopg2-binary for local use

export NEW_SUPABASE_URL="https://<newref>.supabase.co"
export NEW_DB_PASSWORD="<new database password>"
export PORTAL_PATH="/path/to/lintaspeta-web"

bash scripts/relaunch_supabase.sh --seed --yes
```

The script applies migrations, then runs:

```bash
python scripts/bootstrap_seed.py --portal "$PORTAL_PATH" --drop
```

with `SUPABASE_URL`/`SUPABASE_DB_PASSWORD` pointed at the new project. Row
counts are printed at the end. This produces baseline data only - any edits that
existed only in the lost project are not recoverable.

---

## 6. Recreate `auth.users`, profiles and edit_windows

Do this when the auth restore in Tier 2 failed, or after Tier 3.

### 6.1 Create users with the Admin API

`app_metadata.role` drives RLS (`public.current_role()`); `app_metadata.region`
scopes editors (`public.current_region()`). `region: null` means all regions.

```bash
export NEW_SUPABASE_URL="https://<newref>.supabase.co"
export SERVICE_ROLE_KEY="<new service_role key>"

curl -sS -X POST "$NEW_SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "email": "admin@example.com",
        "password": "REPLACE_WITH_A_STRONG_PASSWORD",
        "email_confirm": true,
        "app_metadata": { "role": "super_admin", "region": null },
        "user_metadata": { "full_name": "Super Admin" }
      }'
```

Creating a user inserts into `auth.users`, which fires the
`on_auth_user_created` trigger and auto-creates the matching `public.profiles`
row from `app_metadata.role` / `app_metadata.region` and
`user_metadata.full_name`.

Editor example (region must match the dataset `region` column):

```bash
curl -sS -X POST "$NEW_SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
        "email": "uptd1@example.com",
        "password": "REPLACE_WITH_A_STRONG_PASSWORD",
        "email_confirm": true,
        "app_metadata": { "role": "editor", "region": "UPTD 1" },
        "user_metadata": { "full_name": "Editor UPTD 1" }
      }'
```

List created users and their UUIDs:

```bash
curl -sS "$NEW_SUPABASE_URL/auth/v1/admin/users?per_page=200" \
  -H "apikey: $SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  | python -c "import sys,json; [print(u['id'], u['email'], u.get('app_metadata',{})) for u in json.load(sys.stdin)['users']]"
```

### 6.2 Fix profile rows if the trigger did not populate them

The trigger only runs on **insert**; restoring old profiles that reference
missing users will fail. Upsert explicitly when needed:

```sql
insert into public.profiles (id, role, region, full_name)
values ('<user-uuid>', 'super_admin', null, 'Super Admin')
on conflict (id) do update
  set role = excluded.role,
      region = excluded.region,
      full_name = excluded.full_name;
```

Edit windows to toggle is covered below.

> Note: users recreated via the Admin API get **new UUIDs**, so any
> `created_by`/`updated_by`/`published_by`/`user_id` values restored from backup
> will not point at them. Clear those columns (section 4.5) or accept the
> attribution loss.

---

## 7. Open edit windows

Editors can only modify data when the dataset's edit window is open. A
`super_admin` toggles it from the dashboard's dataset editor (**Buka** button),
which upserts `public.edit_windows`. To do it directly:

```sql
insert into public.edit_windows (dataset, open, opened_at, note)
values ('ruas_jalan', true, now(), 'post-relaunch')
on conflict (dataset) do update
  set open = true, opened_at = now(), note = excluded.note;

-- repeat for 'sekolah', 'rambu', 'apj'
```

Valid `dataset` values: `ruas_jalan`, `sekolah`, `rambu`, `apj`.
Close a window by setting `open = false`.

---

## 8. Update env, secrets and redeploy

Run through this checklist after any relaunch, using the **new** project's
Settings -> API values.

1. **Local `.env.local`** (gitignored):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_DB_PASSWORD`

2. **Cloudflare Pages** (dashboard project: Settings -> Environment variables):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   Then trigger a redeploy (push to `main` or "Retry deployment").

3. **GitHub repository secrets** (Settings -> Secrets and variables -> Actions):
   - `SUPABASE_URL` = new project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = new service_role key
   - `SUPABASE_DB_PASSWORD` = new database password
   - `BACKUP_PASSPHRASE` = passphrase used to encrypt dumps (add if missing)

4. **Verify**: sign in as each role, confirm dataset counts, open an edit window,
   save a feature, and press publish once. Confirm the portal workflow
   (`publish-data.yml`) succeeds afterwards.

---

## 9. How the backup workflow works

`.github/workflows/backup-supabase.yml` runs daily at `02:30 UTC` and on
`workflow_dispatch`. It:

1. Installs the PostgreSQL 17 client from PGDG (Ubuntu's default client is
   older than the Postgres 17 server, and `pg_dump` refuses to dump a newer
   server).
2. Runs `scripts/backup_supabase.sh`, which dumps `public` + `auth` in custom
   format from the session pooler (port `5432`).
3. If `BACKUP_PASSPHRASE` is set, encrypts the dump with AES256 and deletes the
   plaintext.
4. Uploads `backups/` as artifact `supabase-backup-<date>-<run_id>` with
   `retention-days: 90`.

Local run (uses `.env.local` when env vars are unset):

```bash
bash scripts/backup_supabase.sh --out-dir backups
```

To restore an artifact, see section 4.2 and 4.4.

---

## 10. Required GitHub secrets

| Secret | Purpose | Used by |
| --- | --- | --- |
| `SUPABASE_URL` | Project URL `https://<ref>.supabase.co` | backup, publish, keep-awake |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key (REST/admin access) | publish, keep-awake |
| `SUPABASE_DB_PASSWORD` | Postgres password for `postgres.<ref>` | backup |
| `BACKUP_PASSPHRASE` | GPG passphrase for encrypted dumps | backup |
| `CLOUDFLARE_API_TOKEN` | Deploy the public portal | publish |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id | publish |
| `PORTAL_REPO_TOKEN` | Push parquet to `gabernov/lintaspeta-web` | publish |

`SUPABASE_ANON_KEY` is **no longer required**: the keep-awake workflow now uses
`SUPABASE_SERVICE_ROLE_KEY`, and no other workflow references it. It can be
deleted from the repository secrets.

After a relaunch, update `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and
`SUPABASE_DB_PASSWORD` to the new project's values; keep `BACKUP_PASSPHRASE`,
the Cloudflare secrets and `PORTAL_REPO_TOKEN` unchanged.
`scripts/relaunch_supabase.sh` never reads old project credentials - it derives
everything from `NEW_SUPABASE_URL`.
