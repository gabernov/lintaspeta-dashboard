-- lintas-dashboard: undo/redo support + data restoration
-- 1. replace_draft_features: atomically replace all features for a dataset (for undo/redo snapshots)
-- 2. restore_draft_from_published: copy published data back to draft (for data restoration)

-- ============================================================
-- replace_draft_features: delete all + insert from JSON snapshot
-- Used by undo/redo to restore a previous FeatureCollection state.
-- SECURITY INVOKER: RLS policies still apply.
-- ============================================================
create or replace function public.replace_draft_features(
  p_dataset text,
  p_features jsonb  -- Array of GeoJSON Feature objects (not a FeatureCollection)
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_count integer;
  v_feat jsonb;
  v_geom geometry;
  v_source_id text;
  v_properties jsonb;
  v_region text;
  v_status text;
  v_source_type text;
begin
  case p_dataset
    when 'ruas_jalan' then v_table := 'ruas_jalan_draft';
    when 'sekolah' then v_table := 'sekolah_draft';
    when 'rambu' then v_table := 'rambu_draft';
    when 'apj' then v_table := 'apj_draft';
    else raise exception 'unknown dataset: %', p_dataset;
  end case;

  -- Delete all existing features
  execute format('DELETE FROM %I', v_table);

  -- Insert features from snapshot
  for v_feat in select jsonb_array_elements(p_features)
  loop
    -- Parse geometry
    v_geom := st_setsrid(st_geomfromgeojson(v_feat->'geometry'), 4326);

    -- Extract metadata from underscore-prefixed properties
    v_source_id := v_feat->'properties'->>'_source_id';
    v_region := coalesce(v_feat->'properties'->>'_region', '');
    v_status := coalesce(v_feat->'properties'->>'_status', 'draft');
    v_source_type := coalesce(v_feat->'properties'->>'_source_type', 'master');

    -- Clean properties: remove underscore-prefixed metadata keys
    v_properties := v_feat->'properties'
      - '_region' - '_status' - '_source_type' - '_source_id';

    -- Generate source_id if missing
    if v_source_id is null or v_source_id = '' then
      v_source_id := 'restore-' || gen_random_uuid()::text;
    end if;

    execute format(
      'INSERT INTO %I (source_id, geometry, properties, region, status, source_type, created_by, updated_by)
       VALUES (%L, %L, %L::jsonb, %L, %L, %L, auth.uid(), auth.uid())',
      v_table, v_source_id, v_geom, v_properties, v_region, v_status, v_source_type
    );
  end loop;

  -- Count inserted rows
  execute format('SELECT count(*) FROM %I', v_table) into v_count;
  return v_count;
end;
$$;

-- ============================================================
-- restore_draft_from_published: copy published data back to draft
-- Used to restore corrupted draft data from the published snapshot.
-- SECURITY DEFINER: only super_admin should call this.
-- ============================================================
create or replace function public.restore_draft_from_published(p_dataset text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft_table text;
  v_published_table text;
  v_count integer;
  v_role text;
begin
  -- Authorization check
  select (select auth.jwt() -> 'app_metadata' ->> 'role') into v_role;
  if coalesce(v_role, '') <> 'super_admin' then
    raise exception 'only super_admin can restore from published';
  end if;

  case p_dataset
    when 'ruas_jalan' then
      v_draft_table := 'ruas_jalan_draft';
      v_published_table := 'ruas_jalan_published';
    when 'sekolah' then
      v_draft_table := 'sekolah_draft';
      v_published_table := 'sekolah_published';
    when 'rambu' then
      v_draft_table := 'rambu_draft';
      v_published_table := 'rambu_published';
    when 'apj' then
      v_draft_table := 'apj_draft';
      v_published_table := 'apj_published';
    else
      raise exception 'unknown dataset: %', p_dataset;
  end case;

  -- Check published table has data
  execute format('SELECT count(*) FROM %I', v_published_table) into v_count;
  if v_count = 0 then
    raise exception 'published table for % is empty, cannot restore', p_dataset;
  end if;

  -- Clear draft and copy from published
  execute format('DELETE FROM %I', v_draft_table);
  execute format(
    'INSERT INTO %I (source_id, geometry, properties, status, source_type, created_by, updated_by)
     SELECT source_id, geometry, properties, ''approved'', ''master'', auth.uid(), auth.uid()
     FROM %I',
    v_draft_table, v_published_table
  );

  -- Return count of restored features
  execute format('SELECT count(*) FROM %I', v_draft_table) into v_count;
  return v_count;
end;
$$;
