-- lintas-dashboard: RPC helpers for the map editor
-- SECURITY INVOKER: RLS policies still apply to the underlying rows (caller's role/region/window are enforced).
-- Dynamic table/column names are whitelisted (dataset is validated against a fixed list) - no injection.

-- ============================================================
-- Fetch draft features as a GeoJSON FeatureCollection (RLS-filtered)
-- Usage: select * from public.draft_features_geojson('apj');
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

-- ============================================================
-- Upsert a draft feature (create or update) - RLS still enforced
-- Usage: select * from public.save_draft_feature(
--   'apj', null, 'TIANG-999', '{"type":"Point","coordinates":[107.6,-6.9]}'::jsonb,
--   '{"Id_Tiang":"TIANG-999","Kondisi":"Baik"}'::jsonb, 'UPTD 1', 'field');
-- ============================================================
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

-- ============================================================
-- Delete a draft feature (RLS enforced - super_admin or editor in open window)
-- ============================================================
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
    else raise exception 'unknown dataset: %', p_dataset;
  end case;

  execute format('delete from %I where id = %L', v_table, p_id);
  return found;
end;
$$;

-- ============================================================
-- Publish wrapper (super_admin only) - calls publish_dataset
-- Usage: select * from public.publish_dataset_safe('apj');
-- ============================================================
create or replace function public.publish_dataset_safe(p_dataset text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_role text;
begin
  select (select auth.jwt() -> 'app_metadata' ->> 'role') into v_role;
  if coalesce(v_role, '') <> 'super_admin' then
    raise exception 'only super_admin can publish';
  end if;
  select public.publish_dataset(p_dataset) into v_count;
  return jsonb_build_object('published', v_count, 'dataset', p_dataset, 'at', now());
end;
$$;
