-- =====================================================================
-- 파출 경로 (파출사무소·당근 등) — 4개 매장이 함께 쓰는 목록
-- =====================================================================
-- roles.sql을 실행한 뒤에 한 번 실행한다. 여러 번 실행해도 안전하다.

create table if not exists public.dispatch_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 40),
  kind text not null default 'other'
    check (kind in ('agency', 'danggeun', 'job_site', 'referral', 'walk_in', 'other')),
  phone text,
  memo text,
  hidden boolean not null default false,   -- 안 쓰는 경로는 숨김 (기록은 남김)
  created_at timestamptz not null default now()
);

-- 근무마다 경로, 인력 명부에는 평소 경로
alter table public.dispatch_shifts add column if not exists source_id uuid references public.dispatch_sources(id) on delete restrict;
alter table public.dispatch_workers add column if not exists default_source_id uuid references public.dispatch_sources(id) on delete set null;
create index if not exists dispatch_shifts_source_idx on public.dispatch_shifts (source_id);

-- 읽기·추가: 로그인한 누구나(매니저도 근무 등록 중 새 경로 추가) / 고치기·지우기: 메인 관리자만
alter table public.dispatch_sources enable row level security;
drop policy if exists "sources read" on public.dispatch_sources;
drop policy if exists "sources insert" on public.dispatch_sources;
drop policy if exists "sources admin update" on public.dispatch_sources;
drop policy if exists "sources admin delete" on public.dispatch_sources;
create policy "sources read" on public.dispatch_sources for select to authenticated using (true);
create policy "sources insert" on public.dispatch_sources for insert to authenticated with check (true);
create policy "sources admin update" on public.dispatch_sources for update to authenticated
  using (public.auth_is_admin()) with check (public.auth_is_admin());
create policy "sources admin delete" on public.dispatch_sources for delete to authenticated using (public.auth_is_admin());
grant select, insert, update, delete on public.dispatch_sources to authenticated;

-- 인력 명부: 화면에서 읽을 수 있는 칸에 평소 경로 추가 (주민번호 암호값은 계속 못 읽음)
revoke all on public.dispatch_workers from anon, authenticated;
grant select (id, store_code, name, rrn_masked, bank, account, is_fixed, default_start, default_end, default_wage, default_position, default_source_id, memo, created_at, updated_at)
  on public.dispatch_workers to authenticated;

-- 자주 쓰는 경로 기본값 (이미 있으면 건너뜀)
insert into public.dispatch_sources (name, kind) values
  ('당근', 'danggeun'),
  ('알바몬', 'job_site'),
  ('알바천국', 'job_site'),
  ('지인 소개', 'referral'),
  ('직접 방문·연락', 'walk_in')
on conflict (name) do nothing;

-- 확인용
select name as "경로", kind as "종류" from public.dispatch_sources order by kind, name;
