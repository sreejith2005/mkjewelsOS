-- Task Control workspace: the templates directory, employee progress and the
-- evidence workspace are now one filtered surface, so employee progress must
-- answer the same question the evidence workspace already answers -- who is
-- behind -- and accept the same filter shape.
--
-- Two additions, no behaviour removed:
--   * `overdue` per employee and per roll-up, defined exactly as the evidence
--     workspace defines it, so the two panels on one screen never disagree.
--   * `user_profile_id`, so selecting a person in the shared filter bar narrows
--     progress the same way it narrows evidence.
set search_path=public,extensions;

create or replace function public.get_employee_task_progress(p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor user_profiles;
  v_from date:=coalesce(nullif(p_context->>'from','')::date,(now() at time zone 'Asia/Kolkata')::date);
  v_to date:=coalesce(nullif(p_context->>'to','')::date,v_from);
  v_branch uuid:=nullif(p_context->>'branch_id','')::uuid;
  v_department uuid:=nullif(p_context->>'department_id','')::uuid;
  v_user uuid:=nullif(p_context->>'user_profile_id','')::uuid;
  v_result jsonb;
begin
 select * into v_actor from user_profiles where auth_user_id=auth.uid() and account_status='active' and is_login_enabled;
 if v_actor.id is null or v_actor.user_role not in ('super_admin','admin','hr','manager') then raise exception 'Employee progress is not authorized' using errcode='42501'; end if;
 if v_to<v_from or v_to-v_from>366 then raise exception 'Date range is invalid' using errcode='22023'; end if;
 if v_actor.user_role='manager' and v_branch is not null and v_branch<>v_actor.branch_id then raise exception 'Branch is not authorized' using errcode='42501'; end if;
 if v_actor.user_role='manager' then v_branch:=v_actor.branch_id; end if;
 with visible as materialized (
   select a.user_profile_id,t.status,t.planned_datetime,t.actual_datetime,t.due_datetime,
     u.employee_name,u.branch_id,u.department_id,b.name branch_name,d.name department_name
   from task_assignees a
   join task_instances t on t.id=a.task_instance_id
   join user_profiles u on u.id=a.user_profile_id
   join branches b on b.id=u.branch_id
   left join departments d on d.id=u.department_id
   where a.is_active and t.tenant_id=v_actor.tenant_id and u.account_status='active' and u.is_login_enabled
     and (v_branch is null or u.branch_id=v_branch)
     and (v_department is null or u.department_id=v_department)
     and (v_user is null or a.user_profile_id=v_user)
     and (t.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to
 ), employees as (
   select user_profile_id,employee_name,branch_id,branch_name,department_id,department_name,
     count(*)::int assigned,
     (count(*) filter(where status='completed' and (actual_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to))::int completed,
     (count(*) filter(where status<>'completed'))::int remaining,
     (count(*) filter(where status not in ('completed','rejected') and coalesce(due_datetime,planned_datetime)<now()))::int overdue
   from visible group by 1,2,3,4,5,6
 ), departments as (
   select department_id,department_name,sum(assigned)::int assigned,sum(completed)::int completed,
     sum(remaining)::int remaining,sum(overdue)::int overdue from employees group by 1,2
 ), branches as (
   select branch_id,branch_name,sum(assigned)::int assigned,sum(completed)::int completed,
     sum(remaining)::int remaining,sum(overdue)::int overdue from employees group by 1,2
 )
 select jsonb_build_object(
   'employees',coalesce((select jsonb_agg(to_jsonb(employees) order by employee_name) from employees),'[]'::jsonb),
   'departments',coalesce((select jsonb_agg(to_jsonb(departments) order by department_name) from departments),'[]'::jsonb),
   'branches',coalesce((select jsonb_agg(to_jsonb(branches) order by branch_name) from branches),'[]'::jsonb)
 ) into v_result;
 return v_result;
end $$;

revoke all on function public.get_employee_task_progress(jsonb) from public,anon;
grant execute on function public.get_employee_task_progress(jsonb) to authenticated;

notify pgrst,'reload schema';
