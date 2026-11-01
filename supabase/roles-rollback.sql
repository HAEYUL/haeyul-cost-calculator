-- =====================================================================
-- 권한 나누기 되돌리기 (roles.sql 실행 전, 매장별 잠금 상태로)
-- =====================================================================
-- roles.sql을 실행한 뒤 앱이 자료를 못 불러오는 등 문제가 생겼을 때만 실행한다.
-- 자료(파출 기록 포함)는 지우지 않고, 접근 규칙만 "자기 매장만"(security.sql)으로 돌아간다.
-- 되돌린 뒤에는 메인 관리자 로그인으로는 자료가 안 보이니, 매장 비밀번호로 들어가서 쓴다.

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
      'create policy "store members only" on public.%I for all to authenticated '
      'using (store_code = public.auth_store_code()) with check (store_code = public.auth_store_code())',
      t
    );
  end loop;
end $$;

drop trigger if exists invoice_batches_manager_guard on public.invoice_batches;
drop trigger if exists dispatch_shifts_guard on public.dispatch_shifts;

drop policy if exists "invoice-photos store read" on storage.objects;
drop policy if exists "invoice-photos store insert" on storage.objects;
drop policy if exists "invoice-photos store update" on storage.objects;
drop policy if exists "invoice-photos store delete" on storage.objects;
create policy "invoice-photos store read" on storage.objects for select to authenticated
  using (bucket_id = 'invoice-photos' and (storage.foldername(name))[1] = public.auth_store_code());
create policy "invoice-photos store insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'invoice-photos' and (storage.foldername(name))[1] = public.auth_store_code());
create policy "invoice-photos store update" on storage.objects for update to authenticated
  using (bucket_id = 'invoice-photos' and (storage.foldername(name))[1] = public.auth_store_code())
  with check (bucket_id = 'invoice-photos' and (storage.foldername(name))[1] = public.auth_store_code());
create policy "invoice-photos store delete" on storage.objects for delete to authenticated
  using (bucket_id = 'invoice-photos' and (storage.foldername(name))[1] = public.auth_store_code());
