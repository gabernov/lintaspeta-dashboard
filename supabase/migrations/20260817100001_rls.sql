-- lintas-dashboard: RLS policies
-- Model: super_admin = all access always; editor = own region + window open; viewer = read-only
-- Region scoping: ruas_jalan & apj -> UPTD (region col); sekolah & rambu -> kabupaten (region col)
-- Track B (field marking): INSERT with source_type='field' allowed ANYTIME (window not required); UPDATE/DELETE still gated.

-- Helper: current user role from JWT app_metadata (wrapped in SELECT for RLS perf)
create or replace function public.current_role()
returns text
language sql
stable
as $$
  select coalesce((select auth.jwt() -> 'app_metadata' ->> 'role'), 'viewer')
$$;

create or replace function public.current_region()
returns text
language sql
stable
as $$
  select (select auth.jwt() -> 'app_metadata' ->> 'region')
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
as $$
  select (select public.current_role()) = 'super_admin'
$$;

-- ============================================================
-- profiles
-- ============================================================
alter table public.profiles enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (true);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (
    auth.uid() = id
    and role = (select role from public.profiles where id = auth.uid()) -- no self-escalation
    and region is not distinct from (select region from public.profiles where id = auth.uid())
  );

-- ============================================================
-- edit_windows (super_admin only)
-- ============================================================
alter table public.edit_windows enable row level security;

drop policy if exists edit_windows_select on public.edit_windows;
create policy edit_windows_select on public.edit_windows
  for select to authenticated
  using (true);

drop policy if exists edit_windows_admin on public.edit_windows;
create policy edit_windows_admin on public.edit_windows
  for insert to authenticated
  with check (public.is_super_admin());
create policy edit_windows_admin_update on public.edit_windows
  for update to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());
create policy edit_windows_admin_delete on public.edit_windows
  for delete to authenticated
  using (public.is_super_admin());

-- ============================================================
-- audit_log (super_admin read; writes via trigger SECURITY DEFINER)
-- ============================================================
alter table public.audit_log enable row level security;

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_super_admin());

-- ============================================================
-- Draft tables RLS
-- Pattern per dataset (X = ruas_jalan/sekolah/rambu/apj):
--   SELECT: authenticated (all roles)
--   INSERT: super_admin OR (editor AND region match AND (window open OR source_type='field'))
--   UPDATE: super_admin OR (editor AND region match AND window open AND target row is not published-locked)
--   DELETE: super_admin OR (editor AND region match AND window open)
-- ============================================================

-- ---------- ruas_jalan_draft ----------
alter table public.ruas_jalan_draft enable row level security;

create or replace function public.ruas_jalan_window_open()
returns boolean language sql stable as $$
  select coalesce((select open from public.edit_windows where dataset = 'ruas_jalan'), false)
$$;

drop policy if exists ruas_jalan_select on public.ruas_jalan_draft;
create policy ruas_jalan_select on public.ruas_jalan_draft
  for select to authenticated using (true);

drop policy if exists ruas_jalan_insert on public.ruas_jalan_draft;
create policy ruas_jalan_insert on public.ruas_jalan_draft
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and (public.ruas_jalan_window_open() or source_type = 'field')
    )
  );

drop policy if exists ruas_jalan_update on public.ruas_jalan_draft;
create policy ruas_jalan_update on public.ruas_jalan_draft
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.ruas_jalan_window_open()
    )
  )
  with check (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.ruas_jalan_window_open()
    )
  );

drop policy if exists ruas_jalan_delete on public.ruas_jalan_draft;
create policy ruas_jalan_delete on public.ruas_jalan_draft
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.ruas_jalan_window_open()
    )
  );

-- ---------- sekolah_draft ----------
alter table public.sekolah_draft enable row level security;

create or replace function public.sekolah_window_open()
returns boolean language sql stable as $$
  select coalesce((select open from public.edit_windows where dataset = 'sekolah'), false)
$$;

drop policy if exists sekolah_select on public.sekolah_draft;
create policy sekolah_select on public.sekolah_draft
  for select to authenticated using (true);

drop policy if exists sekolah_insert on public.sekolah_draft;
create policy sekolah_insert on public.sekolah_draft
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and (public.sekolah_window_open() or source_type = 'field')
    )
  );

drop policy if exists sekolah_update on public.sekolah_draft;
create policy sekolah_update on public.sekolah_draft
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.sekolah_window_open()
    )
  )
  with check (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.sekolah_window_open()
    )
  );

drop policy if exists sekolah_delete on public.sekolah_draft;
create policy sekolah_delete on public.sekolah_draft
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.sekolah_window_open()
    )
  );

-- ---------- rambu_draft ----------
alter table public.rambu_draft enable row level security;

create or replace function public.rambu_window_open()
returns boolean language sql stable as $$
  select coalesce((select open from public.edit_windows where dataset = 'rambu'), false)
$$;

drop policy if exists rambu_select on public.rambu_draft;
create policy rambu_select on public.rambu_draft
  for select to authenticated using (true);

drop policy if exists rambu_insert on public.rambu_draft;
create policy rambu_insert on public.rambu_draft
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and (public.rambu_window_open() or source_type = 'field')
    )
  );

drop policy if exists rambu_update on public.rambu_draft;
create policy rambu_update on public.rambu_draft
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.rambu_window_open()
    )
  )
  with check (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.rambu_window_open()
    )
  );

drop policy if exists rambu_delete on public.rambu_draft;
create policy rambu_delete on public.rambu_draft
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.rambu_window_open()
    )
  );

-- ---------- apj_draft ----------
alter table public.apj_draft enable row level security;

create or replace function public.apj_window_open()
returns boolean language sql stable as $$
  select coalesce((select open from public.edit_windows where dataset = 'apj'), false)
$$;

drop policy if exists apj_select on public.apj_draft;
create policy apj_select on public.apj_draft
  for select to authenticated using (true);

drop policy if exists apj_insert on public.apj_draft;
create policy apj_insert on public.apj_draft
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and (public.apj_window_open() or source_type = 'field')
    )
  );

drop policy if exists apj_update on public.apj_draft;
create policy apj_update on public.apj_draft
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.apj_window_open()
    )
  )
  with check (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.apj_window_open()
    )
  );

drop policy if exists apj_delete on public.apj_draft;
create policy apj_delete on public.apj_draft
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.apj_window_open()
    )
  );

-- ============================================================
-- Published tables RLS (dashboard reads; writes via publish fn SECURITY DEFINER)
-- ============================================================
alter table public.ruas_jalan_published enable row level security;
drop policy if exists ruas_jalan_published_select on public.ruas_jalan_published;
create policy ruas_jalan_published_select on public.ruas_jalan_published
  for select to authenticated using (true);

alter table public.sekolah_published enable row level security;
drop policy if exists sekolah_published_select on public.sekolah_published;
create policy sekolah_published_select on public.sekolah_published
  for select to authenticated using (true);

alter table public.rambu_published enable row level security;
drop policy if exists rambu_published_select on public.rambu_published;
create policy rambu_published_select on public.rambu_published
  for select to authenticated using (true);

alter table public.apj_published enable row level security;
drop policy if exists apj_published_select on public.apj_published;
create policy apj_published_select on public.apj_published
  for select to authenticated using (true);

-- published tables have no direct write policies -> only SECURITY DEFINER publish fn can write.
