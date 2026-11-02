-- =====================================================================
-- 일매출 표 (통합 매출·결산 화면)
-- =====================================================================
-- roles.sql을 실행한 뒤에 한 번 실행한다. 여러 번 실행해도 안전하다.
-- 지금은 메인 관리자가 직접 입력하고, 나중에 OKPOS를 연결하면 서버가 자동으로 채운다(source = 'okpos').

create table if not exists public.sales_daily (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references public.stores(code),
  sale_date date not null,
  total_amount bigint not null default 0 check (total_amount >= 0),  -- 총매출
  card_amount bigint,                                                -- 카드
  cash_amount bigint,                                                -- 현금
  other_amount bigint,                                               -- 기타(상품권·포인트 등)
  guest_count integer,                                               -- 객수
  memo text,
  source text not null default 'manual' check (source in ('manual', 'okpos')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_code, sale_date)
);
create index if not exists sales_daily_date_idx on public.sales_daily (sale_date);

-- 매출 구분(POS): 해율만두전골은 1층 매장('1f') / 2,3층 매장('23f'), 다른 매장은 'main' (sales-channels.sql과 같음)
alter table public.sales_daily add column if not exists channel text not null default 'main';
alter table public.sales_daily drop constraint if exists sales_daily_store_code_sale_date_key;
create unique index if not exists sales_daily_store_date_channel_uniq on public.sales_daily (store_code, sale_date, channel);

-- 메인 관리자만 보고 입력한다.
alter table public.sales_daily enable row level security;
drop policy if exists "admin only" on public.sales_daily;
create policy "admin only" on public.sales_daily for all to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());
grant select, insert, update, delete on public.sales_daily to authenticated;

-- 확인용: "admin only" 한 줄이 보이면 정상
select tablename as "표", policyname as "정책" from pg_policies where tablename = 'sales_daily';
