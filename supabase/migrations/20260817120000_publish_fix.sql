-- lintas-dashboard: fix publish_dataset DELETE with WHERE clause (Postgres safe mode)
create or replace function public.publish_dataset(p_dataset text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  case p_dataset
    when 'ruas_jalan' then
      delete from public.ruas_jalan_published where true;
      insert into public.ruas_jalan_published (source_id, geometry, properties, published_at, published_by)
      select source_id, geometry, properties, now(), auth.uid()
      from public.ruas_jalan_draft
      where status in ('approved', 'pending') or source_type = 'field';
      get diagnostics v_count = row_count;
    when 'sekolah' then
      delete from public.sekolah_published where true;
      insert into public.sekolah_published (source_id, geometry, properties, published_at, published_by)
      select source_id, geometry, properties, now(), auth.uid()
      from public.sekolah_draft
      where status in ('approved', 'pending') or source_type = 'field';
      get diagnostics v_count = row_count;
    when 'rambu' then
      delete from public.rambu_published where true;
      insert into public.rambu_published (source_id, geometry, properties, published_at, published_by)
      select source_id, geometry, properties, now(), auth.uid()
      from public.rambu_draft
      where status in ('approved', 'pending') or source_type = 'field';
      get diagnostics v_count = row_count;
    when 'apj' then
      delete from public.apj_published where true;
      insert into public.apj_published (source_id, geometry, properties, published_at, published_by)
      select source_id, geometry, properties, now(), auth.uid()
      from public.apj_draft
      where status in ('approved', 'pending') or source_type = 'field';
      get diagnostics v_count = row_count;
    else
      raise exception 'unknown dataset: %', p_dataset;
  end case;
  return v_count;
end;
$$;
