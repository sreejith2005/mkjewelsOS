-- Production can retain an older function body even when migration history is
-- marked complete. Reconcile the audited task-creation RPC with the current
-- composer contract without changing existing task data.
do $reconcile$
declare v_definition text;
begin
  select pg_get_functiondef('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)'::regprocedure)
    into v_definition;

  if position('requires_form' in v_definition) = 0 then
    v_definition := replace(v_definition,
      $old$       'department_id','category_id','requires_upload','requires_remark'$old$,
      $new$       'department_id','category_id','requires_upload','requires_remark',
       'requires_form','form_template_id'$new$);
    v_definition := replace(v_definition,
      '  v_checklist jsonb;',
      E'  v_checklist jsonb;\n  v_form uuid;\n  v_requires_form boolean;');
    v_definition := replace(v_definition,
      $old$  v_category := nullif(p_payload->>'category_id', '')::uuid;
  v_planned_datetime := (p_payload->>'planned_datetime')::timestamptz;$old$,
      $new$  v_category := nullif(p_payload->>'category_id', '')::uuid;
  v_form := nullif(p_payload->>'form_template_id', '')::uuid;
  v_requires_form := coalesce((p_payload->>'requires_form')::boolean, false);
  v_planned_datetime := (p_payload->>'planned_datetime')::timestamptz;$new$);
    v_definition := replace(v_definition,
      '  insert into task_instances (',
      $new$  if v_requires_form <> (v_form is not null)
     or (v_form is not null and not exists (
       select 1 from form_templates
       where id = v_form and tenant_id = v_actor.tenant_id and is_active
     )) then
    raise exception 'Required form is invalid, inactive, or inconsistent' using errcode = '23503';
  end if;

  insert into task_instances ($new$);
    v_definition := replace(v_definition,
      $old$    description, priority, planned_datetime, requires_upload,
    requires_remark, source, created_by, updated_by$old$,
      $new$    description, priority, planned_datetime, requires_upload,
    requires_remark, requires_form, form_template_id, source, created_by, updated_by$new$);
    v_definition := replace(v_definition,
      $old$    coalesce((p_payload->>'requires_upload')::boolean, false),
    coalesce((p_payload->>'requires_remark')::boolean, false),
    'manual', v_actor.id, v_actor.id$old$,
      $new$    coalesce((p_payload->>'requires_upload')::boolean, false),
    coalesce((p_payload->>'requires_remark')::boolean, false),
    v_requires_form, v_form,
    'manual', v_actor.id, v_actor.id$new$);
    execute v_definition;
  end if;
end $reconcile$;

revoke all on function create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb) from public;
grant execute on function create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb) to authenticated;

notify pgrst, 'reload schema';
