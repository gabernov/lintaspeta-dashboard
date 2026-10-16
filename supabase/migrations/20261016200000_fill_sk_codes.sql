-- Fill the codes for the three ruas whose kode_number the importer could not match,
-- recovered from the SK data by exact length match (see docs/RUAS-DATA-NOTES.md):
--
--   343000 "Tasikmalaya - Karangnunggal" (41.78 km)
--     = SK 22.00.343.1.K (8.28) + 22.00.343.2 (33.5)          -> 22.00.343   (parent corridor)
--   347000 "Singaparna - Bts. Kota/Kab. Tasikmalaya (Cikunir) Tasikmalaya" (8.69 km)
--     = SK 22.00.347.2 (3.28) + 22.00.347.1.K (5.41)          -> 22.00.347   (parent corridor)
--   392010 "Sp.3 Loji (Tegalnyampai - Cibutun)" (26.485 km)
--     = SK 22.00.392.1 (26.49, "SP3. LOJI (TEGALNYAMPAI) - BALEWER - PUNCAK DARMA") -> 22.00.392.1
--
-- 22.00.392.1 was previously on 392020 ("Cibutun - Balewer", 16.4 km), assigned by
-- fuzzy name match (both names contain "Balewer"); by length the code belongs to 392010,
-- so it is cleared from 392020. 392020/392030 have no SK row of their own (the SK treats
-- Tegalnyampai-Balewer-Puncak Darma as one road) and are left without a code.
--
-- legacy_match records how each code was obtained, so a later audit can tell these apart
-- from importer-matched codes.

begin;

update public.ruas_jalan_draft
set properties = jsonb_set(
      jsonb_set(properties, '{kode_number}', to_jsonb('22.00.343'::text)),
      '{legacy_match}', to_jsonb('manual:sk-length-match'::text))
where properties->>'id_ruas_jalan' = '343000';

update public.ruas_jalan_draft
set properties = jsonb_set(
      jsonb_set(properties, '{kode_number}', to_jsonb('22.00.347'::text)),
      '{legacy_match}', to_jsonb('manual:sk-length-match'::text))
where properties->>'id_ruas_jalan' = '347000';

update public.ruas_jalan_draft
set properties = jsonb_set(
      jsonb_set(properties, '{kode_number}', to_jsonb('22.00.392.1'::text)),
      '{legacy_match}', to_jsonb('manual:sk-length-match'::text))
where properties->>'id_ruas_jalan' = '392010';

update public.ruas_jalan_draft
set properties = jsonb_set(
      jsonb_set(properties, '{kode_number}', to_jsonb(''::text)),
      '{legacy_match}', to_jsonb('manual:code-moved-to-392010'::text))
where properties->>'id_ruas_jalan' = '392020';

commit;
