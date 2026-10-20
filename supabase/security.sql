-- =====================================================================
-- 보안 잠금 (매장별 출입증이 있어야 자기 매장 자료만 열린다)
-- =====================================================================
-- 실행 전 확인:
--   1) Vercel에 SUPABASE_SERVICE_ROLE_KEY, STORE_AUTH_SECRET을 넣고 다시 배포했다
--   2) 새 앱에서 매장 PIN으로 로그인이 된다
--   3) Authentication → Sign In / Providers → "Allow new users to sign up"을 껐다
-- 문제가 생기면 security-rollback.sql을 실행하면 바로 원래대로 돌아간다. 자료는 바뀌지 않는다.

-- 출입증에 적힌 매장 코드(서버가 매장 계정을 만들 때 app_metadata.store_code에 넣는다)
create or replace function public.auth_store_code()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'store_code', '')
$$;

-- 1) store_code 칸이 있는 모든 자료 표: 기존 "누구나" 정책을 지우고 "자기 매장만" 정책 하나로 바꾼다.
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
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "store members only" on public.%I for all to authenticated '
      'using (store_code = public.auth_store_code()) with check (store_code = public.auth_store_code())',
      t
    );
  end loop;
end $$;

-- 2) stores 표: 매장 목록(코드·이름)만 누구나 읽을 수 있고, PIN 암호값·잠금 정보는 서버만 읽고 쓴다.
do $$
declare
  p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'stores' loop
    execute format('drop policy %I on public.stores', p.policyname);
  end loop;
end $$;
alter table public.stores enable row level security;
create policy "store list is readable" on public.stores for select to anon, authenticated using (true);
revoke all on public.stores from anon, authenticated;
grant select (code, name) on public.stores to anon, authenticated;

-- 3) 명세표 사진: 비공개로 바꾸고, 자기 매장 폴더(<매장코드>/...)만 보고·올리고·지울 수 있게 한다.
update storage.buckets set public = false where id = 'invoice-photos';
drop policy if exists "invoice-photos are publicly readable" on storage.objects;
drop policy if exists "invoice-photos are publicly insertable" on storage.objects;
drop policy if exists "invoice-photos are publicly updatable" on storage.objects;
drop policy if exists "invoice-photos are publicly deletable" on storage.objects;
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

-- 확인용: 잠긴 표 목록과 정책 (결과에 "store members only"가 표마다 하나씩 보이면 정상)
select tablename as "표", policyname as "정책", roles as "대상"
from pg_policies
where schemaname = 'public'
order by tablename;
