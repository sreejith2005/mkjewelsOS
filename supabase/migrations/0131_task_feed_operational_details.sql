-- Expandable task details: expose the operational context the Tasks feed already
-- authorizes, without adding a per-card query. The view stays security-invoker so
-- task, template, branch, and department RLS remain the real permission boundary:
-- a caller who cannot read a template simply receives null template context.

drop view if exists public.v_all_tasks;
create view public.v_all_tasks with (security_invoker=true) as
  select ti.id,ti.tenant_id,ti.branch_id,ti.department_id,ti.category_id,ti.task_template_id,
    ti.task_type,ti.title,ti.description,ti.priority,ti.status,ti.created_by,ti.planned_datetime,
    ti.revised_datetime,ti.actual_datetime,ti.delay_minutes,ti.source,ti.requires_upload,
    ti.requires_remark,ti.requires_form,ti.form_template_id,ta.user_profile_id as assignee_id,
    coalesce(round(100.0*count(tc.id) filter(where tc.is_required and tc.is_completed)
      /nullif(count(tc.id) filter(where tc.is_required),0)),
      case when count(tc.id) filter(where tc.is_required)=0 then 100 else 0 end)::integer as checklist_completion_pct,
    ti.due_datetime,ti.core_task_label,ti.verifier_user_profile_id,
    ti.scheduled_date,ti.assignment_status,ti.buddy_assignment_allowed,ti.verification_status,
    b.name as branch_name,d.name as department_name,
    tt.schedule_kind,tt.starts_on,tt.planned_time,tt.due_time,tt.is_active,tt.verification_required
  from public.task_instances ti
  left join public.task_assignees ta on ta.task_instance_id=ti.id and ta.is_active and ta.role_at_task='doer'
  left join public.task_checklists tc on tc.task_instance_id=ti.id
  left join public.task_templates tt on tt.id=ti.task_template_id
  left join public.branches b on b.id=ti.branch_id
  left join public.departments d on d.id=ti.department_id
  group by ti.id,ta.user_profile_id,tt.id,b.id,d.id
  union all
  select fis.id,fi.tenant_id,fi.branch_id,null::uuid,null::uuid,null::uuid,'fms'::public.task_type,
    fs.name,fs.method,fi.priority,fis.status,fi.started_by,fis.planned_datetime,null::timestamptz,
    fis.actual_datetime,fis.delay_minutes,'fms'::text,fs.requires_upload,fs.requires_remark,
    (fs.form_template_id is not null),fs.form_template_id,unnest(fis.assigned_to),0,
    null::timestamptz,null::text,null::uuid,
    null::date,null::text,null::boolean,null::text,
    fb.name,null::text,
    null::text,null::date,null::time,null::time,null::boolean,null::boolean
  from public.fms_instance_stages fis
  join public.fms_instances fi on fi.id=fis.fms_instance_id
  join public.fms_stages fs on fs.id=fis.fms_stage_id
  left join public.branches fb on fb.id=fi.branch_id;
grant select on public.v_all_tasks to authenticated;
notify pgrst,'reload schema';
