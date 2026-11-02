-- =====================================================================
-- 매니저도 입고 입력 때 "바로 결제 완료"(즉시 결제)를 남길 수 있게
-- =====================================================================
-- manager-menu.sql을 실행한 뒤에 한 번 실행한다. 여러 번 실행해도 안전하다.
-- 매니저는 자기 매장에서, 방금 저장한 명세표와 같은 거래처·같은 날·같은 금액의 "즉시 결제"만 남길 수 있다.
-- (그 밖의 결제 입력·수정·삭제는 지금처럼 메인 관리자만)

drop policy if exists "manager instant payment" on public.vendor_payments;
create policy "manager instant payment" on public.vendor_payments for insert to authenticated
  with check (
    store_code = public.auth_store_code()
    and memo in ('즉시 결제(자동)', '즉시 결제(나중에 처리)')
    and paid_date is not null
    and exists (
      select 1 from public.invoice_batches b
      where b.store_code = vendor_payments.store_code
        and b.vendor_id = vendor_payments.vendor_id
        and b.invoice_date = vendor_payments.paid_date
        and round(b.total_amount) = round(vendor_payments.amount)
    )
  );

-- 확인용: vendor_payments에 "manager instant payment"가 보이면 정상
select policyname as "정책", cmd as "종류" from pg_policies where tablename = 'vendor_payments' order by policyname;
