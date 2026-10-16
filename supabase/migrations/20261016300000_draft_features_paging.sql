-- The editor loaded every feature in one call: draft_features_geojson returns a
-- single jsonb, so for apj/sekolah that is ~9 MB / 30k+ rows in one statement.
-- When the database is cold or busy that statement exceeds the authenticated
-- role's 8 s statement_timeout ("canceling statement due to statement timeout")
-- and the editor showed an empty map.
--
-- Paging keeps each statement small. Keyset paging (id > p_after) is used rather
-- than OFFSET: it is index-backed, so the cost stays flat for every page instead
-- of growing with the page number (measured: apj's first page 0.6 s, but an
-- OFFSET page at 4000 already took 3.3 s).
--
-- The old 2-argument and 1-argument versions must be dropped: adding parameters
-- with CREATE OR REPLACE creates an OVERLOAD instead of replacing, and PostgREST
-- then rejects the call as ambiguous ("function ... is not unique"), which breaks
-- every feature load.
drop function if exists public.draft_features_geojson(text, boolean, integer, integer);
drop function if exists public.draft_features_geojson(text, boolean);
drop function if exists public.draft_features_geojson(text);

create or replace function public.draft_features_geojson(
  p_dataset text,
  p_light boolean default false,
  p_limit integer default null,
  p_after uuid default null
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
      'select coalesce(jsonb_agg(t.f), ''[]''::jsonb) from (
         select jsonb_build_object(
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
         ) as f
         from %I
         where %L::uuid is null or id > %L::uuid
         order by id
         limit %s
       ) t',
      v_table,
      p_after, p_after,
      coalesce(p_limit, 2147483647)
    ) into v_result;
  else
    execute format(
      'select coalesce(jsonb_agg(t.f), ''[]''::jsonb) from (
         select jsonb_build_object(
           ''type'', ''Feature'',
           ''id'', id::text,
           ''geometry'', st_asgeojson(geometry)::jsonb,
           ''properties'', properties || jsonb_build_object(
             ''_region'', region,
             ''_status'', status,
             ''_source_type'', source_type,
             ''_source_id'', source_id
           )
         ) as f
         from %I
         where %L::uuid is null or id > %L::uuid
         order by id
         limit %s
       ) t',
      v_table,
      p_after, p_after,
      coalesce(p_limit, 2147483647)
    ) into v_result;
  end if;

  return jsonb_build_object('type', 'FeatureCollection', 'features', v_result);
end;
$$;
