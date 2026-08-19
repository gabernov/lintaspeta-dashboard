-- lintas-dashboard: RPC untuk rekap kondisi PJU per UPTD x Kabupaten/Kota
-- Hanya apj yang memiliki properti 'Kondisi' (Baik / Rusak Ringan / Rusak Berat).
-- Mengembalikan array jsonb {uptd, kab, kondisi, count}; dataset lain -> [].

create or replace function public.dataset_kondisi_uptd_kab(p_dataset text)
returns jsonb
language plpgsql
as $$
declare
  v_table text;
  v_result jsonb;
begin
  case p_dataset
    when 'apj' then v_table := 'apj_draft';
    else return '[]'::jsonb;
  end case;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
        ''uptd'', u, ''kab'', k, ''kondisi'', c, ''count'', n
      )), ''[]''::jsonb)
     from (
       select properties ->> ''UPTD'' as u,
              properties ->> ''Kabupaten/Kota'' as k,
              properties ->> ''Kondisi'' as c,
              count(*) as n
       from %I
       where properties ->> ''UPTD'' is not null
         and properties ->> ''Kabupaten/Kota'' is not null
         and properties ->> ''Kondisi'' is not null
       group by 1, 2, 3
     ) t',
    v_table
  ) into v_result;

  return v_result;
end;
$$;