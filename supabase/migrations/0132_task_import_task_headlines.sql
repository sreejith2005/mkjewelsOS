-- Use the spreadsheet TASK value as the imported checklist headline while
-- preserving legacy business fingerprints and repairing safe existing rows.
set search_path = public, extensions;

create function public.task_import_legacy_checklist_row(p_row jsonb)
returns jsonb language sql immutable set search_path=public as $$
  select case
    when p_row->>'task_type'='checklist' and nullif(btrim(p_row->>'core_task_label'),'') is not null
      then jsonb_set(p_row,'{title}',to_jsonb(btrim(p_row->>'core_task_label')),true)
    else p_row
  end
$$;

create function public.task_import_repair_checklist_headline(
  p_registry_id uuid,
  p_headline text,
  p_actor_user_id uuid
)
returns integer language plpgsql security definer set search_path=public as $$
declare
  v_registry public.task_import_row_registry;
  v_actor public.user_profiles;
  v_task public.task_instances;
  v_template public.task_templates;
  v_instance public.task_instances;
  v_headline text:=btrim(coalesce(p_headline,''));
  v_updated integer:=0;
begin
  if length(v_headline) not between 1 and 500 then return 0; end if;
  select * into v_actor from public.user_profiles where id=p_actor_user_id;
  select * into v_registry from public.task_import_row_registry where id=p_registry_id;
  if v_actor.id is null or v_registry.id is null or v_actor.tenant_id<>v_registry.tenant_id then
    raise exception 'Task import headline repair denied' using errcode='42501';
  end if;

  if v_registry.task_instance_id is not null then
    select * into v_task from public.task_instances
    where id=v_registry.task_instance_id and tenant_id=v_registry.tenant_id
      and source='bulk_import' and task_type='checklist'
      and title=core_task_label and title<>v_headline
    for update;
    if v_task.id is not null then
      update public.task_instances set title=v_headline,updated_by=v_actor.id,updated_at=now() where id=v_task.id;
      insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_registry.tenant_id,v_actor.id,'task_bulk_import_headline_corrected','tasks',v_task.id,
        jsonb_build_object('title',v_task.title),jsonb_build_object('title',v_headline,'core_task_label',v_task.core_task_label));
      v_updated:=v_updated+1;
    end if;
  end if;

  if v_registry.task_template_id is not null then
    select * into v_template from public.task_templates
    where id=v_registry.task_template_id and tenant_id=v_registry.tenant_id
      and task_type='checklist' and title=core_task_label and title<>v_headline
    for update;
    if v_template.id is not null then
      update public.task_templates set title=v_headline,updated_by=v_actor.id,updated_at=now() where id=v_template.id;
      insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_registry.tenant_id,v_actor.id,'task_bulk_import_headline_corrected','task_templates',v_template.id,
        jsonb_build_object('title',v_template.title),jsonb_build_object('title',v_headline,'core_task_label',v_template.core_task_label));
      v_updated:=v_updated+1;
    end if;

    for v_instance in select * from public.task_instances
      where tenant_id=v_registry.tenant_id and task_template_id=v_registry.task_template_id
        and task_type='checklist'
        and title=core_task_label and title<>v_headline
      for update
    loop
      update public.task_instances set title=v_headline,updated_by=v_actor.id,updated_at=now() where id=v_instance.id;
      insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_registry.tenant_id,v_actor.id,'task_bulk_import_headline_corrected','tasks',v_instance.id,
        jsonb_build_object('title',v_instance.title),jsonb_build_object('title',v_headline,'core_task_label',v_instance.core_task_label,'task_template_id',v_registry.task_template_id));
      v_updated:=v_updated+1;
    end loop;
  end if;
  return v_updated;
end;
$$;

-- Existing import rows store one CSV TASK value as their sole checklist item.
-- Only registry-linked rows still titled exactly like CORE TASK are eligible.
do $$
declare v_row record;
begin
  for v_row in
    select registry.id,
      coalesce(instance.created_by,instance.updated_by) actor_id,
      (select max(item.item_text) from public.task_checklists item where item.task_instance_id=instance.id) headline
    from public.task_import_row_registry registry
    join public.task_instances instance on instance.id=registry.task_instance_id
    where instance.source='bulk_import' and instance.task_type='checklist'
      and instance.title=instance.core_task_label
      and (select count(*) from public.task_checklists item where item.task_instance_id=instance.id)=1
  loop
    perform public.task_import_repair_checklist_headline(v_row.id,v_row.headline,v_row.actor_id);
  end loop;

  for v_row in
    select registry.id,
      coalesce(template.created_by,template.updated_by) actor_id,
      template.checklist_items->0->>'item_text' headline
    from public.task_import_row_registry registry
    join public.task_templates template on template.id=registry.task_template_id
    where template.task_type='checklist' and template.title=template.core_task_label
      and jsonb_typeof(template.checklist_items)='array' and jsonb_array_length(template.checklist_items)=1
  loop
    perform public.task_import_repair_checklist_headline(v_row.id,v_row.headline,v_row.actor_id);
  end loop;
end;
$$;

alter function public.commit_task_bulk_import_chunk(uuid,jsonb) rename to commit_task_bulk_import_chunk_v0130;
revoke all on function public.commit_task_bulk_import_chunk_v0130(uuid,jsonb) from public,anon,authenticated,service_role;

create function public.commit_task_bulk_import_chunk(p_batch_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.user_profiles:=public.task_import_actor();
  v_row jsonb; v_legacy_rows jsonb:='[]'::jsonb;
  v_registry_id uuid; v_result jsonb; v_corrected integer:=0;
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Import chunks must contain 1 to 100 rows' using errcode='22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_legacy_rows:=v_legacy_rows||jsonb_build_array(public.task_import_legacy_checklist_row(v_row));
  end loop;
  v_result:=public.commit_task_bulk_import_chunk_v0130(p_batch_id,v_legacy_rows);

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if v_row->>'task_type'<>'checklist' then continue; end if;
    select registry.id into v_registry_id
    from public.task_import_items item
    join public.task_import_row_registry registry
      on registry.tenant_id=item.tenant_id
      and (registry.task_instance_id=item.task_instance_id or registry.task_template_id=item.task_template_id)
    where item.batch_id=p_batch_id and item.source_row=(v_row->>'source_row')::integer
      and item.outcome in ('created','replayed');
    if v_registry_id is not null then
      v_corrected:=v_corrected+public.task_import_repair_checklist_headline(v_registry_id,v_row->>'title',v_actor.id);
    end if;
    v_registry_id:=null;
  end loop;
  return v_result||jsonb_build_object('headline_corrected_count',v_corrected);
end;
$$;

create or replace function public.reconcile_task_import_assignments(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.user_profiles:=public.task_import_actor(); v_row jsonb; v_assignee uuid; v_fingerprint text;
  v_registry public.task_import_row_registry; v_updated integer:=0;
begin
  if v_actor.user_role not in ('super_admin','admin') then raise exception 'Task import reconciliation denied' using errcode='42501'; end if;
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Reconciliation chunks must contain 1 to 100 rows' using errcode='22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_assignee:=public.task_import_resolve_assignee(v_row);
    if v_assignee is null then continue; end if;
    v_fingerprint:=public.task_import_business_fingerprint(public.task_import_fingerprint_row(public.task_import_legacy_checklist_row(v_row)));
    select * into v_registry from public.task_import_row_registry
    where tenant_id=v_actor.tenant_id and business_fingerprint=v_fingerprint;
    if v_registry.task_instance_id is not null and exists(
      select 1 from public.task_instances where id=v_registry.task_instance_id and tenant_id=v_actor.tenant_id and assignment_status='assigning_left'
    ) then
      perform public.assign_imported_task_with_audit('task',v_registry.task_instance_id,v_assignee); v_updated:=v_updated+1;
    elsif v_registry.task_template_id is not null and exists(
      select 1 from public.task_templates where id=v_registry.task_template_id and tenant_id=v_actor.tenant_id and assignment_status='assigning_left'
    ) then
      perform public.assign_imported_task_with_audit('template',v_registry.task_template_id,v_assignee); v_updated:=v_updated+1;
    end if;
    v_registry:=null;
  end loop;
  return jsonb_build_object('updated_count',v_updated);
end;
$$;

revoke all on function public.task_import_legacy_checklist_row(jsonb),public.task_import_repair_checklist_headline(uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.commit_task_bulk_import_chunk(uuid,jsonb),public.reconcile_task_import_assignments(jsonb) from public,anon,service_role;
grant execute on function public.commit_task_bulk_import_chunk(uuid,jsonb),public.reconcile_task_import_assignments(jsonb) to authenticated;

notify pgrst,'reload schema';
