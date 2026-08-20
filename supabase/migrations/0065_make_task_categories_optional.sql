-- Keep historical category values, but stop requiring categories for new tasks.
do $$
declare v_definition text;
begin
  foreach v_definition in array array[
    pg_get_functiondef('public.create_delegation_task_with_audit(jsonb,uuid[],uuid[],jsonb)'::regprocedure),
    pg_get_functiondef('public.save_task_template_with_audit(uuid,jsonb)'::regprocedure),
    pg_get_functiondef('public.use_task_template_with_audit(uuid,timestamptz)'::regprocedure),
    pg_get_functiondef('public.create_recurring_task_instance(uuid,date,jsonb)'::regprocedure)
  ] loop
    v_definition := replace(v_definition, 'if v_category is null or not exists (', 'if v_category is not null and not exists (');
    v_definition := replace(v_definition, 'if v_template.category_id is null or not exists (', 'if v_template.category_id is not null and not exists (');
    v_definition := replace(v_definition, 'or v_template.category_id is null then', 'then');
    execute v_definition;
  end loop;
end $$;

do $import$
declare v_definition text;
begin
  select pg_get_functiondef('public.import_delegation_tasks_with_audit(jsonb,text)'::regprocedure) into v_definition;
  v_definition := replace(v_definition, $old$array['title','doer_name','doer_email','description','due_at','priority','category','branch','department','checklist','frequency','source_rows']$old$, $new$array['title','doer_name','doer_email','description','due_at','priority','branch','department','checklist','frequency','source_rows']$new$);
  v_definition := replace(v_definition, $old$    select id into v_category_id from dropdown_masters
    where tenant_id = v_actor.tenant_id and master_type = 'task_category' and is_active
      and (nullif(btrim(v_row ->> 'category'), '') is null or lower(btrim(label)) = lower(btrim(v_row ->> 'category')) or lower(btrim(value)) = lower(btrim(v_row ->> 'category')))
    order by sort_order, label limit 1;
    if v_category_id is null then
      raise exception 'Task import category is invalid or unavailable' using errcode = '23503';
    end if;
$old$, $new$$new$);
  v_definition := replace(v_definition, $old$      'department_id', v_department_id,
      'category_id', v_category_id,
$old$, $new$      'department_id', v_department_id,
$new$);
  execute v_definition;
end $import$;

notify pgrst, 'reload schema';
