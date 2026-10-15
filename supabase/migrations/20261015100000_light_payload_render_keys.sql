-- The editor loads the map via draft_features_geojson(..., p_light => true), but
-- the light payload only carried the generic _* keys. That left jenis/kelas_jalan
-- undefined in the editor, so every point fell back to the default icon and the
-- per-jenis rendering never matched. Carry the two render keys too (jsonb_strip_nulls
-- keeps datasets that have no such field unchanged).
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
          ) || jsonb_strip_nulls(jsonb_build_object(
            ''jenis'', properties->>''jenis'',
            ''kelas_jalan'', properties->>''kelas_jalan''
          ))
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
