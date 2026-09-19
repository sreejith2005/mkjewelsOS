-- Keep task-feed scope discovery away from the wide v_all_tasks projection.
-- That view intentionally carries checklist aggregates and organization/FMS
-- details, which made every offset page repeat expensive joins before it could
-- discard rows. This narrow security-invoker view finds authorized identifiers
-- first; clients hydrate only bounded identifier batches from v_all_tasks.
set search_path = public, extensions;

create index if not exists idx_fms_starter_assignments_assigner_pending
  on public.fms_starter_assignments (tenant_id, assigned_by, created_at desc, id)
  where status = 'pending';

create or replace view public.v_task_feed_scope with (security_invoker = true) as
  select
    ti.id,
    ti.tenant_id,
    ti.created_by,
    ta.user_profile_id as assignee_id,
    ti.task_type,
    ti.status,
    coalesce(ti.revised_datetime, ti.due_datetime, ti.planned_datetime) as effective_due_datetime,
    ti.planned_datetime
  from public.task_instances ti
  left join public.task_assignees ta
    on ta.task_instance_id = ti.id
   and ta.is_active
   and ta.role_at_task = 'doer'
  union all
  select
    fis.id,
    fi.tenant_id,
    fi.started_by,
    unnest(fis.assigned_to),
    'fms'::public.task_type,
    fis.status,
    fis.planned_datetime,
    fis.planned_datetime
  from public.fms_instance_stages fis
  join public.fms_instances fi on fi.id = fis.fms_instance_id
  union all
  select
    starter.id,
    starter.tenant_id,
    starter.assigned_by,
    starter.user_profile_id,
    'fms'::public.task_type,
    'pending'::public.task_status,
    starter.created_at,
    starter.created_at
  from public.fms_starter_assignments starter
  where starter.status = 'pending';

revoke all on public.v_task_feed_scope from public, anon;
grant select on public.v_task_feed_scope to authenticated;

notify pgrst, 'reload schema';
