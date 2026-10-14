-- lintas-dashboard: add dataset 'pengawasan_angkutan_barang'
-- Freight-supervision points (rambu kelas jalan / rambu MST / rambu pembatasan /
-- lokasi tambang), seeded from the public Rambu map. Mirrors the rambu dataset
-- shape (Point geometry) and is wired into every RPC that maps dataset -> table.

-- ============================================================
-- 1. Tables (draft + published snapshot)
-- ============================================================
create table if not exists public.pengawasan_angkutan_barang_draft (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique,
  geometry geometry(Geometry, 4326) not null,
  properties jsonb not null default '{}'::jsonb,
  region text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'rejected')),
  source_type text not null default 'master'
    check (source_type in ('master', 'field')),
  created_by uuid references auth.users (id),
  updated_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pengawasan_angkutan_barang_published (
  id uuid primary key default gen_random_uuid(),
  source_id text not null unique,
  geometry geometry(Geometry, 4326) not null,
  properties jsonb not null default '{}'::jsonb,
  published_at timestamptz not null default now(),
  published_by uuid references auth.users (id)
);

create index if not exists idx_pengawasan_draft_geom on public.pengawasan_angkutan_barang_draft using gist (geometry);
create index if not exists idx_pengawasan_draft_region on public.pengawasan_angkutan_barang_draft (region);
create index if not exists idx_pengawasan_pub_geom on public.pengawasan_angkutan_barang_published using gist (geometry);

-- ============================================================
-- 2. edit_windows: allow the new dataset
-- ============================================================
alter table public.edit_windows drop constraint if exists edit_windows_dataset_check;
alter table public.edit_windows add constraint edit_windows_dataset_check
  check (dataset in ('ruas_jalan', 'sekolah', 'rambu', 'apj', 'pengawasan_angkutan_barang'));

-- ============================================================
-- 3. RLS (same model as the other datasets)
-- ============================================================
alter table public.pengawasan_angkutan_barang_draft enable row level security;

create or replace function public.pengawasan_angkutan_barang_window_open()
returns boolean language sql stable as $$
  select coalesce((select open from public.edit_windows where dataset = 'pengawasan_angkutan_barang'), false)
$$;

drop policy if exists pengawasan_select on public.pengawasan_angkutan_barang_draft;
create policy pengawasan_select on public.pengawasan_angkutan_barang_draft
  for select to authenticated using (true);

drop policy if exists pengawasan_insert on public.pengawasan_angkutan_barang_draft;
create policy pengawasan_insert on public.pengawasan_angkutan_barang_draft
  for insert to authenticated
  with check (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and (public.pengawasan_angkutan_barang_window_open() or source_type = 'field')
    )
  );

drop policy if exists pengawasan_update on public.pengawasan_angkutan_barang_draft;
create policy pengawasan_update on public.pengawasan_angkutan_barang_draft
  for update to authenticated
  using (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.pengawasan_angkutan_barang_window_open()
    )
  )
  with check (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.pengawasan_angkutan_barang_window_open()
    )
  );

drop policy if exists pengawasan_delete on public.pengawasan_angkutan_barang_draft;
create policy pengawasan_delete on public.pengawasan_angkutan_barang_draft
  for delete to authenticated
  using (
    public.is_super_admin()
    or (
      (select public.current_role()) = 'editor'
      and (region = public.current_region() or public.current_region() is null)
      and public.pengawasan_angkutan_barang_window_open()
    )
  );

alter table public.pengawasan_angkutan_barang_published enable row level security;
drop policy if exists pengawasan_published_select on public.pengawasan_angkutan_barang_published;
create policy pengawasan_published_select on public.pengawasan_angkutan_barang_published
  for select to authenticated using (true);

-- ============================================================
-- 4. Audit trigger
-- ============================================================
drop trigger if exists audit_pengawasan on public.pengawasan_angkutan_barang_draft;
create trigger audit_pengawasan after insert or update or delete on public.pengawasan_angkutan_barang_draft
  for each row execute procedure public.log_audit();

-- ============================================================
-- 5. RPCs: add the dataset to every dataset -> table mapping
-- ============================================================
create or replace function public.draft_features_geojson(p_dataset text)
returns jsonb
language plpgsql
as $$
declare
  v_table text;
  v_result jsonb;
begin
  case p_dataset
    when 'ruas_jalan' then v_table := 'ruas_jalan_draft';
    when 'sekolah' then v_table := 'sekolah_draft';
    when 'rambu' then v_table := 'rambu_draft';
    when 'apj' then v_table := 'apj_draft';
    when 'pengawasan_angkutan_barang' then v_table := 'pengawasan_angkutan_barang_draft';
    else raise exception 'unknown dataset: %', p_dataset;
  end case;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
        ''type'', ''Feature'',
        ''id'', id::text,
        ''geometry'', st_asgeojson(geometry)::jsonb,
        ''properties'', properties || jsonb_build_object(
          ''_region'', region,
          ''_status'', status,
          ''_source_type'', source_type,
          ''_source_id'', source_id
        )
      )), ''[]''::jsonb)
     from %I',
    v_table
  ) into v_result;

  return jsonb_build_object('type', 'FeatureCollection', 'features', v_result);
end;
$$;

create or replace function public.draft_features_geojson(
  p_dataset text,
  p_light boolean default false
)
returns jsonb
language plpgsql
as $$
declare
  v_table text;
  v_result jsonb;
begin
  perform set_config('statement_timeout', '180000', false);

  case p_dataset
    when 'ruas_jalan' then v_table := 'ruas_jalan_draft';
    when 'sekolah' then v_table := 'sekolah_draft';
    when 'rambu' then v_table := 'rambu_draft';
    when 'apj' then v_table := 'apj_draft';
    when 'pengawasan_angkutan_barang' then v_table := 'pengawasan_angkutan_barang_draft';
    else raise exception 'unknown dataset: %', p_dataset;
  end case;

  if p_light then
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(
          ''type'', ''Feature'',
          ''id'', id::text,
          ''geometry'', st_asgeojson(geometry)::jsonb,
          ''properties'', jsonb_build_object(
            ''_region'', region,
            ''_status'', status,
            ''_source_type'', source_type,
            ''_source_id'', source_id
          )
        )), ''[]''::jsonb)
       from %I',
      v_table
    ) into v_result;
  else
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(
          ''type'', ''Feature'',
          ''id'', id::text,
          ''geometry'', st_asgeojson(geometry)::jsonb,
          ''properties'', properties || jsonb_build_object(
            ''_region'', region,
            ''_status'', status,
            ''_source_type'', source_type,
            ''_source_id'', source_id
          )
        )), ''[]''::jsonb)
       from %I',
      v_table
    ) into v_result;
  end if;

  return jsonb_build_object('type', 'FeatureCollection', 'features', v_result);
end;
$$;

create or replace function public.draft_feature_detail(p_dataset text, p_id uuid)
returns jsonb
language plpgsql
as $$
declare
  v_table text;
  v_row record;
begin
  case p_dataset
    when 'ruas_jalan' then v_table := 'ruas_jalan_draft';
    when 'sekolah' then v_table := 'sekolah_draft';
    when 'rambu' then v_table := 'rambu_draft';
    when 'apj' then v_table := 'apj_draft';
    when 'pengawasan_angkutan_barang' then v_table := 'pengawasan_angkutan_barang_draft';
    else raise exception 'unknown dataset: %', p_dataset;
  end case;

  execute format(
    'select id, st_asgeojson(geometry)::jsonb as geometry,
            properties || jsonb_build_object(
              ''_region'', region, ''_status'', status,
              ''_source_type'', source_type, ''_source_id'', source_id
            ) as properties
     from %I where id = %L',
    v_table, p_id
  ) into v_row;

  if v_row is null then
    return null;
  end if;

  return jsonb_build_object(
    'type', 'Feature',
    'id', v_row.id::text,
    'geometry', v_row.geometry,
    'properties', v_row.properties
  );
end;
$$;

create or replace function public.save_draft_feature(
  p_dataset text,
  p_id uuid default null,
  p_source_id text default null,
  p_geometry jsonb default null,
  p_properties jsonb default '{}'::jsonb,
  p_region text default '',
  p_source_type text default 'master'
)
returns jsonb
language plpgsql
as $$
declare
  v_table text;
  v_geom geometry;
  v_new_id uuid;
begin
  case p_dataset
    when 'ruas_jalan' then v_table := 'ruas_jalan_draft';
    when 'sekolah' then v_table := 'sekolah_draft';
    when 'rambu' then v_table := 'rambu_draft';
    when 'apj' then v_table := 'apj_draft';
    when 'pengawasan_angkutan_barang' then v_table := 'pengawasan_angkutan_barang_draft';
    else raise exception 'unknown dataset: %', p_dataset;
  end case;

  if p_geometry is null then
    raise exception 'geometry is required';
  end if;

  v_geom := st_setsrid(st_geomfromgeojson(p_geometry), 4326);

  if p_id is null then
    execute format(
      'insert into %I (source_id, geometry, properties, region, source_type, status, created_by, updated_by)
       values (%L, %L, %L::jsonb, %L, %L, ''pending'', auth.uid(), auth.uid())
       returning id',
      v_table, p_source_id, v_geom, p_properties, p_region, p_source_type
    ) into v_new_id;
  else
    execute format(
      'update %I set
         geometry = %L,
         properties = %L::jsonb,
         region = %L,
         source_type = %L,
         status = case when status = ''approved'' then ''pending'' else status end,
         updated_by = auth.uid(),
         updated_at = now()
       where id = %L
       returning id',
      v_table, v_geom, p_properties, p_region, p_source_type, p_id
    ) into v_new_id;
  end if;

  return jsonb_build_object('id', v_new_id);
end;
$$;

create or replace function public.delete_draft_feature(p_dataset text, p_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_table text;
begin
  case p_dataset
    when 'ruas_jalan' then v_table := 'ruas_jalan_draft';
    when 'sekolah' then v_table := 'sekolah_draft';
    when 'rambu' then v_table := 'rambu_draft';
    when 'apj' then v_table := 'apj_draft';
    when 'pengawasan_angkutan_barang' then v_table := 'pengawasan_angkutan_barang_draft';
    else raise exception 'unknown dataset: %', p_dataset;
  end case;

  execute format('delete from %I where id = %L', v_table, p_id);
  return found;
end;
$$;

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
      delete from public.ruas_jalan_published where true;
      insert into public.ruas_jalan_published (source_id, geometry, properties, published_at, published_by)
      select source_id, geometry, properties, now(), auth.uid()
      from public.ruas_jalan_draft
      where status in ('approved', 'pending') or source_type = 'field';
      get diagnostics v_count = row_count;
    when 'sekolah' then
      delete from public.sekolah_published where true;
      insert into public.sekolah_published (source_id, geometry, properties, published_at, published_by)
      select source_id, geometry, properties, now(), auth.uid()
      from public.sekolah_draft
      where status in ('approved', 'pending') or source_type = 'field';
      get diagnostics v_count = row_count;
    when 'rambu' then
      delete from public.rambu_published where true;
      insert into public.rambu_published (source_id, geometry, properties, published_at, published_by)
      select source_id, geometry, properties, now(), auth.uid()
      from public.rambu_draft
      where status in ('approved', 'pending') or source_type = 'field';
      get diagnostics v_count = row_count;
    when 'apj' then
      delete from public.apj_published where true;
      insert into public.apj_published (source_id, geometry, properties, published_at, published_by)
      select source_id, geometry, properties, now(), auth.uid()
      from public.apj_draft
      where status in ('approved', 'pending') or source_type = 'field';
      get diagnostics v_count = row_count;
    when 'pengawasan_angkutan_barang' then
      delete from public.pengawasan_angkutan_barang_published where true;
      insert into public.pengawasan_angkutan_barang_published (source_id, geometry, properties, published_at, published_by)
      select source_id, geometry, properties, now(), auth.uid()
      from public.pengawasan_angkutan_barang_draft
      where status in ('approved', 'pending') or source_type = 'field';
      get diagnostics v_count = row_count;
    else
      raise exception 'unknown dataset: %', p_dataset;
  end case;
  return v_count;
end;
$$;

create or replace function public.dataset_pivot(p_dataset text, p_keys text[])
returns jsonb
language plpgsql
as $$
declare
  v_table text;
  v_result jsonb := '{}';
  v_key text;
  v_counts jsonb;
begin
  case p_dataset
    when 'ruas_jalan' then v_table := 'ruas_jalan_draft';
    when 'sekolah' then v_table := 'sekolah_draft';
    when 'rambu' then v_table := 'rambu_draft';
    when 'apj' then v_table := 'apj_draft';
    when 'pengawasan_angkutan_barang' then v_table := 'pengawasan_angkutan_barang_draft';
    else raise exception 'unknown dataset: %', p_dataset;
  end case;

  foreach v_key in array p_keys loop
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''value'', k, ''count'', c)), ''[]''::jsonb) from (
         select properties ->> %L as k, count(*) as c
         from %I
         where properties ->> %L is not null
         group by properties ->> %L
         order by c desc
       ) t',
      v_key, v_table, v_key, v_key
    ) into v_counts;
    v_result := jsonb_set(v_result, array[v_key], v_counts);
  end loop;

  return v_result;
end;
$$;

create or replace function public.dataset_distribution(p_dataset text)
returns jsonb
language plpgsql
as $$
declare
  v_table text;
  v_uptd_key text;
  v_kab_key text;
  v_total int;
  v_uptd jsonb;
  v_kab jsonb;
  v_uptd_kab jsonb;
begin
  case p_dataset
    when 'ruas_jalan' then
      v_table := 'ruas_jalan_draft';
      v_uptd_key := 'unit_kerja_kode';
      v_kab_key := 'KABUPATEN';
    when 'sekolah' then
      v_table := 'sekolah_draft';
      v_uptd_key := 'UPTD';
      v_kab_key := 'KABUPATEN';
    when 'rambu' then
      v_table := 'rambu_draft';
    when 'apj' then
      v_table := 'apj_draft';
      v_uptd_key := 'UPTD';
      v_kab_key := 'Kabupaten/Kota';
    when 'pengawasan_angkutan_barang' then
      v_table := 'pengawasan_angkutan_barang_draft';
      v_uptd_key := 'uptd';
      v_kab_key := 'kabkota_label';
    else raise exception 'unknown dataset: %', p_dataset;
  end case;

  execute format('select count(*) from %I', v_table) into v_total;

  if v_uptd_key is not null then
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''value'', k, ''count'', c)), ''[]''::jsonb)
       from (select properties ->> %L as k, count(*) as c
             from %I where properties ->> %L is not null
             group by 1 order by 2 desc) t',
      v_uptd_key, v_table, v_uptd_key
    ) into v_uptd;
  else
    v_uptd := '[]'::jsonb;
  end if;

  if v_kab_key is not null then
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''value'', k, ''count'', c)), ''[]''::jsonb)
       from (select properties ->> %L as k, count(*) as c
             from %I where properties ->> %L is not null
             group by 1 order by 2 desc) t',
      v_kab_key, v_table, v_kab_key
    ) into v_kab;
  else
    v_kab := '[]'::jsonb;
  end if;

  if v_uptd_key is not null and v_kab_key is not null then
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''uptd'', u, ''kab'', k, ''count'', c)), ''[]''::jsonb)
       from (select properties ->> %L as u, properties ->> %L as k, count(*) as c
             from %I
             where properties ->> %L is not null
               and properties ->> %L is not null
             group by 1, 2) t',
      v_uptd_key, v_kab_key, v_table, v_uptd_key, v_kab_key
    ) into v_uptd_kab;
  else
    v_uptd_kab := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'dataset', p_dataset,
    'total', v_total,
    'uptd', v_uptd,
    'kab', v_kab,
    'uptd_kab', v_uptd_kab
  );
end;
$$;
