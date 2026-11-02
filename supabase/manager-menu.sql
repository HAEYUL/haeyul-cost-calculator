-- =====================================================================
-- 매니저 메뉴 5개 + 전달사항
-- =====================================================================
-- roles.sql을 실행한 뒤에 한 번 실행한다. 여러 번 실행해도 안전하다.
--   1) 거래처 관리: 매니저도 자기 매장의 결제 내역·장부 시작 잔액을 "읽을" 수 있게 한다.
--      (결제 입력·수정·삭제와 시작 잔액 저장은 지금처럼 메인 관리자만)
--   2) 전달사항: 메인 관리자가 매장에 메모를 보내고, 매니저가 확인·답장한다.

-- 1) 거래처 결제·시작 잔액: 읽기 = 자기 매장 매니저 + 관리자 / 쓰기 = 관리자만
do $$
declare
  t text;
  p record;
begin
  foreach t in array array['vendor_payments', 'vendor_opening_balances'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "store members read" on public.%I for select to authenticated '
      'using (store_code = public.auth_store_code() or public.auth_is_admin())', t);
    execute format(
      'create policy "admin insert" on public.%I for insert to authenticated with check (public.auth_is_admin())', t);
    execute format(
      'create policy "admin update" on public.%I for update to authenticated '
      'using (public.auth_is_admin()) with check (public.auth_is_admin())', t);
    execute format(
      'create policy "admin delete" on public.%I for delete to authenticated using (public.auth_is_admin())', t);
  end loop;
end $$;

-- 2) 전달사항
create table if not exists public.store_notices (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references public.stores(code),
  message text not null check (char_length(message) between 1 and 1000),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,   -- 매니저가 [확인했어요]를 누른 때
  reply text,                 -- 매니저 답장
  replied_at timestamptz
);
create index if not exists store_notices_store_idx on public.store_notices (store_code, created_at desc);

alter table public.store_notices enable row level security;
drop policy if exists "store members or admin" on public.store_notices;
create policy "store members or admin" on public.store_notices for all to authenticated
  using (store_code = public.auth_store_code() or public.auth_is_admin())
  with check (store_code = public.auth_store_code() or public.auth_is_admin());
grant select, insert, update, delete on public.store_notices to authenticated;

-- 매니저는 보내거나 지울 수 없고, 확인·답장 칸만 바꿀 수 있다.
create or replace function public.store_notices_guard()
returns trigger
language plpgsql
as $$
begin
  if public.auth_is_admin() or coalesce(auth.role(), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op <> 'UPDATE' then
    raise exception '전달사항은 메인 관리자만 보내거나 지울 수 있어요.';
  end if;
  if new.message is distinct from old.message or new.store_code is distinct from old.store_code
     or new.created_at is distinct from old.created_at then
    raise exception '전달사항 내용은 메인 관리자만 바꿀 수 있어요.';
  end if;
  return new;
end $$;

drop trigger if exists store_notices_guard on public.store_notices;
create trigger store_notices_guard
  before insert or update or delete on public.store_notices
  for each row execute function public.store_notices_guard();

-- 확인용
select tablename as "표", policyname as "정책"
from pg_policies
where tablename in ('vendor_payments', 'vendor_opening_balances', 'store_notices')
order by tablename, policyname;
