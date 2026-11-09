-- =====================================================================
-- 직원 명부에 포지션(홀/주방/기타)과 고용 형태(정직원/아르바이트) 추가
-- =====================================================================
-- staff-daily.sql을 실행한 뒤에 한 번 실행한다. 여러 번 실행해도 안전하다(자료는 지우지 않는다).
--
-- position        : '홀' / '주방' / 직접 입력한 이름(예: 카운터, 주방보조). 비어 있으면 "포지션 미지정"
-- employment_type : 'regular'(정직원) / 'part'(아르바이트) / 비어 있음(미입력)
-- 접근 규칙은 staff-daily.sql에서 만든 것(매니저 = 자기 매장, 메인 관리자 = 전부)을 그대로 쓴다.

alter table public.staff_members add column if not exists position text;
alter table public.staff_members add column if not exists employment_type text;

alter table public.staff_members drop constraint if exists staff_members_position_len;
alter table public.staff_members add constraint staff_members_position_len
  check (position is null or char_length(position) between 1 and 20);

alter table public.staff_members drop constraint if exists staff_members_employment_type_check;
alter table public.staff_members add constraint staff_members_employment_type_check
  check (employment_type is null or employment_type in ('regular', 'part'));

-- 확인용: 두 칸이 보이면 정상
select column_name as "칸", data_type as "형식"
from information_schema.columns
where table_schema = 'public' and table_name = 'staff_members' and column_name in ('position', 'employment_type')
order by 1;
