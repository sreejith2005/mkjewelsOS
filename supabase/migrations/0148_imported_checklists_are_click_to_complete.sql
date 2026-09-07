-- Imported checklists are click-to-complete, even when a legacy spreadsheet
-- row also says that evidence is required. Preserve that raw source value for
-- stable import fingerprints, but never persist it as a checklist requirement.
set search_path=public,extensions;

create function public.task_import_repair_checklist_evidence(
  p_registry_id uuid,
  p_actor_user_id uuid
)
returns integer language plpgsql security definer set search_path=public as $$
declare
  v_registry public.task_import_row_registry;
  v_actor public.user_profiles;
  v_task public.task_instances;
  v_template public.task_templates;
  v_instance public.task_instances;
  v_updated integer:=0;
begin
  select * into v_actor from public.user_profiles where id=p_actor_user_id;
  select * into v_registry from public.task_import_row_registry where id=p_registry_id;
  if v_actor.id is null or v_registry.id is null or v_actor.tenant_id<>v_registry.tenant_id then
    raise exception 'Task import checklist evidence repair denied' using errcode='42501';
  end if;

  if v_registry.task_instance_id is not null then
    select * into v_task from public.task_instances
    where id=v_registry.task_instance_id and tenant_id=v_registry.tenant_id
      and source='bulk_import' and task_type='checklist' and requires_upload
    for update;
    if v_task.id is not null then
      update public.task_instances
      set requires_upload=false,updated_by=v_actor.id,updated_at=now()
      where id=v_task.id;
      insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_registry.tenant_id,v_actor.id,'task_bulk_import_checklist_evidence_corrected','tasks',v_task.id,
        jsonb_build_object('task_type',v_task.task_type,'requires_upload',true),
        jsonb_build_object('task_type',v_task.task_type,'requires_upload',false));
      v_updated:=v_updated+1;
    end if;
  end if;

  if v_registry.task_template_id is not null then
    select * into v_template from public.task_templates
    where id=v_registry.task_template_id and tenant_id=v_registry.tenant_id
      and task_type='checklist' and requires_upload
    for update;
    if v_template.id is not null then
      update public.task_templates
      set requires_upload=false,updated_by=v_actor.id,updated_at=now()
      where id=v_template.id;
      insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_registry.tenant_id,v_actor.id,'task_bulk_import_checklist_evidence_corrected','task_templates',v_template.id,
        jsonb_build_object('task_type',v_template.task_type,'requires_upload',true),
        jsonb_build_object('task_type',v_template.task_type,'requires_upload',false));
      v_updated:=v_updated+1;
    end if;

    for v_instance in
      select * from public.task_instances
      where tenant_id=v_registry.tenant_id and task_template_id=v_registry.task_template_id
        and task_type='checklist' and requires_upload
      for update
    loop
      update public.task_instances
      set requires_upload=false,updated_by=v_actor.id,updated_at=now()
      where id=v_instance.id;
      insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_registry.tenant_id,v_actor.id,'task_bulk_import_checklist_evidence_corrected','tasks',v_instance.id,
        jsonb_build_object('task_type',v_instance.task_type,'requires_upload',true,'task_template_id',v_registry.task_template_id),
        jsonb_build_object('task_type',v_instance.task_type,'requires_upload',false,'task_template_id',v_registry.task_template_id));
      v_updated:=v_updated+1;
    end loop;
  end if;

  return v_updated;
end;
$$;

-- Repair only records connected to the audited import registry. Manually
-- authored historical records are deliberately outside this correction.
do $$
declare v_row record;
begin
  for v_row in
    select registry.id,coalesce(instance.created_by,instance.updated_by) actor_id
    from public.task_import_row_registry registry
    join public.task_instances instance on instance.id=registry.task_instance_id
    where instance.source='bulk_import' and instance.task_type='checklist' and instance.requires_upload
    union
    select registry.id,coalesce(template.created_by,template.updated_by) actor_id
    from public.task_import_row_registry registry
    join public.task_templates template on template.id=registry.task_template_id
    where template.task_type='checklist' and (
      template.requires_upload or exists(
        select 1 from public.task_instances instance
        where instance.task_template_id=template.id and instance.task_type='checklist' and instance.requires_upload
      )
    )
  loop
    perform public.task_import_repair_checklist_evidence(v_row.id,v_row.actor_id);
  end loop;
end;
$$;

alter function public.commit_task_bulk_import_chunk(uuid,jsonb) rename to commit_task_bulk_import_chunk_v0132;
revoke all on function public.commit_task_bulk_import_chunk_v0132(uuid,jsonb) from public,anon,authenticated,service_role;

create function public.commit_task_bulk_import_chunk(p_batch_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.user_profiles:=public.task_import_actor();
  v_row jsonb;
  v_registry_id uuid;
  v_result jsonb;
  v_corrected integer:=0;
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Import chunks must contain 1 to 100 rows' using errcode='22023';
  end if;

  -- The previous wrapper preserves legacy headline/fingerprint compatibility.
  -- Pass the raw row through unchanged, then normalize only persisted records.
  v_result:=public.commit_task_bulk_import_chunk_v0132(p_batch_id,p_rows);

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if v_row->>'task_type'<>'checklist' then continue; end if;
    v_registry_id:=null;
    select registry.id into v_registry_id
    from public.task_import_items item
    join public.task_import_row_registry registry
      on registry.tenant_id=item.tenant_id
      and (registry.task_instance_id=item.task_instance_id or registry.task_template_id=item.task_template_id)
    where item.batch_id=p_batch_id and item.source_row=(v_row->>'source_row')::integer
      and item.outcome in ('created','replayed')
    order by registry.id
    limit 1;
    if v_registry_id is not null then
      v_corrected:=v_corrected+public.task_import_repair_checklist_evidence(v_registry_id,v_actor.id);
    end if;
  end loop;

  return v_result||jsonb_build_object('checklist_evidence_corrected_count',v_corrected);
end;
$$;

revoke all on function public.task_import_repair_checklist_evidence(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.commit_task_bulk_import_chunk(uuid,jsonb) from public,anon,service_role;
grant execute on function public.commit_task_bulk_import_chunk(uuid,jsonb) to authenticated;

notify pgrst,'reload schema';
