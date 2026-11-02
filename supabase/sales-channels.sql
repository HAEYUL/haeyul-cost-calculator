-- =====================================================================
-- 일매출을 POS(매출 구분)별로 — 해율만두전골: 1층 매장 / 2,3층 매장
-- =====================================================================
-- sales.sql을 실행한 뒤에 한 번 실행한다. 여러 번 실행해도 안전하다.
-- 같은 매장·같은 날이라도 구분(channel)이 다르면 따로 저장하고, 화면에서 매장 매출로 합산한다.
-- 구분이 하나인 매장은 'main'.

alter table public.sales_daily add column if not exists channel text not null default 'main';
alter table public.sales_daily drop constraint if exists sales_daily_store_code_sale_date_key;
create unique index if not exists sales_daily_store_date_channel_uniq on public.sales_daily (store_code, sale_date, channel);

-- 확인용: channel 칸이 보이면 정상
select column_name as "칸", data_type as "형식", column_default as "기본값"
from information_schema.columns
where table_schema = 'public' and table_name = 'sales_daily' and column_name = 'channel';
