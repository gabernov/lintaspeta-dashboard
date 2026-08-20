-- lintas-dashboard: published_features_geojson v2
-- Expose _source_id in each feature's properties and exclude published
-- features that currently have a pending draft row (an edit in progress).
-- Without the source_id, the frontend cannot tell which grey background
-- roads overlap an edited draft line -> "ada 2 line" after editing.
create or replace function public.published_features_geojson(p_dataset text)
returns jsonb
language plpgsql
as $$
declare
  v_table text;
  v_draft text;
  v_result jsonb;
begin
  case p_dataset
    when 'ruas_jalan' then v_table := 'ruas_jalan_published'; v_draft := 'ruas_jalan_draft';
    when 'sekolah' then v_table := 'sekolah_published'; v_draft := 'sekolah_draft';
    when 'rambu' then v_table := 'rambu_published'; v_draft := 'rambu_draft';
    when 'apj' then v_table := 'apj_published'; v_draft := 'apj_draft';
    else raise exception 'unknown dataset: %', p_dataset;
  end case;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
        ''type'', ''Feature'',
        ''id'', p.id::text,
        ''geometry'', st_asgeojson(p.geometry)::jsonb,
        ''properties'', p.properties || jsonb_build_object(''_source_id'', p.source_id)
      )), ''[]''::jsonb)
     from %I p
     where not exists (
       select 1 from %I d
       where d.source_id = p.source_id
         and d.status = ''pending''
     )',
    v_table, v_draft
  ) into v_result;

  return jsonb_build_object('type', 'FeatureCollection', 'features', v_result);
end;
$$;