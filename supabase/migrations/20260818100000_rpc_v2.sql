-- lintas-dashboard: RPC v2 - fast light load, detail, pivot and distribution
-- Applied manually to prod via apply_sql.py during the 2026-08-18 session.

-- ============================================================
-- Fast initial load for large datasets (37k+ points).
-- p_light=true returns only id + geometry + minimal identity props so the
-- map renders quickly and stays under the ~10s PostgREST window.
-- Full properties are fetched per-feature via draft_feature_detail.
-- ============================================================
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

-- ============================================================
-- Per-feature detail (full properties) for a single draft feature.
-- ============================================================
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

-- ============================================================
-- Pivot counts for the Ringkasan dashboard.
--   select * from public.dataset_pivot('apj', array['UPTD','Kondisi'])
--   -> {"UPTD": [{"value":"UPTD 1","count":1234}, ...], "Kondisi": [...]}
-- ============================================================
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

-- ============================================================
-- Published features as GeoJSON (for background layers, e.g. the
-- provincial road network drawn under editable draft data).
-- ============================================================
create or replace function public.published_features_geojson(p_dataset text)
returns jsonb
language plpgsql
as $$
declare
  v_table text;
  v_result jsonb;
begin
  case p_dataset
    when 'ruas_jalan' then v_table := 'ruas_jalan_published';
    when 'sekolah' then v_table := 'sekolah_published';
    when 'rambu' then v_table := 'rambu_published';
    when 'apj' then v_table := 'apj_published';
    else raise exception 'unknown dataset: %', p_dataset;
  end case;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
        ''type'', ''Feature'',
        ''id'', id::text,
        ''geometry'', st_asgeojson(geometry)::jsonb,
        ''properties'', properties
      )), ''[]''::jsonb)
     from %I',
    v_table
  ) into v_result;

  return jsonb_build_object('type', 'FeatureCollection', 'features', v_result);
end;
$$;

-- ============================================================
-- Distribution data for the "Distribusi Data per UPTD & Lokasi"
-- pivot table on the Ringkasan dashboard.
-- Returns per dataset: total count, breakdown by UPTD (apj/ruas_jalan),
-- by Kabupaten/Kota (apj/sekolah), and the APJ UPTD x Kabupaten/Kota
-- cross-tab used to render nested rows (UPTD -> locations).
-- ============================================================
create or replace function public.dataset_distribution(p_dataset text)
returns jsonb
language plpgsql
as $$
declare
  v_table text;
  v_total int;
  v_uptd jsonb;
  v_kab jsonb;
  v_uptd_kab jsonb;
begin
  case p_dataset
    when 'ruas_jalan' then v_table := 'ruas_jalan_draft';
    when 'sekolah' then v_table := 'sekolah_draft';
    when 'rambu' then v_table := 'rambu_draft';
    when 'apj' then v_table := 'apj_draft';
    else raise exception 'unknown dataset: %', p_dataset;
  end case;

  execute format('select count(*) from %I', v_table) into v_total;

  if p_dataset in ('apj', 'ruas_jalan') then
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''value'', k, ''count'', c)), ''[]''::jsonb)
       from (select properties ->> %L as k, count(*) as c
             from %I where properties ->> %L is not null
             group by 1 order by 2 desc) t',
      case when p_dataset = 'apj' then 'UPTD' else 'unit_kerja_kode' end,
      v_table,
      case when p_dataset = 'apj' then 'UPTD' else 'unit_kerja_kode' end
    ) into v_uptd;
  else
    v_uptd := '[]'::jsonb;
  end if;

  if p_dataset in ('apj', 'sekolah') then
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''value'', k, ''count'', c)), ''[]''::jsonb)
       from (select properties ->> %L as k, count(*) as c
             from %I where properties ->> %L is not null
             group by 1 order by 2 desc) t',
      case when p_dataset = 'apj' then 'Kabupaten/Kota' else 'KABUPATEN' end,
      v_table,
      case when p_dataset = 'apj' then 'Kabupaten/Kota' else 'KABUPATEN' end
    ) into v_kab;
  else
    v_kab := '[]'::jsonb;
  end if;

  if p_dataset = 'apj' then
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_object(''uptd'', u, ''kab'', k, ''count'', c)), ''[]''::jsonb)
       from (select properties ->> ''UPTD'' as u, properties ->> ''Kabupaten/Kota'' as k, count(*) as c
             from %I
             where properties ->> ''UPTD'' is not null
               and properties ->> ''Kabupaten/Kota'' is not null
             group by 1, 2) t',
      v_table
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
