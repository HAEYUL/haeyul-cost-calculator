-- =====================================================================
-- 보안 잠금 되돌리기 (security.sql 실행 전 상태로)
-- =====================================================================
-- security.sql을 실행한 뒤 앱이 자료를 못 불러오는 등 문제가 생겼을 때만 실행한다.
-- 자료는 바뀌지 않고, 접근 규칙만 예전처럼 "누구나"로 돌아간다(PIN 확인은 화면에서만 하게 된다).

do $$
declare
  t text;
  p record;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'store_code' and tb.table_type = 'BASE TABLE'
  loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format(
      'create policy "public access (rollback)" on public.%I for all to anon, authenticated using (true) with check (true)',
      t
    );
  end loop;
end $$;

do $$
declare
  p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'stores' loop
    execute format('drop policy %I on public.stores', p.policyname);
  end loop;
end $$;
grant select, update on public.stores to anon, authenticated;
create policy "stores are publicly readable" on public.stores for select to anon, authenticated using (true);
create policy "stores are publicly updatable" on public.stores for update to anon, authenticated using (true) with check (true);

update storage.buckets set public = true where id = 'invoice-photos';
drop policy if exists "invoice-photos store read" on storage.objects;
drop policy if exists "invoice-photos store insert" on storage.objects;
drop policy if exists "invoice-photos store update" on storage.objects;
drop policy if exists "invoice-photos store delete" on storage.objects;
drop policy if exists "invoice-photos are publicly readable" on storage.objects;
drop policy if exists "invoice-photos are publicly insertable" on storage.objects;
drop policy if exists "invoice-photos are publicly updatable" on storage.objects;
drop policy if exists "invoice-photos are publicly deletable" on storage.objects;
create policy "invoice-photos are publicly readable" on storage.objects for select using (bucket_id = 'invoice-photos');
create policy "invoice-photos are publicly insertable" on storage.objects for insert with check (bucket_id = 'invoice-photos');
create policy "invoice-photos are publicly updatable" on storage.objects for update using (bucket_id = 'invoice-photos');
create policy "invoice-photos are publicly deletable" on storage.objects for delete using (bucket_id = 'invoice-photos');
