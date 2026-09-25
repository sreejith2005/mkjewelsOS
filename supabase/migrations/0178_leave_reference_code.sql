-- Readable leave Unique ID, matching the source sheet: NAME-DD-MON-YYYY-HHMMSS
-- (Asia/Kolkata). The UUID stays the key; the code is assigned once and never
-- changes, so handover, edits, review, and history all show the same reference.
set search_path=public,extensions;

alter table leave_requests add column reference_code text;

-- Backfill existing requests in submission order; same-second repeats get -2, -3.
with base as (
  select r.id,r.tenant_id,
    coalesce(nullif(btrim(regexp_replace(upper(p.employee_name),'[^A-Z0-9]+',' ','g')),''),'LEAVE')
      ||'-'||to_char(r.submitted_at at time zone 'Asia/Kolkata','DD-MON-YYYY-HH24MISS') as code,
    r.submitted_at
  from leave_requests r join user_profiles p on p.id=r.applicant_id
), numbered as (
  select id,code,row_number() over(partition by tenant_id,code order by submitted_at,id) as n from base
)
update leave_requests r set reference_code=case when n.n=1 then n.code else n.code||'-'||n.n end
from numbered n where n.id=r.id;

alter table leave_requests alter column reference_code set not null;
create unique index leave_requests_reference_code_idx on leave_requests(tenant_id,reference_code);

create function assign_leave_reference_code()
returns trigger language plpgsql set search_path=public as $$
declare v_base text; v_code text; v_n integer:=1;
begin
  if tg_op='UPDATE' then
    new.reference_code:=old.reference_code;
    return new;
  end if;
  select coalesce(nullif(btrim(regexp_replace(upper(employee_name),'[^A-Z0-9]+',' ','g')),''),'LEAVE')
    into v_base from user_profiles where id=new.applicant_id;
  v_base:=coalesce(v_base,'LEAVE')||'-'||to_char(new.submitted_at at time zone 'Asia/Kolkata','DD-MON-YYYY-HH24MISS');
  v_code:=v_base;
  while exists(select 1 from leave_requests where tenant_id=new.tenant_id and reference_code=v_code) loop
    v_n:=v_n+1;
    v_code:=v_base||'-'||v_n;
  end loop;
  new.reference_code:=v_code;
  return new;
end $$;

create trigger leave_requests_reference_code before insert or update on leave_requests
for each row execute function assign_leave_reference_code();

revoke all on function assign_leave_reference_code() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
