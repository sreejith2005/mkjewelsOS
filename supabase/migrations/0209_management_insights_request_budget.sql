-- This private SECURITY INVOKER predicate reads only its parameters and built-in
-- expressions (including transaction time); it performs no table/identity reads.
-- A function SET clause prevents SQL scalar inlining, causing two separate SQL
-- executions per metric/record pair in the overview aggregates. Remove that
-- planner barrier. Definer RPCs and row helpers retain their fixed search paths,
-- authorization and grants; the predicate remains inaccessible to client roles.
alter function public.management_insights_metric_matches_v1(
 text,text,text,timestamptz,timestamptz,boolean,timestamptz,timestamptz,jsonb
) reset search_path;

-- Module access is stable for one statement. Resolve it once per row-helper
-- invocation instead of repeating permission and profile queries for each task.
create or replace function management_insights_rows_v1(c jsonb)
returns table(record jsonb,module text,status text,due timestamptz,completed timestamptz,branch_id uuid,department_id uuid,employee_ids uuid[],task_type text,flow_id uuid,uncovered boolean)
language plpgsql stable security definer set search_path=public as $$
declare a user_profiles; can_tasks boolean; can_workflows boolean; can_forms boolean; can_people boolean;
begin
 a:=current_profile();
 can_tasks:=module_accessible('checklist_tasks');
 can_workflows:=module_accessible('fms_builder');
 can_forms:=module_accessible('forms_library');
 can_people:=module_accessible('availability');
 if can_tasks then
 return query select jsonb_build_object('id',t.id,'title',t.title,'status',t.status,'due',task_effective_due_datetime(t),'completed',t.actual_datetime,'module','tasks','task_id',t.id,'availability_clash',can_people and task_effective_due_datetime(t) is not null and exists(select 1 from task_assignees ta where ta.task_instance_id=t.id and ta.is_active and (not is_user_available_for_task(ta.user_profile_id,(task_effective_due_datetime(t) at time zone (c->>'timezone'))::date) or leave_half_day_absent_at(ta.user_profile_id,task_effective_due_datetime(t)))),'awaiting_form',can_forms and t.requires_form and t.form_template_id is not null and not exists(select 1 from form_submissions fs where fs.linked_record_id=t.id and fs.form_template_id=t.form_template_id and fs.linked_module in ('task','checklist_task','delegation_task'))),
  'tasks'::text,t.status::text,task_effective_due_datetime(t),t.actual_datetime,t.branch_id,t.department_id,
  array(select ta.user_profile_id from task_assignees ta where ta.task_instance_id=t.id and ta.is_active),t.task_type::text,null::uuid,t.coverage_status='coverage_required'
 from task_instances t where task_in_reporting_scope(a,t,c)
  and (c->>'task_type' is null or t.task_type::text=c->>'task_type') and (c->>'priority' is null or t.priority::text=c->>'priority')
  and (c->>'status' is null or t.status::text=c->>'status') and (c->>'source' is null or t.source=c->>'source') and (c->>'category_id' is null or t.category_id=(c->>'category_id')::uuid)
  and (c->>'designation_id' is null or exists(select 1 from task_assignees ta join user_profiles u on u.id=ta.user_profile_id where ta.task_instance_id=t.id and ta.is_active and u.designation_id=(c->>'designation_id')::uuid));
 end if;
 if can_workflows then
 return query select jsonb_build_object('id',s.id,'title',concat(f.name,'  |  ',d.name),'status',s.status,'due',s.planned_datetime,'completed',s.actual_datetime,'module','workflows','instance_id',i.id,'stage_id',s.id,'step_type',d.step_type),
  'workflows'::text,s.status::text,s.planned_datetime,s.actual_datetime,i.branch_id,i.department_id,
  array(select sa.user_profile_id from fms_instance_stage_assignees sa where sa.fms_instance_stage_id=s.id and sa.is_active),null::text,i.fms_flow_id,false
 from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id join fms_flows f on f.id=i.fms_flow_id join fms_stages d on d.id=s.fms_stage_id
 where fms_stage_in_reporting_scope(a,s.id,c) and (c->>'stage_id' is null or s.fms_stage_id=(c->>'stage_id')::uuid) and (c->>'flow_id' is null or i.fms_flow_id=(c->>'flow_id')::uuid)
  and (c->>'status' is null or s.status::text=c->>'status')
  and (c->>'designation_id' is null or exists(select 1 from fms_instance_stage_assignees sa join user_profiles u on u.id=sa.user_profile_id where sa.fms_instance_stage_id=s.id and sa.is_active and u.designation_id=(c->>'designation_id')::uuid));
 return query select jsonb_build_object('id',s.id,'title',concat(f.name,'  |  Starter form'),'status',s.status,'due',null,'completed',s.completed_at,'module','workflows','starter_id',s.id,'form_id',s.form_template_id),
  'workflows'::text,s.status::text,null::timestamptz,s.completed_at,u.branch_id,u.department_id,array[u.id],null::text,s.fms_flow_id,false
 from fms_starter_assignments s join user_profiles u on u.id=s.user_profile_id join fms_flows f on f.id=s.fms_flow_id
 where (c->>'stage_id' is null or s.fms_stage_id=(c->>'stage_id')::uuid) and s.tenant_id=a.tenant_id and (a.user_role in ('super_admin','admin') or a.user_role='manager' and u.branch_id=a.branch_id or u.id=a.id)
  and (c->>'branch_id' is null or u.branch_id=(c->>'branch_id')::uuid) and (c->>'department_id' is null or u.department_id=(c->>'department_id')::uuid)
  and (c->>'user_profile_id' is null or u.id=(c->>'user_profile_id')::uuid) and (c->>'designation_id' is null or u.designation_id=(c->>'designation_id')::uuid)
  and (c->>'flow_id' is null or s.fms_flow_id=(c->>'flow_id')::uuid);
 end if;
 if can_forms then
 return query select jsonb_build_object('id',s.id,'title',f.name,'status',s.status,'due',s.submitted_at,'completed',s.reviewed_at,'module','forms','form_id',s.form_template_id),
  'forms'::text,s.status::text,s.submitted_at,s.reviewed_at,s.branch_id,s.department_id,array[s.submitted_by],null::text,null::uuid,false
 from form_submissions s join form_templates f on f.id=s.form_template_id join user_profiles u on u.id=s.submitted_by
 where s.tenant_id=a.tenant_id and (a.user_role in ('super_admin','admin') or a.user_role='manager' and s.branch_id=a.branch_id or s.submitted_by=a.id)
  and (c->>'branch_id' is null or s.branch_id=(c->>'branch_id')::uuid) and (c->>'department_id' is null or s.department_id=(c->>'department_id')::uuid)
  and (c->>'flow_id' is null and c->>'stage_id' is null or s.linked_module='fms_stage' and exists(select 1 from fms_instance_stages fs join fms_instances fi on fi.id=fs.fms_instance_id where fs.id=s.linked_record_id and (c->>'flow_id' is null or fi.fms_flow_id=(c->>'flow_id')::uuid) and (c->>'stage_id' is null or fs.fms_stage_id=(c->>'stage_id')::uuid)))
  and (c->>'user_profile_id' is null or s.submitted_by=(c->>'user_profile_id')::uuid) and (c->>'designation_id' is null or u.designation_id=(c->>'designation_id')::uuid);
 end if;
 if can_people and a.user_role in ('super_admin','admin','manager','hr') then
 return query select jsonb_build_object('id',u.id,'title',u.employee_name,'status',case when (is_user_available_for_task(u.id,(now() at time zone (c->>'timezone'))::date) and not leave_half_day_absent_at(u.id,now())) then 'available' else 'unavailable' end,'due',null,'completed',null,'module','people','employee_id',u.id),
  'people'::text,case when (is_user_available_for_task(u.id,(now() at time zone (c->>'timezone'))::date) and not leave_half_day_absent_at(u.id,now())) then 'available' else 'unavailable' end,null::timestamptz,null::timestamptz,u.branch_id,u.department_id,array[u.id],null::text,null::uuid,false
 from user_profiles u where u.tenant_id=a.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
  and (c->>'branch_id' is null or u.branch_id=(c->>'branch_id')::uuid) and (c->>'department_id' is null or u.department_id=(c->>'department_id')::uuid)
  and (c->>'user_profile_id' is null or u.id=(c->>'user_profile_id')::uuid) and (c->>'designation_id' is null or u.designation_id=(c->>'designation_id')::uuid);
 end if;
end $$;
