-- Task Templates directory: remove the per-row scans that timed out on real data.
--
-- 0108 built each directory row with four correlated subqueries: two counts over
-- task_instances and an EXISTS over each import table. None of them could use an
-- index:
--
--   * idx_task_instances_template_scheduled_date is partial
--     (`where task_template_id is not null and scheduled_date is not null`), so
--     the planner cannot use it for a plain `task_template_id = ?` lookup - the
--     `scheduled_date is not null` predicate is not implied by the join;
--   * task_import_items and task_import_row_registry have no index on
--     task_template_id at all.
--
-- The result was four sequential scans per template row, which reached the
-- statement timeout once production had real template and instance volume.
--
-- Two corrections:
--
-- 1. `open_instance_count` and `preserved_instance_count` are dropped from the
--    payload. Nothing renders them - the delete flow reports the real counts
--    from `delete_task_template_with_audit`'s return value - so they were paying
--    two table scans per row for data no one read.
-- 2. The import-origin lookup becomes one distinct set joined once, instead of
--    two EXISTS probes per row.
--
-- The indexes below still matter for `delete_task_template_with_audit`, which
-- looks templates up in the same three tables. Creating an index takes a brief
-- SHARE lock that blocks writes to the table while it builds; these tables are
-- small enough for that to be momentary, and reads are unaffected.

set search_path = public, extensions;

-- 1. Indexes the template lookups actually need -----------------------------

create index if not exists idx_task_instances_template
  on public.task_instances(task_template_id)
  where task_template_id is not null;

create index if not exists idx_task_import_items_template
  on public.task_import_items(task_template_id)
  where task_template_id is not null;

create index if not exists idx_task_import_row_registry_template
  on public.task_import_row_registry(task_template_id)
  where task_template_id is not null;

-- 2. Single-pass directory read ---------------------------------------------

create or replace function public.get_task_template_directory(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_actor public.user_profiles; v_search text; v_rows jsonb;
begin
  select * into v_actor from public.user_profiles where auth_user_id = auth.uid();
  if v_actor.id is null or not public.current_profile_is_active()
     or v_actor.user_role not in ('super_admin','admin') then
    raise exception 'Task template directory access denied' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_filter,'{}'::jsonb)) <> 'object' then
    raise exception 'Task template filter is invalid' using errcode = '22023';
  end if;
  v_search := lower(btrim(coalesce(p_filter->>'search','')));

  with imported as (
    select distinct origin.task_template_id
    from (
      select i.task_template_id from public.task_import_items i where i.task_template_id is not null
      union all
      select r.task_template_id from public.task_import_row_registry r where r.task_template_id is not null
    ) origin
  )
  select coalesce(jsonb_agg(listing.entry order by listing.owner_name, listing.task_title),'[]'::jsonb)
  into v_rows
  from (
    select
      coalesce(u.employee_name,'') as owner_name,
      t.title as task_title,
      jsonb_build_object(
        'id', t.id,
        'title', t.title,
        'description', t.description,
        'assignee_user_id', t.default_assignee_user_id,
        'assignee_name', coalesce(u.employee_name,''),
        'assignee_type', t.default_assignee_type,
        'department_id', t.department_id,
        'department_name', coalesce(d.name,''),
        'branch_id', t.branch_id,
        'branch_name', coalesce(b.name,''),
        'task_type', t.task_type,
        'schedule_kind', t.schedule_kind,
        'recurrence_rule', t.recurrence_rule,
        'starts_on', t.starts_on,
        'planned_time', t.planned_time,
        'due_time', t.due_time,
        'priority', t.priority,
        'requires_upload', coalesce(t.requires_upload,false),
        'requires_form', coalesce(t.requires_form,false),
        'verification_required', t.verification_required,
        'followup_enabled', t.followup_enabled,
        'buddy_assignment_allowed', t.buddy_assignment_allowed,
        'is_active', coalesce(t.is_active,false),
        'assignment_status', t.assignment_status,
        'schedule_status', case
          when t.assignment_status = 'assigning_left' then 'assigning_left'
          when t.schedule_kind <> 'as_required' and t.starts_on is null then 'needs_start_date'
          when coalesce(t.is_active,false) then 'ready'
          else 'paused' end,
        'source', case when i.task_template_id is not null then 'bulk_import' else 'web_app' end,
        'checklist_count', case when jsonb_typeof(t.checklist_items) = 'array'
          then jsonb_array_length(t.checklist_items) else 0 end,
        'created_at', t.created_at,
        'updated_at', t.updated_at
      ) as entry
    from public.task_templates t
    left join public.user_profiles u on u.id = t.default_assignee_user_id
    left join public.departments d on d.id = t.department_id
    left join public.branches b on b.id = t.branch_id
    left join imported i on i.task_template_id = t.id
    where t.tenant_id = v_actor.tenant_id
      and t.task_type in ('checklist','delegation')
      and (v_search = '' or lower(
            coalesce(t.title,'') || ' ' || coalesce(t.description,'') || ' ' ||
            coalesce(u.employee_name,'') || ' ' || coalesce(d.name,'')
          ) like '%' || v_search || '%')
  ) listing;

  return jsonb_build_object('templates', v_rows);
end;
$$;

revoke all on function public.get_task_template_directory(jsonb) from public,anon;
grant execute on function public.get_task_template_directory(jsonb) to authenticated;

notify pgrst, 'reload schema';
