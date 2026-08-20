-- Saving a new recurring task must also create its first scheduled instance.
-- Future instances remain the responsibility of the existing protected daily
-- recurrence worker; the unique template/date key keeps the two paths idempotent.
do $reconcile$
declare v_definition text;
begin
  select pg_get_functiondef('public.save_task_template_with_audit(uuid,jsonb)'::regprocedure)
    into v_definition;

  if position('initial_planned_datetime' in v_definition) = 0 then
    v_definition := replace(v_definition,
      $old$       'branch_id','department_id','category_id','checklist_items','is_active'$old$,
      $new$       'branch_id','department_id','category_id','checklist_items','is_active',
       'initial_planned_datetime'$new$);
    v_definition := replace(v_definition,
      '  v_requires_form boolean;',
      E'  v_requires_form boolean;\n  v_initial_planned_datetime timestamptz;\n  v_initial_task task_instances;');
    v_definition := replace(v_definition,
      $old$  v_requires_form := coalesce((p_payload->>'requires_form')::boolean, false);$old$,
      $new$  v_requires_form := coalesce((p_payload->>'requires_form')::boolean, false);
  v_initial_planned_datetime := nullif(p_payload->>'initial_planned_datetime', '')::timestamptz;
  if v_initial_planned_datetime is not null and not isfinite(v_initial_planned_datetime) then
    raise exception 'Initial planned datetime must be finite' using errcode = '22023';
  end if;$new$);
    v_definition := replace(v_definition,
      $old$  if p_template_id is null then
    insert into task_templates ($old$,
      $new$  if p_template_id is not null and v_initial_planned_datetime is not null then
    raise exception 'Initial task creation is only allowed for a new recurring schedule' using errcode = '22023';
  end if;

  if p_template_id is null then
    insert into task_templates ($new$);
    v_definition := replace(v_definition,
      $old$    ) returning * into v_new;
    v_id := v_new.id;
  else$old$,
      $new$    ) returning * into v_new;
    v_id := v_new.id;

    if v_initial_planned_datetime is not null then
      if v_assignee_type <> 'specific_user' then
        raise exception 'Initial task creation requires a specific active user' using errcode = '22023';
      end if;

      insert into task_instances(
        tenant_id, branch_id, department_id, category_id, task_template_id,
        task_type, title, description, priority, status, planned_datetime,
        scheduled_date, requires_upload, requires_remark, requires_form,
        form_template_id, source, created_by, updated_by
      ) values (
        v_new.tenant_id, v_new.branch_id, v_new.department_id, v_new.category_id,
        v_new.id, 'checklist', v_new.title, v_new.description, v_new.priority,
        'pending', v_initial_planned_datetime,
        (v_initial_planned_datetime at time zone 'Asia/Kolkata')::date,
        v_new.requires_upload, v_new.requires_remark, v_new.requires_form,
        v_new.form_template_id, 'checklist', v_actor.id, v_actor.id
      ) returning * into v_initial_task;

      insert into task_assignees(
        task_instance_id, user_profile_id, role_at_task, is_original, is_active
      ) values (v_initial_task.id, v_assignee_user, 'doer', true, true);

      insert into task_checklists(task_instance_id, item_text, is_required, sort_order)
      select v_initial_task.id, item->>'item_text', (item->>'is_required')::boolean,
        (item->>'sort_order')::integer
      from jsonb_array_elements(v_checklist) item;

      insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
      values (
        v_actor.tenant_id, v_actor.id, 'recurring_task_initial_instance_created',
        'tasks', v_initial_task.id,
        jsonb_build_object('template_id', v_new.id, 'planned_datetime', v_initial_planned_datetime)
      );
    end if;
  else$new$);
    execute v_definition;
  end if;
end $reconcile$;

revoke all on function save_task_template_with_audit(uuid,jsonb) from public;
grant execute on function save_task_template_with_audit(uuid,jsonb) to authenticated;

notify pgrst, 'reload schema';
