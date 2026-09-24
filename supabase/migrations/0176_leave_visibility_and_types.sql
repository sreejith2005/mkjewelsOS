-- Keep leave choices in Dropdown Master and block exempt leadership accounts at the RPC boundary.
set search_path=public,extensions;

insert into dropdown_master_categories(tenant_id,category_key,display_name,sort_order,is_system,is_key_locked,is_active)
select id,'leave_type','Leave Types',140,true,true,true from tenants
on conflict(tenant_id,category_key) do update set is_active=true;

insert into dropdown_masters(tenant_id,master_type,label,value,sort_order,is_active)
select t.id,'leave_type',v.label,v.value,v.sort_order,true
from tenants t cross join (values
  ('Casual Leave','casual',10),
  ('Sick Leave','sick',20),
  ('Earned Leave','earned',30)
) v(label,value,sort_order)
on conflict(tenant_id,master_type,value) do update set is_active=true;

create function leave_applicant_eligible()
returns boolean language sql stable security definer set search_path=public as $$
 select exists(
   select 1 from current_profile() p
   where current_profile_is_active() and module_accessible('availability')
     and p.user_role <> 'super_admin'
     and not exists(
       select 1 from dropdown_masters d
       where d.id=p.designation_id and (d.tenant_id=p.tenant_id or d.tenant_id is null) and d.master_type='designation'
         and (lower(d.label) ~ '(^|[^a-z])(director|owner)([^a-z]|$)'
           or lower(d.value) ~ '(^|[^a-z])(director|owner)([^a-z]|$)')
     )
 )
$$;
revoke all on function leave_applicant_eligible() from public,anon,authenticated,service_role;
grant execute on function leave_applicant_eligible() to authenticated;

create or replace function submit_leave_request(p_leave_type text,p_duration text,p_reason text,p_leave_start date,
  p_leave_end date,p_work_start_date date,p_work_start_in text,p_tl_approval_path text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_new leave_requests;
begin
  perform assert_module_access('availability');
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() then raise exception 'Active employee required' using errcode='42501'; end if;
  if not leave_applicant_eligible() then raise exception 'Leave application is unavailable for this account' using errcode='42501'; end if;
  if p_leave_type is null or length(btrim(p_leave_type)) not between 1 and 120
    or not exists(select 1 from dropdown_masters where (tenant_id=v_actor.tenant_id or tenant_id is null) and master_type='leave_type'
      and is_active and value=p_leave_type)
    or p_duration not in ('FULL DAY','1ST HALF','2ND HALF')
    or p_work_start_in not in ('1ST HALF','2ND HALF')
    or p_reason is null or length(btrim(p_reason)) not between 1 and 1000
    or p_leave_start is null or p_leave_end is null or p_work_start_date is null
    or p_leave_end<p_leave_start or p_work_start_date<p_leave_end
    or p_work_start_date-p_leave_start>366 then
    raise exception 'Leave application fields are invalid' using errcode='22023';
  end if;
  perform assert_leave_image(p_tl_approval_path,'tl',v_actor);
  insert into leave_requests(tenant_id,applicant_id,branch_id,leave_type,duration,reason,leave_start,leave_end,
    work_start_date,work_start_in,inform_status,total_leave_count,tl_approval_path)
  values(v_actor.tenant_id,v_actor.id,v_actor.branch_id,p_leave_type,p_duration,btrim(p_reason),p_leave_start,p_leave_end,
    p_work_start_date,p_work_start_in,leave_inform_status((now() at time zone 'Asia/Kolkata')::date,p_leave_start,p_leave_end),
    leave_day_count(p_duration,p_leave_start,p_leave_end,p_work_start_date,p_work_start_in),p_tl_approval_path)
  returning * into v_new;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'leave_submitted','availability',v_new.id,to_jsonb(v_new));
  return v_new.id;
end $$;

notify pgrst,'reload schema';
