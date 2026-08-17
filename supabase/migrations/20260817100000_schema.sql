-- lintas-dashboard: initial schema
-- Supabase project ref: ievtxzlxosqsewvsgmft
-- Pattern: staged publishing (draft -> approved -> published snapshot)
-- Each dataset has a DRAFT table (editors write) + PUBLISHED snapshot table (exported to public portal).

-- ============================================================
-- Extensions
-- ============================================================
create extension if not exists postgis;
create extension if not exists "pgcrypto";

-- ============================================================
-- profiles (synced from auth.users)
-- ============================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'viewer'
    check (role in ('super_admin', 'editor', 'viewer')),
  region text,                -- UPTD code (ruas_jalan/apj) or kabupaten name (sekolah/rambu); null = all regions
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- auto-create profile row on signup (role/region come from raw_app_metadata set via Admin API)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, region, full_name)
  values (
    new.id,
    coalesce(new.raw_app_meta_data ->> 'role', 'viewer'),
    new.raw_app_meta_data ->> 'region',
    new.raw_user_meta_data ->> 'full_name'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- edit_windows (super_admin gates editing per dataset)
-- ============================================================
create table if not exists public.edit_windows (
  dataset text primary key
    check (dataset in ('ruas_jalan', 'sekolah', 'rambu', 'apj')),
  open boolean not null default false,
  opened_by uuid references auth.users (id),
  opened_at timestamptz,
  note text
);

-- ============================================================
-- audit_log (who changed what, when)
-- ============================================================
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data jsonb,
  new_data jsonb,
  user_id uuid references auth.users (id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Dataset DRAFT tables (editors write here)
-- Generic shape: source_id (original PK), geometry, properties (original parquet columns), region (RLS scope), status, source_type
-- ============================================================

-- 1. ruas_jalan (PK: id string, geometry: MultiLineString, region: unit_kerja_kode)
create table if not exists public.ruas_jalan_draft (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique,          -- original 'id' from parquet
  geometry geometry(Geometry, 4326) not null,
  properties jsonb not null default '{}'::jsonb,
  region text not null default '',          -- unit_kerja_kode (UPTD-I..IV)
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'rejected')),
  source_type text not null default 'master'
    check (source_type in ('master', 'field')),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. sekolah (PK: NPSN string, geometry: Point, region: KABUPATEN)
create table if not exists public.sekolah_draft (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique,          -- NPSN
  geometry geometry(Geometry, 4326) not null,
  properties jsonb not null default '{}'::jsonb,
  region text not null default '',          -- KABUPATEN
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'rejected')),
  source_type text not null default 'master'
    check (source_type in ('master', 'field')),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. rambu (PK: kode_ruas string, geometry: Point, region: kabupaten via mapping)
create table if not exists public.rambu_draft (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique,          -- kode_ruas
  geometry geometry(Geometry, 4326) not null,
  properties jsonb not null default '{}'::jsonb,
  region text not null default '',          -- kabupaten (derived from kode_ruas->lokasi mapping at import)
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'rejected')),
  source_type text not null default 'master'
    check (source_type in ('master', 'field')),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4. apj (PK: Id_Tiang string, geometry: Point, region: UPTD)
create table if not exists public.apj_draft (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique,          -- Id_Tiang
  geometry geometry(Geometry, 4326) not null,
  properties jsonb not null default '{}'::jsonb,
  region text not null default '',          -- UPTD ("UPTD 1".."UPTD 4")
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'rejected')),
  source_type text not null default 'master'
    check (source_type in ('master', 'field')),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- Dataset PUBLISHED snapshot tables (exported to public portal)
-- ============================================================

create table if not exists public.ruas_jalan_published (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique,
  geometry geometry(Geometry, 4326) not null,
  properties jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id)
);

create table if not exists public.sekolah_published (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique,
  geometry geometry(Geometry, 4326) not null,
  properties jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id)
);

create table if not exists public.rambu_published (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique,
  geometry geometry(Geometry, 4326) not null,
  properties jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id)
);

create table if not exists public.apj_published (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique,
  geometry geometry(Geometry, 4326) not null,
  properties jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id)
);

-- ============================================================
-- Publish function: snapshot approved drafts -> published table (per dataset)
-- Security definer: called only by super_admin (checked in RLS/app)
-- ============================================================
create or replace function public.publish_dataset(p_dataset text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  case p_dataset
    when 'ruas_jalan' then
      delete from public.ruas_jalan_published;
      insert into public.ruas_jalan_published (source_id, geometry, properties, published_at, published_by)
      select source_id, geometry, properties, now(), auth.uid()
      from public.ruas_jalan_draft
      where status in ('approved', 'pending') or source_type = 'field';
      get diagnostics v_count = row_count;
    when 'sekolah' then
      delete from public.sekolah_published;
      insert into public.sekolah_published (source_id, geometry, properties, published_at, published_by)
      select source_id, geometry, properties, now(), auth.uid()
      from public.sekolah_draft
      where status in ('approved', 'pending') or source_type = 'field';
      get diagnostics v_count = row_count;
    when 'rambu' then
      delete from public.rambu_published;
      insert into public.rambu_published (source_id, geometry, properties, published_at, published_by)
      select source_id, geometry, properties, now(), auth.uid()
      from public.rambu_draft
      where status in ('approved', 'pending') or source_type = 'field';
      get diagnostics v_count = row_count;
    when 'apj' then
      delete from public.apj_published;
      insert into public.apj_published (source_id, geometry, properties, published_at, published_by)
      select source_id, geometry, properties, now(), auth.uid()
      from public.apj_draft
      where status in ('approved', 'pending') or source_type = 'field';
      get diagnostics v_count = row_count;
    else
      raise exception 'unknown dataset: %', p_dataset;
  end case;
  return v_count;
end;
$$;

-- ============================================================
-- Audit trigger helper (generic)
-- ============================================================
create or replace function public.log_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_log (table_name, record_id, action, old_data, new_data, user_id)
  values (
    tg_table_name,
    coalesce(new.source_id::text, old.source_id::text, new.id::text, old.id::text),
    tg_op,
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end,
    auth.uid()
  );
  return coalesce(new, old);
end;
$$;

-- audit triggers on draft tables (published tables are written by publish fn - logged there too)
drop trigger if exists audit_ruas_jalan on public.ruas_jalan_draft;
create trigger audit_ruas_jalan after insert or update or delete on public.ruas_jalan_draft
  for each row execute procedure public.log_audit();
drop trigger if exists audit_sekolah on public.sekolah_draft;
create trigger audit_sekolah after insert or update or delete on public.sekolah_draft
  for each row execute procedure public.log_audit();
drop trigger if exists audit_rambu on public.rambu_draft;
create trigger audit_rambu after insert or update or delete on public.rambu_draft
  for each row execute procedure public.log_audit();
drop trigger if exists audit_apj on public.apj_draft;
create trigger audit_apj after insert or update or delete on public.apj_draft
  for each row execute procedure public.log_audit();

-- spatial indexes
create index if not exists idx_ruas_jalan_draft_geom on public.ruas_jalan_draft using gist (geometry);
create index if not exists idx_sekolah_draft_geom on public.sekolah_draft using gist (geometry);
create index if not exists idx_rambu_draft_geom on public.rambu_draft using gist (geometry);
create index if not exists idx_apj_draft_geom on public.apj_draft using gist (geometry);
create index if not exists idx_ruas_jalan_pub_geom on public.ruas_jalan_published using gist (geometry);
create index if not exists idx_sekolah_pub_geom on public.sekolah_published using gist (geometry);
create index if not exists idx_rambu_pub_geom on public.rambu_published using gist (geometry);
create index if not exists idx_apj_pub_geom on public.apj_published using gist (geometry);
-- region index for RLS performance
create index if not exists idx_ruas_jalan_draft_region on public.ruas_jalan_draft (region);
create index if not exists idx_sekolah_draft_region on public.sekolah_draft (region);
create index if not exists idx_rambu_draft_region on public.rambu_draft (region);
create index if not exists idx_apj_draft_region on public.apj_draft (region);
