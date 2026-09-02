-- stores: 매장 마스터 테이블. 이후 단계의 invoices/recipes/ingredient_mapping 테이블이
-- store_code(text, stores.code 참조)로 데이터를 매장별로 분리한다. 비밀번호 컬럼 없음 —
-- 매장 선택만으로 진입한다.
create table if not exists stores (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  created_at timestamptz not null default now()
);

insert into stores (code, name) values
  ('haeyul', '해율만두전골'),
  ('gondre', '곤드레밥집'),
  ('namwon', '정담명가 남원추어탕'),
  ('spare', '예비매장')
on conflict (code) do nothing;

alter table stores enable row level security;

drop policy if exists "stores are publicly readable" on stores;
create policy "stores are publicly readable"
  on stores for select
  using (true);

-- vendors: 거래처 마스터. 입고 저장 시 자유 텍스트로 흩어지던 거래처명을 하나로 묶어서
-- 오탈자로 같은 거래처가 여러 개로 나뉘는 걸 막는다. 매장별로 이름 유일.
create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references stores(code),
  name text not null,
  created_at timestamptz not null default now(),
  unique (store_code, name)
);

alter table vendors enable row level security;

drop policy if exists "vendors are publicly readable" on vendors;
create policy "vendors are publicly readable"
  on vendors for select
  using (true);

drop policy if exists "vendors are publicly insertable" on vendors;
create policy "vendors are publicly insertable"
  on vendors for insert
  with check (true);

-- invoice_batches: 거래명세표 사진 한 장(=한 번의 저장)을 전표 하나로 묶는다. 거래처별
-- 입고액/미지급금 계산과 날짜별 정리는 이 단위를 기준으로 한다.
create table if not exists invoice_batches (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references stores(code),
  vendor_id uuid not null references vendors(id),
  invoice_date date,
  total_amount numeric not null default 0,
  created_at timestamptz not null default now()
);

-- statement_balance: 명세표에 인쇄된 현잔액/현잔고/총잔금(이번 거래까지 포함해 거래처에
-- 갚아야 할 총액). 있는 대로 그대로 저장해서, 미지급금은 결제 기록 대신 이 값(가장 최근
-- 명세표 기준)을 우선 보여준다. 사진에 없으면 null.
alter table invoice_batches add column if not exists statement_balance numeric;

create index if not exists invoice_batches_store_vendor_idx on invoice_batches (store_code, vendor_id);

alter table invoice_batches enable row level security;

drop policy if exists "invoice_batches are publicly readable" on invoice_batches;
create policy "invoice_batches are publicly readable"
  on invoice_batches for select
  using (true);

drop policy if exists "invoice_batches are publicly insertable" on invoice_batches;
create policy "invoice_batches are publicly insertable"
  on invoice_batches for insert
  with check (true);

-- vendor_payments: 거래처에 지급(결제)한 금액 기록. 거래처별 미지급금(잔액)은
-- invoice_batches.total_amount 합계 - vendor_payments.amount 합계로 계산한다.
create table if not exists vendor_payments (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references stores(code),
  vendor_id uuid not null references vendors(id),
  amount numeric not null,
  paid_date date,
  memo text,
  created_at timestamptz not null default now()
);

create index if not exists vendor_payments_store_vendor_idx on vendor_payments (store_code, vendor_id);

alter table vendor_payments enable row level security;

drop policy if exists "vendor_payments are publicly readable" on vendor_payments;
create policy "vendor_payments are publicly readable"
  on vendor_payments for select
  using (true);

drop policy if exists "vendor_payments are publicly insertable" on vendor_payments;
create policy "vendor_payments are publicly insertable"
  on vendor_payments for insert
  with check (true);

-- stock_usage: 당일 재료 사용량 수동 기록. 현재고는 invoices.quantity 합계(품목명+단위
-- 기준) 에서 이 테이블의 used_qty 합계를 뺀 값으로 계산한다. item_name/unit이 자유
-- 텍스트/선택값이라 표기가 다르면(예: "돼지고기" vs "돼지고기(앞다리)") 다른 재고로
-- 잡히니, 입고 입력 때와 같은 이름·단위로 기록해야 정확하다.
create table if not exists stock_usage (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references stores(code),
  item_name text not null,
  unit text,
  used_qty numeric not null,
  used_date date,
  memo text,
  created_at timestamptz not null default now()
);

create index if not exists stock_usage_store_item_idx on stock_usage (store_code, item_name, unit);

alter table stock_usage enable row level security;

drop policy if exists "stock_usage is publicly readable" on stock_usage;
create policy "stock_usage is publicly readable"
  on stock_usage for select
  using (true);

drop policy if exists "stock_usage is publicly insertable" on stock_usage;
create policy "stock_usage is publicly insertable"
  on stock_usage for insert
  with check (true);

-- inventory_pins: 재고 관리 화면에서 "관심 품목"으로 선택해 상단에 항상 보이게 한
-- 품목(+단위) 목록. 품목이 많아 한눈에 보기 힘들 때, 자주 확인하고 싶은 것만 골라
-- 두는 용도. 매장 전체가 공유하는 설정이라 기기와 무관하게 같은 화면이 보인다.
create table if not exists inventory_pins (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references stores(code),
  item_name text not null,
  unit text,
  created_at timestamptz not null default now(),
  unique (store_code, item_name, unit)
);

create index if not exists inventory_pins_store_idx on inventory_pins (store_code);

alter table inventory_pins enable row level security;

drop policy if exists "inventory_pins are publicly readable" on inventory_pins;
create policy "inventory_pins are publicly readable"
  on inventory_pins for select
  using (true);

drop policy if exists "inventory_pins are publicly insertable" on inventory_pins;
create policy "inventory_pins are publicly insertable"
  on inventory_pins for insert
  with check (true);

drop policy if exists "inventory_pins are publicly deletable" on inventory_pins;
create policy "inventory_pins are publicly deletable"
  on inventory_pins for delete
  using (true);

-- invoices: 입고 내역. 한 품목당 한 행. store_code로 매장별 데이터를 분리한다.
-- 로그인/비밀번호가 없는 앱이므로 매장 분리는 애플리케이션 레벨(선택된 매장 코드로 필터)에서
-- 이루어지고, RLS는 anon 키로 읽기/쓰기를 허용한다.
-- unit: 단가가 무엇을 기준으로 매겨졌는지 (g/kg/ea(개)/other). 원가 계산 시 g 기준으로
-- 환산할 수 있는지 판단하는 데 쓰인다 (kg는 1000으로 나눠 환산, ea/other는 환산 불가로 표시).
create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references stores(code),
  vendor text not null,
  item_name text not null,
  quantity numeric,
  unit_price numeric,
  unit text,
  amount numeric,
  invoice_date date,
  created_at timestamptz not null default now()
);

alter table invoices add column if not exists unit text;

-- vendor_id/batch_id: vendors/invoice_batches 도입 이전 데이터는 null로 남는다(레거시).
-- 옛 데이터는 화면에서 "거래처 미지정"으로 따로 보여주고, 원가 계산 등 기존 로직은
-- item_name/unit 기반이라 이 컬럼들과 무관하게 그대로 동작한다.
alter table invoices add column if not exists vendor_id uuid references vendors(id);
alter table invoices add column if not exists batch_id uuid references invoice_batches(id);

create index if not exists invoices_store_vendor_idx on invoices (store_code, vendor);
create index if not exists invoices_store_item_idx on invoices (store_code, item_name);
create index if not exists invoices_batch_idx on invoices (batch_id);

alter table invoices enable row level security;

drop policy if exists "invoices are publicly readable" on invoices;
create policy "invoices are publicly readable"
  on invoices for select
  using (true);

drop policy if exists "invoices are publicly insertable" on invoices;
create policy "invoices are publicly insertable"
  on invoices for insert
  with check (true);

-- price_changes: 단가가 바뀐 시점을 쌓아두는 알림 로그. 입고 저장 시 같은 거래처+물품명
-- (정확히 일치하는 경우만)의 직전 단가와 다르면 한 행씩 기록된다.
create table if not exists price_changes (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references stores(code),
  vendor text not null,
  item_name text not null,
  previous_price numeric not null,
  new_price numeric not null,
  changed_at timestamptz not null default now()
);

alter table price_changes add column if not exists vendor_id uuid references vendors(id);

create index if not exists price_changes_store_idx on price_changes (store_code, changed_at desc);

alter table price_changes enable row level security;

drop policy if exists "price_changes are publicly readable" on price_changes;
create policy "price_changes are publicly readable"
  on price_changes for select
  using (true);

drop policy if exists "price_changes are publicly insertable" on price_changes;
create policy "price_changes are publicly insertable"
  on price_changes for insert
  with check (true);

-- recipes: 메뉴별 재료 사용량(g). 한 재료당 한 행. store_code + menu_name으로 묶어서 조회한다.
-- 수정/삭제는 해당 메뉴의 행을 통째로 지우고 다시 넣는 방식으로 처리하므로 delete 정책이 필요하다.
create table if not exists recipes (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references stores(code),
  menu_name text not null,
  ingredient_name text not null,
  amount_g numeric,
  created_at timestamptz not null default now()
);

create index if not exists recipes_store_menu_idx on recipes (store_code, menu_name);

alter table recipes enable row level security;

drop policy if exists "recipes are publicly readable" on recipes;
create policy "recipes are publicly readable"
  on recipes for select
  using (true);

drop policy if exists "recipes are publicly insertable" on recipes;
create policy "recipes are publicly insertable"
  on recipes for insert
  with check (true);

drop policy if exists "recipes are publicly deletable" on recipes;
create policy "recipes are publicly deletable"
  on recipes for delete
  using (true);

-- ingredient_mapping: 레시피 재료명 ↔ 입고 물품명 연결. 재료명 하나당 매칭은 1개만 유지하고
-- (unique 제약), 재매칭 시 upsert로 덮어쓴다.
create table if not exists ingredient_mapping (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references stores(code),
  recipe_ingredient_name text not null,
  invoice_item_name text not null,
  created_at timestamptz not null default now(),
  unique (store_code, recipe_ingredient_name)
);

alter table ingredient_mapping enable row level security;

drop policy if exists "ingredient_mapping is publicly readable" on ingredient_mapping;
create policy "ingredient_mapping is publicly readable"
  on ingredient_mapping for select
  using (true);

drop policy if exists "ingredient_mapping is publicly insertable" on ingredient_mapping;
create policy "ingredient_mapping is publicly insertable"
  on ingredient_mapping for insert
  with check (true);

drop policy if exists "ingredient_mapping is publicly updatable" on ingredient_mapping;
create policy "ingredient_mapping is publicly updatable"
  on ingredient_mapping for update
  using (true)
  with check (true);

drop policy if exists "ingredient_mapping is publicly deletable" on ingredient_mapping;
create policy "ingredient_mapping is publicly deletable"
  on ingredient_mapping for delete
  using (true);

-- menu_prices: 메뉴별 판매가. 메뉴 하나당 1행 (unique 제약), 저장은 upsert로 처리한다.
create table if not exists menu_prices (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references stores(code),
  menu_name text not null,
  selling_price numeric not null,
  updated_at timestamptz not null default now(),
  unique (store_code, menu_name)
);

alter table menu_prices enable row level security;

drop policy if exists "menu_prices are publicly readable" on menu_prices;
create policy "menu_prices are publicly readable"
  on menu_prices for select
  using (true);

drop policy if exists "menu_prices are publicly insertable" on menu_prices;
create policy "menu_prices are publicly insertable"
  on menu_prices for insert
  with check (true);

drop policy if exists "menu_prices are publicly updatable" on menu_prices;
create policy "menu_prices are publicly updatable"
  on menu_prices for update
  using (true)
  with check (true);
