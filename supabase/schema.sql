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

create policy "stores are publicly readable"
  on stores for select
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

create index if not exists invoices_store_vendor_idx on invoices (store_code, vendor);
create index if not exists invoices_store_item_idx on invoices (store_code, item_name);

alter table invoices enable row level security;

create policy "invoices are publicly readable"
  on invoices for select
  using (true);

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

create index if not exists price_changes_store_idx on price_changes (store_code, changed_at desc);

alter table price_changes enable row level security;

create policy "price_changes are publicly readable"
  on price_changes for select
  using (true);

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

create policy "recipes are publicly readable"
  on recipes for select
  using (true);

create policy "recipes are publicly insertable"
  on recipes for insert
  with check (true);

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

create policy "ingredient_mapping is publicly readable"
  on ingredient_mapping for select
  using (true);

create policy "ingredient_mapping is publicly insertable"
  on ingredient_mapping for insert
  with check (true);

create policy "ingredient_mapping is publicly updatable"
  on ingredient_mapping for update
  using (true)
  with check (true);

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

create policy "menu_prices are publicly readable"
  on menu_prices for select
  using (true);

create policy "menu_prices are publicly insertable"
  on menu_prices for insert
  with check (true);

create policy "menu_prices are publicly updatable"
  on menu_prices for update
  using (true)
  with check (true);
