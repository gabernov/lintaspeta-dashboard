-- Three DBMPR status-jalan rows carry geometry but no attributes at all (empty
-- nama / kode_number / nama_pu / kelas_jalan, null panjang_km) and so showed up
-- as unnamed entries in the editor's layer panel. Confirmed with DISHUB Jabar
-- that the source genuinely has no attributes for them, so each one is merged
-- into the adjacent named ruas it continues, and the empty row is removed.
--
--   193130 -> 22.00.193.11.K  (its start is exactly that road's end)
--   193140 -> 22.00.193.11.K  (its end is exactly that road's start)
--   193150 -> 22.00.193.12    (nearest named ruas, ~68 m parallel offset)
--
-- Re-running is a no-op: once the rows are gone the UPDATE matches no source row
-- and the DELETE removes nothing.

begin;

update public.ruas_jalan_draft d
set geometry = st_multi(st_union(d.geometry, o.geometry)),
    properties = jsonb_set(
      d.properties,
      '{panjang_km}',
      to_jsonb(round(((st_length(d.geometry::geography) + st_length(o.geometry::geography)) / 1000.0)::numeric, 3))
    )
from public.ruas_jalan_draft o
where d.properties->>'kode_number' = '22.00.193.11.K'
  and o.properties->>'id_ruas_jalan' = '193140';

update public.ruas_jalan_draft d
set geometry = st_multi(st_union(d.geometry, o.geometry)),
    properties = jsonb_set(
      d.properties,
      '{panjang_km}',
      to_jsonb(round(((st_length(d.geometry::geography) + st_length(o.geometry::geography)) / 1000.0)::numeric, 3))
    )
from public.ruas_jalan_draft o
where d.properties->>'kode_number' = '22.00.193.11.K'
  and o.properties->>'id_ruas_jalan' = '193130';

update public.ruas_jalan_draft d
set geometry = st_multi(st_union(d.geometry, o.geometry)),
    properties = jsonb_set(
      d.properties,
      '{panjang_km}',
      to_jsonb(round(((st_length(d.geometry::geography) + st_length(o.geometry::geography)) / 1000.0)::numeric, 3))
    )
from public.ruas_jalan_draft o
where d.properties->>'kode_number' = '22.00.193.12'
  and o.properties->>'id_ruas_jalan' = '193150';

delete from public.ruas_jalan_draft
where properties->>'id_ruas_jalan' in ('193130', '193140', '193150');

commit;
