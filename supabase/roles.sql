-- =====================================================================
-- 매니저 / 메인 관리자 권한 나누기 + 파출 관리 표
-- =====================================================================
-- security.sql(매장별 잠금)을 이미 실행한 상태에서 한 번 실행한다. 여러 번 실행해도 안전하다.
--
-- 실행 전 확인:
--   1) 새 앱을 Vercel에 배포했다 (매장 로그인 = 매니저, [메인 관리자] 버튼이 보인다)
--   2) Vercel 환경 변수 SUPABASE_SERVICE_ROLE_KEY, STORE_AUTH_SECRET이 그대로 있다
--      (STORE_AUTH_SECRET은 파출 주민번호 암호화에도 쓰므로 앞으로 절대 바꾸지 않는다)
-- 문제가 생기면 roles-rollback.sql을 실행하면 매장별 잠금(security.sql) 상태로 돌아간다. 자료는 바뀌지 않는다.
--
-- 출입증 종류
--   매니저(매장 비밀번호):  app_metadata = { store_code: '<매장코드>', role: 'manager' } → 자기 매장 + 입력 자료만
--   메인 관리자:            app_metadata = { role: 'admin' }                          → 4개 매장 전부

-- 출입증에 적힌 매장 코드 (security.sql과 같은 정의, 혹시 없을 때를 위해 다시 만든다)
create or replace function public.auth_store_code()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'store_code', '')
$$;

-- 메인 관리자 출입증인가
create or replace function public.auth_is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

-- ---------------------------------------------------------------------
-- 1) 메인 관리자 비밀번호 (서버만 읽고 쓴다)
-- ---------------------------------------------------------------------
create table if not exists public.admin_settings (
  id integer primary key default 1 check (id = 1),
  pin_hash text,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
insert into public.admin_settings (id) values (1) on conflict (id) do nothing;
alter table public.admin_settings enable row level security;
revoke all on public.admin_settings from anon, authenticated;

-- ---------------------------------------------------------------------
-- 2) 파출 관리 표
-- ---------------------------------------------------------------------
-- 인력 명부. 주민번호는 서버(api/dispatch)가 암호화해서 넣고, 화면에는 앞자리(예: 650312-2)만 보낸다.
create table if not exists public.dispatch_workers (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references public.stores(code),
  name text not null,
  rrn_masked text,          -- 650312-2 (앞 6자리 + 뒷자리 첫 숫자)
  rrn_encrypted text,       -- 주민번호 전체 (암호화)
  rrn_hash text,            -- 같은 주민번호 중복 등록 확인용
  bank text,
  account text,
  is_fixed boolean not null default false,
  default_start time,
  default_end time,
  default_wage integer,
  memo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dispatch_workers_store_idx on public.dispatch_workers (store_code, name);
create unique index if not exists dispatch_workers_rrn_uniq on public.dispatch_workers (store_code, rrn_hash) where rrn_hash is not null;

-- 근무 기록. paid_date가 있으면 송금완료(관리자만 바꿀 수 있다).
create table if not exists public.dispatch_shifts (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references public.stores(code),
  worker_id uuid not null references public.dispatch_workers(id) on delete restrict,
  work_date date not null,
  start_time time,
  end_time time,
  wage integer not null check (wage >= 0),
  bank text,
  account text,
  memo text,
  paid_date date,
  paid_marked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- 포지션(홀/주방): 근무마다 체크하고, 명부에는 평소 포지션을 둔다 (이미 표가 있어도 칸만 추가)
alter table public.dispatch_workers add column if not exists default_position text;
alter table public.dispatch_shifts add column if not exists position text;
alter table public.dispatch_workers drop constraint if exists dispatch_workers_position_check;
alter table public.dispatch_workers add constraint dispatch_workers_position_check check (default_position in ('hall', 'kitchen'));
alter table public.dispatch_shifts drop constraint if exists dispatch_shifts_position_check;
alter table public.dispatch_shifts add constraint dispatch_shifts_position_check check (position in ('hall', 'kitchen'));

create index if not exists dispatch_shifts_store_date_idx on public.dispatch_shifts (store_code, work_date);
create index if not exists dispatch_shifts_worker_idx on public.dispatch_shifts (worker_id, work_date);

-- 매장 사업자 정보 (세무 출력물의 지불인 칸: 상호·대표·사업자번호·주소)
create table if not exists public.store_business_info (
  store_code text primary key references public.stores(code),
  business_name text,
  owner_name text,
  business_no text,
  address text,
  updated_at timestamptz not null default now()
);

-- 전달사항 (메인 관리자 → 매장 매니저). 매니저는 확인·답장만 (아래 store_notices_guard)
create table if not exists public.store_notices (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references public.stores(code),
  message text not null check (char_length(message) between 1 and 1000),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  reply text,
  replied_at timestamptz
);
create index if not exists store_notices_store_idx on public.store_notices (store_code, created_at desc);

-- ---------------------------------------------------------------------
-- 3) 접근 규칙: store_code가 있는 모든 표
--    매니저 = 자기 매장만 / 메인 관리자 = 전부 / 관리자 전용 표는 매니저가 아예 못 연다
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  p record;
  -- 매니저도 읽기만 하는 표 (거래처 관리 화면): 거래처 결제, 장부 시작 잔액
  manager_read text[] := array['vendor_payments', 'vendor_opening_balances'];
  admin_only text[] := array[
    'store_settlements',        -- 매장운영결산
    'recipes', 'recipe_meta', 'ingredient_mapping', 'menu_prices',  -- 레시피·원가
    'staff_schedules',          -- 직원 근무표
    'store_business_info',      -- 사업자 정보(세무 출력)
    'sales_daily'               -- 일매출 (sales.sql)
  ];
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
    if t = any(manager_read) then
      execute format(
        'create policy "store members read" on public.%I for select to authenticated '
        'using (store_code = public.auth_store_code() or public.auth_is_admin())', t);
      execute format('create policy "admin insert" on public.%I for insert to authenticated with check (public.auth_is_admin())', t);
      execute format(
        'create policy "admin update" on public.%I for update to authenticated '
        'using (public.auth_is_admin()) with check (public.auth_is_admin())', t);
      execute format('create policy "admin delete" on public.%I for delete to authenticated using (public.auth_is_admin())', t);
    elsif t = any(admin_only) then
      execute format(
        'create policy "admin only" on public.%I for all to authenticated '
        'using (public.auth_is_admin()) with check (public.auth_is_admin())',
        t
      );
    elsif t = 'dispatch_workers' then
      -- 인력 명부는 읽기만 열고, 저장은 서버(api/dispatch)만 한다(주민번호 암호화 때문).
      execute format(
        'create policy "store members read" on public.%I for select to authenticated '
        'using (store_code = public.auth_store_code() or public.auth_is_admin())',
        t
      );
    else
      execute format(
        'create policy "store members or admin" on public.%I for all to authenticated '
        'using (store_code = public.auth_store_code() or public.auth_is_admin()) '
        'with check (store_code = public.auth_store_code() or public.auth_is_admin())',
        t
      );
    end if;
  end loop;
end $$;

-- 인력 명부: 암호화된 주민번호와 중복 확인값은 화면(출입증)으로 읽을 수 없게 한다.
revoke all on public.dispatch_workers from anon, authenticated;
grant select (id, store_code, name, rrn_masked, bank, account, is_fixed, default_start, default_end, default_wage, default_position, memo, created_at, updated_at)
  on public.dispatch_workers to authenticated;
grant select, insert, update, delete on public.dispatch_shifts to authenticated;

-- ---------------------------------------------------------------------
-- 4) 매니저가 바꿀 수 없는 것 (DB에서 막는다)
-- ---------------------------------------------------------------------
-- 4-1) 파출: 송금 정보(paid_date)는 관리자만 바꾸고, 송금완료된 근무는 매니저가 고치거나 지울 수 없다.
create or replace function public.dispatch_shifts_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op <> 'DELETE' then
    new.updated_at := now();
  end if;
  if public.auth_is_admin() or coalesce(auth.role(), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.paid_date is not null or new.paid_marked_at is not null then
      raise exception '송금 정보는 메인 관리자만 바꿀 수 있어요.';
    end if;
    return new;
  end if;
  if old.paid_date is not null then
    raise exception '송금완료된 근무라 메인 관리자만 고칠 수 있어요.';
  end if;
  if tg_op = 'UPDATE' and (new.paid_date is not null or new.paid_marked_at is not null) then
    raise exception '송금 정보는 메인 관리자만 바꿀 수 있어요.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists dispatch_shifts_guard on public.dispatch_shifts;
create trigger dispatch_shifts_guard
  before insert or update or delete on public.dispatch_shifts
  for each row execute function public.dispatch_shifts_guard();

-- 4-2) 거래명세표: 관리자가 결제 처리한 명세표(같은 거래처·같은 날·같은 금액의 결제가 있는 것)는
--      매니저가 고치거나 지울 수 없다. (매니저는 결제 자료를 못 읽으므로 DB가 대신 확인한다)
create or replace function public.invoice_batches_manager_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.auth_is_admin() or coalesce(auth.role(), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if old.invoice_date is not null and exists (
    select 1 from public.vendor_payments p
    where p.store_code = old.store_code
      and p.vendor_id = old.vendor_id
      and p.paid_date = old.invoice_date
      and round(p.amount) = round(old.total_amount)
  ) then
    raise exception '관리자가 결제 처리한 명세표라 매니저는 고치거나 지울 수 없어요. 메인 관리자에게 요청해주세요.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists invoice_batches_manager_guard on public.invoice_batches;
create trigger invoice_batches_manager_guard
  before update or delete on public.invoice_batches
  for each row execute function public.invoice_batches_manager_guard();

-- 4-3) 전달사항: 매니저는 보내거나 지울 수 없고 확인·답장 칸만 바꾼다.
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

-- ---------------------------------------------------------------------
-- 5) 명세표 사진: 매니저는 자기 매장 폴더, 관리자는 전부
-- ---------------------------------------------------------------------
drop policy if exists "invoice-photos store read" on storage.objects;
drop policy if exists "invoice-photos store insert" on storage.objects;
drop policy if exists "invoice-photos store update" on storage.objects;
drop policy if exists "invoice-photos store delete" on storage.objects;
create policy "invoice-photos store read" on storage.objects for select to authenticated
  using (bucket_id = 'invoice-photos' and ((storage.foldername(name))[1] = public.auth_store_code() or public.auth_is_admin()));
create policy "invoice-photos store insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'invoice-photos' and ((storage.foldername(name))[1] = public.auth_store_code() or public.auth_is_admin()));
create policy "invoice-photos store update" on storage.objects for update to authenticated
  using (bucket_id = 'invoice-photos' and ((storage.foldername(name))[1] = public.auth_store_code() or public.auth_is_admin()))
  with check (bucket_id = 'invoice-photos' and ((storage.foldername(name))[1] = public.auth_store_code() or public.auth_is_admin()));
create policy "invoice-photos store delete" on storage.objects for delete to authenticated
  using (bucket_id = 'invoice-photos' and ((storage.foldername(name))[1] = public.auth_store_code() or public.auth_is_admin()));

-- 매장 이름: 예비매장 → 정담카페 (앱 화면의 이름과 맞춘다)
update public.stores set name = '정담카페' where code = 'spare' and name = '예비매장';

-- 확인용: 표마다 정책이 하나씩 보이면 정상 ("admin only" = 관리자 전용)
select tablename as "표", policyname as "정책"
from pg_policies
where schemaname = 'public'
order by tablename;
