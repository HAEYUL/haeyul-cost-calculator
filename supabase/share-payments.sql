-- =====================================================================
-- 거래처 결제를 매니저와 공유 (입력·체크·삭제)
-- =====================================================================
-- manager-menu.sql을 실행한 뒤에 한 번 실행한다. 여러 번 실행해도 안전하다.
--   - 거래처 결제(vendor_payments): 매니저도 자기 매장 결제를 보고·입력하고·고치고·지운다. 관리자는 전부.
--   - 장부 시작 잔액(vendor_opening_balances): 지금처럼 매니저는 보기만, 저장은 관리자만.
--   - 관리자가 결제 처리한 명세표를 매니저가 못 고치게 하던 잠금은 없앤다(결제를 같이 맞출 수 있으므로).

do $$
declare
  p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'vendor_payments' loop
    execute format('drop policy %I on public.vendor_payments', p.policyname);
  end loop;
end $$;
alter table public.vendor_payments enable row level security;
create policy "store members or admin" on public.vendor_payments for all to authenticated
  using (store_code = public.auth_store_code() or public.auth_is_admin())
  with check (store_code = public.auth_store_code() or public.auth_is_admin());
grant select, insert, update, delete on public.vendor_payments to authenticated;

drop trigger if exists invoice_batches_manager_guard on public.invoice_batches;

-- 확인용: vendor_payments에 "store members or admin" 한 줄이면 정상
select tablename as "표", policyname as "정책", cmd as "종류"
from pg_policies
where tablename in ('vendor_payments', 'vendor_opening_balances')
order by tablename, policyname;
