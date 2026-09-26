-- Read office leave independently of the authority to approve it.
set search_path=public,extensions;

-- permission-catalog:begin
insert into permission_catalog(key,kind,page_id,default_roles,sort_order) values
('availability.view_leave_summary', 'action', null, '{super_admin,admin,manager}', 192),
('availability.apply_leave_exception', 'action', null, '{}', 193);
-- permission-catalog:end

-- The 0171 resolver gives Super Admins every ordinary action. This one action
-- represents an explicit per-user exception, so resolve it before that rule.
create or replace function permission_effective_for(p_profile_id uuid, p_key text)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_profile user_profiles; v_catalog permission_catalog; v_role user_role; v_effect text; v_allowed boolean;
begin
  select * into v_profile from user_profiles where id=p_profile_id;
  select * into v_catalog from permission_catalog where key=p_key;
  if v_profile.id is null or v_catalog.key is null then return false; end if;
  if p_key='availability.apply_leave_exception' then
    select o.effect into v_effect from user_permission_overrides o
    where o.user_profile_id=v_profile.id and o.tenant_id=v_profile.tenant_id and o.permission_key=p_key;
    return coalesce(v_effect='grant',false);
  end if;
  select coalesce((select a.dashboard_authority from user_access_profiles a where a.user_profile_id=v_profile.id),v_profile.user_role) into v_role;
  if v_role='super_admin' then return true; end if;
  if v_catalog.kind='protected' then return false; end if;
  if v_catalog.kind='authority' then return v_role=any(v_catalog.default_roles); end if;
  select o.effect into v_effect from user_permission_overrides o where o.user_profile_id=v_profile.id and o.permission_key=p_key;
  if v_effect is not null then return v_effect='grant'; end if;
  if v_profile.designation_id is not null then
    select o.effect into v_effect from designation_permission_overrides o
      join dropdown_masters d on d.id=o.designation_id and d.is_active
    where o.tenant_id=v_profile.tenant_id and o.designation_id=v_profile.designation_id and o.permission_key=p_key;
    if v_effect is not null then return v_effect='grant'; end if;
  end if;
  select r.is_allowed into v_allowed from role_permissions r
  where r.tenant_id=v_profile.tenant_id and r.user_role=v_role and r.permission_key=p_key;
  return coalesce(v_allowed,v_role=any(v_catalog.default_roles));
end $$;

-- Existing Director and Owner designations receive the office read permission.
-- User overrides still take precedence, so individual access can be denied.
insert into designation_permission_overrides(tenant_id,designation_id,permission_key,effect)
select t.id,d.id,'availability.view_leave_summary','grant'
from dropdown_masters d join tenants t on d.tenant_id=t.id or d.tenant_id is null
where d.master_type='designation' and d.is_active
  and (lower(d.label) ~ '(^|[^a-z])(director|owner)([^a-z]|$)'
    or lower(d.value) ~ '(^|[^a-z])(director|owner)([^a-z]|$)')
on conflict (tenant_id,designation_id,permission_key) do nothing;

-- Sanket Kadam's active JewelOS profile was verified in the linked Users data.
-- The ID, role, and name must all match; local synthetic resets simply skip it.
with target as (
  select id,tenant_id from user_profiles
  where id='747f2879-6e95-48c6-a8a2-ec673ec49071'
    and lower(btrim(employee_name))='sanket kadam' and user_role='super_admin'
    and account_status='active' and is_login_enabled
), granted as (
  insert into user_permission_overrides(user_profile_id,tenant_id,permission_key,effect)
  select id,tenant_id,'availability.apply_leave_exception','grant' from target
  on conflict (user_profile_id,permission_key) do update
    set effect='grant',updated_at=now()
    where user_permission_overrides.effect<>'grant'
  returning user_profile_id,tenant_id,permission_key,effect
)
insert into audit_logs(tenant_id,action,module,record_id,new_value)
select tenant_id,'leave_apply_exception_seeded','availability',user_profile_id,
  jsonb_build_object('permission_key',permission_key,'effect',effect) from granted;

drop policy leave_requests_read on leave_requests;
create policy leave_requests_read on leave_requests for select to authenticated using (
  current_profile_is_active() and module_accessible('availability')
  and tenant_id=current_tenant_id()
  and (applicant_id=(current_profile()).id or has_permission('availability.review_leave')
    or has_permission('availability.view_leave_summary'))
);

-- Resolve applicants for the office history, including former staff and people
-- outside a manager's reporting tree. Only names of visible leave applicants
-- are exposed; handover eligibility remains a separate list.
create view leave_summary_applicants with (security_barrier=true) as
  select distinct p.id,p.employee_name
  from user_profiles p join leave_requests r on r.applicant_id=p.id
  where current_profile_is_active() and module_accessible('availability')
    and p.tenant_id=current_tenant_id() and r.tenant_id=p.tenant_id
    and has_permission('availability.view_leave_summary');
revoke all on leave_summary_applicants from public,anon,authenticated,service_role;
grant select on leave_summary_applicants to authenticated;

create or replace function leave_file_readable(p_path text)
returns boolean language sql stable security definer set search_path=public as $$
 select leave_file_writable(p_path) or exists(select 1 from leave_requests r where (r.tl_approval_path=p_path or r.handover_approval_path=p_path)
   and r.tenant_id=current_tenant_id() and current_profile_is_active() and module_accessible('availability')
   and (r.applicant_id=(current_profile()).id or has_permission('availability.review_leave')
     or has_permission('availability.view_leave_summary')))
$$;

create or replace function leave_applicant_eligible()
returns boolean language sql stable security definer set search_path=public as $$
 select exists(
   select 1 from current_profile() p
   where current_profile_is_active() and module_accessible('availability')
     and (has_permission('availability.apply_leave_exception') or (
       p.user_role <> 'super_admin'
       and not exists(
         select 1 from dropdown_masters d
         where d.id=p.designation_id and (d.tenant_id=p.tenant_id or d.tenant_id is null) and d.master_type='designation'
           and (lower(d.label) ~ '(^|[^a-z])(director|owner)([^a-z]|$)'
             or lower(d.value) ~ '(^|[^a-z])(director|owner)([^a-z]|$)')
       )
     ))
 )
$$;

notify pgrst,'reload schema';
