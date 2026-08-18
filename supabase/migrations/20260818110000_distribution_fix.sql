-- lintas-dashboard: fill missing distribution dims for sekolah & ruas_jalan
-- 1) sekolah_draft: derive UPTD from the existing spatial analysis
--    (nearest_road_unit_kerja, skipping 'nan' rows with no nearest road)
-- 2) ruas_jalan_draft: derive KABUPATEN from the BPS lokasi_kode
-- 3) dataset_distribution: generic for all datasets (uptd/kab/uptd_kab)

update public.sekolah_draft
set properties = properties || jsonb_build_object('UPTD', properties ->> 'nearest_road_unit_kerja')
where properties ->> 'nearest_road_unit_kerja' is not null
  and properties ->> 'nearest_road_unit_kerja' <> 'nan';

update public.ruas_jalan_draft
set properties = properties || jsonb_build_object(
  'KABUPATEN',
  case properties ->> 'lokasi_kode'
    when '3201' then 'KAB. BOGOR'
    when '3202' then 'KAB. SUKABUMI'
    when '3203' then 'KAB. CIANJUR'
    when '3204' then 'KAB. BANDUNG'
    when '3205' then 'KAB. GARUT'
    when '3206' then 'KAB. TASIKMALAYA'
    when '3207' then 'KAB. CIAMIS'
    when '3208' then 'KAB. KUNINGAN'
    when '3209' then 'KAB. CIREBON'
    when '3210' then 'KAB. MAJALENGKA'
    when '3211' then 'KAB. SUMEDANG'
    when '3212' then 'KAB. INDRAMAYU'
    when '3213' then 'KAB. SUBANG'
    when '3214' then 'KAB. PURWAKARTA'
    when '3215' then 'KAB. KARAWANG'
    when '3216' then 'KAB. BEKASI'
    when '3217' then 'KAB. BANDUNG BARAT'
    when '3218' then 'KAB. PANGANDARAN'
    when '3271' then 'KOTA BOGOR'
    when '3272' then 'KOTA SUKABUMI'
    when '3273' then 'KOTA BANDUNG'
    when '3274' then 'KOTA CIREBON'
    when '3275' then 'KOTA BEKASI'
    when '3276' then 'KOTA DEPOK'
    when '3277' then 'KOTA CIMAHI'
    when '3278' then 'KOTA TASIKMALAYA'
    when '3279' then 'KOTA BANJAR'
    else null
  end
)
where properties ->> 'lokasi_kode' is not null;

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