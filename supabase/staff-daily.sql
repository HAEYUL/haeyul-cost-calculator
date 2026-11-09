-- =====================================================================
-- 직원근무표: 매니저 매일 기록 · 직원 명부 · 저장한 날 · 월 마감
-- =====================================================================
-- roles.sql을 실행한 뒤에 한 번 실행한다. 여러 번 실행해도 안전하다(자료는 지우지 않는다).
--
-- 1) staff_members      직원 명부: 이름, 평소 쉬는 요일, 재직/퇴사, 순서
-- 2) staff_day_logs     매니저가 [오늘 근무 저장]을 누른 날. 저장한 날만 "체크 안 한 직원 = 휴무"로 확정하고,
--                       저장 안 한 날은 "미기록"으로 남겨 알림에 쓴다.
-- 3) staff_month_closes 월 마감. 마감한 달은 매니저가 근무표를 고칠 수 없다(마감·해제는 메인 관리자만).
-- 4) staff_schedules    (기존 근무표) 메인 관리자 전용 → 매니저도 자기 매장 것을 읽고 쓰게 연다.
--                       days 값: O(종일) / △(반타임) / 연(연차) / X(휴무)

-- 출입증 함수 (roles.sql과 같은 정의, 혹시 없을 때를 위해 다시 만든다)
create or replace function public.auth_store_code()
returns text language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'store_code', '')
$$;

create or replace function public.auth_is_admin()
returns boolean language sql stable as $$
  select coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
$$;

-- ---------------------------------------------------------------------
-- 1) 직원 명부
-- ---------------------------------------------------------------------
create table if not exists public.staff_members (
  id uuid primary key default gen_random_uuid(),
  store_code text not null references public.stores(code),
  name text not null,
  off_weekdays smallint[] not null default '{}',   -- 평소 쉬는 요일 (0=일 1=월 … 6=토)
  active boolean not null default true,             -- false = 퇴사(목록에서 빠지고 지난 기록은 남는다)
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (store_code, name)
);
create index if not exists staff_members_store_idx on public.staff_members (store_code, active, sort_order);

-- ---------------------------------------------------------------------
-- 2) 저장한 날
-- ---------------------------------------------------------------------
create table if not exists public.staff_day_logs (
  store_code text not null references public.stores(code),
  work_date date not null,
  saved_at timestamptz not null default now(),
  primary key (store_code, work_date)
);

-- ---------------------------------------------------------------------
-- 3) 월 마감
-- ---------------------------------------------------------------------
create table if not exists public.staff_month_closes (
  store_code text not null references public.stores(code),
  year integer not null,
  month integer not null check (month between 1 and 12),
  closed_at timestamptz not null default now(),
  primary key (store_code, year, month)
);

-- ---------------------------------------------------------------------
-- 접근 규칙
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  p record;
begin
  -- 매니저 = 자기 매장 읽기·쓰기 / 메인 관리자 = 전부
  foreach t in array array['staff_members', 'staff_day_logs', 'staff_schedules'] loop
    for p in select policyname from pg_policies where schemaname = 'public' and tablename = t loop
      execute format('drop policy %I on public.%I', p.policyname, t);
    end loop;
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy "store members or admin" on public.%I for all to authenticated '
      'using (store_code = public.auth_store_code() or public.auth_is_admin()) '
      'with check (store_code = public.auth_store_code() or public.auth_is_admin())',
      t
    );
  end loop;

  -- 월 마감: 매니저는 읽기만, 마감·해제는 메인 관리자만
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'staff_month_closes' loop
    execute format('drop policy %I on public.staff_month_closes', p.policyname);
  end loop;
  alter table public.staff_month_closes enable row level security;
  create policy "store members read" on public.staff_month_closes for select to authenticated
    using (store_code = public.auth_store_code() or public.auth_is_admin());
  create policy "admin write" on public.staff_month_closes for all to authenticated
    using (public.auth_is_admin()) with check (public.auth_is_admin());
end $$;

grant select, insert, update, delete on public.staff_members, public.staff_day_logs, public.staff_schedules to authenticated;
grant select, insert, update, delete on public.staff_month_closes to authenticated;

-- ---------------------------------------------------------------------
-- 마감한 달은 매니저가 근무표·저장 기록을 고칠 수 없다 (DB에서 막는다)
-- ---------------------------------------------------------------------
create or replace function public.staff_month_closed(p_store text, p_year integer, p_month integer)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.staff_month_closes c
    where c.store_code = p_store and c.year = p_year and c.month = p_month
  )
$$;

create or replace function public.staff_schedules_close_guard()
returns trigger language plpgsql as $$
begin
  if public.auth_is_admin() or coalesce(auth.role(), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and public.staff_month_closed(old.store_code, old.year, old.month) then
    raise exception '마감한 달이라 메인 관리자만 고칠 수 있어요.';
  end if;
  if tg_op in ('INSERT', 'UPDATE') and public.staff_month_closed(new.store_code, new.year, new.month) then
    raise exception '마감한 달이라 메인 관리자만 고칠 수 있어요.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists staff_schedules_close_guard on public.staff_schedules;
create trigger staff_schedules_close_guard
  before insert or update or delete on public.staff_schedules
  for each row execute function public.staff_schedules_close_guard();

create or replace function public.staff_day_logs_close_guard()
returns trigger language plpgsql as $$
begin
  if public.auth_is_admin() or coalesce(auth.role(), '') = 'service_role' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE')
     and public.staff_month_closed(old.store_code, extract(year from old.work_date)::int, extract(month from old.work_date)::int) then
    raise exception '마감한 달이라 메인 관리자만 고칠 수 있어요.';
  end if;
  if tg_op in ('INSERT', 'UPDATE')
     and public.staff_month_closed(new.store_code, extract(year from new.work_date)::int, extract(month from new.work_date)::int) then
    raise exception '마감한 달이라 메인 관리자만 고칠 수 있어요.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists staff_day_logs_close_guard on public.staff_day_logs;
create trigger staff_day_logs_close_guard
  before insert or update or delete on public.staff_day_logs
  for each row execute function public.staff_day_logs_close_guard();

-- ---------------------------------------------------------------------
-- 기존 근무표에 있던 직원 이름을 명부로 옮긴다 (이미 있으면 건너뜀)
-- ---------------------------------------------------------------------
insert into public.staff_members (store_code, name)
select distinct store_code, employee_name from public.staff_schedules
on conflict (store_code, name) do nothing;

-- 확인용: 표 4개와 직원 수가 보이면 정상
select t.table_name as "표",
       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = t.table_name) as "접근 규칙 수"
from information_schema.tables t
where t.table_schema = 'public' and t.table_name in ('staff_members', 'staff_day_logs', 'staff_month_closes', 'staff_schedules')
order by 1;
