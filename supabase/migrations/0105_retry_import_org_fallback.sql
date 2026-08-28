-- Retry failed bulk-import rows and derive task scope without manual mapping screens.
set search_path = public, extensions;

alter function public.commit_task_bulk_import_chunk(uuid,jsonb) rename to commit_task_bulk_import_chunk_v0104;
revoke all on function public.commit_task_bulk_import_chunk_v0104(uuid,jsonb) from public,anon,authenticated,service_role;

do $$
declare v_definition text; v_updated text;
begin
  v_definition:=pg_get_functiondef('public.commit_task_bulk_import_chunk_v0104(uuid,jsonb)'::regprocedure);
  if position('d.branch_id=v_branch' in v_definition)=0 or position('v_category is null' in v_definition)=0 or position('or length(btrim(v_row->>''title''))>200' in v_definition)=0 then
    raise exception 'Expected 0104 task import definition was not found';
  end if;
  v_updated:=replace(v_definition,'d.branch_id=v_branch','(d.branch_id is null or d.branch_id=v_branch)');
  v_updated:=replace(v_updated,'v_branch is null or v_department is null or v_category is null','v_branch is null or v_department is null');
  v_updated:=replace(v_updated,'length(btrim(v_row->>''title''))>200','length(btrim(v_row->>''title''))>500');
  execute v_updated;
end;
$$;

create function public.commit_task_bulk_import_chunk(p_batch_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_actor public.user_profiles:=public.task_import_actor();
  v_batch public.task_import_batches;
  v_row jsonb; v_normalized jsonb:='[]'::jsonb; v_result jsonb;
  v_assignee uuid; v_identity_count integer; v_branch uuid; v_department uuid;
  v_branch_name text; v_department_name text; v_total integer; v_created integer; v_rejected integer; v_replayed integer;
  v_assigning_left integer;
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then
    raise exception 'Import chunks must contain 1 to 100 rows' using errcode='22023';
  end if;
  select * into v_batch from public.task_import_batches where id=p_batch_id for update;
  if v_batch.id is null or v_batch.tenant_id<>v_actor.tenant_id or v_batch.created_by<>v_actor.id or v_batch.outcome not in ('in_progress','partial') then
    raise exception 'Import batch is unavailable' using errcode='42501';
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_assignee:=null; v_branch:=null; v_department:=null; v_branch_name:=null; v_department_name:=null;
    if nullif(btrim(v_row->>'assignee_email'),'') is not null then
      select count(*),min(u.id::text)::uuid into v_identity_count,v_assignee
      from public.user_profiles u
      where u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
        and (v_actor.user_role<>'manager' or u.branch_id=v_actor.branch_id)
        and lower(u.email)=lower(btrim(v_row->>'assignee_email'));
      if v_identity_count<>1 then v_assignee:=null; end if;
    elsif nullif(btrim(v_row->>'assignee_name'),'') is not null then
      select count(*),min(u.id::text)::uuid into v_identity_count,v_assignee
      from public.user_profiles u
      where u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
        and (v_actor.user_role<>'manager' or u.branch_id=v_actor.branch_id)
        and lower(regexp_replace(btrim(u.employee_name),'\s+',' ','g'))=lower(regexp_replace(btrim(v_row->>'assignee_name'),'\s+',' ','g'));
      if v_identity_count<>1 then v_assignee:=null; end if;
    end if;

    if v_assignee is not null then
      select u.branch_id,u.department_id,b.name,d.name into v_branch,v_department,v_branch_name,v_department_name
      from public.user_profiles u
      join public.branches b on b.id=u.branch_id and b.tenant_id=u.tenant_id and b.is_active
      join public.departments d on d.id=u.department_id and d.tenant_id=u.tenant_id and (d.branch_id is null or d.branch_id=b.id) and d.is_active
      where u.id=v_assignee;
    end if;
    if v_branch is null then
      select b.id,b.name into v_branch,v_branch_name from public.branches b
      where b.tenant_id=v_actor.tenant_id and b.is_active
        and (lower(b.name)=lower(btrim(v_row->>'branch')) or lower(b.code)=lower(btrim(v_row->>'branch')))
        and (v_actor.user_role<>'manager' or b.id=v_actor.branch_id)
      order by b.name,b.id limit 1;
    end if;
    if v_branch is null then
      select b.id,b.name into v_branch,v_branch_name from public.branches b
      where b.tenant_id=v_actor.tenant_id and b.is_active and (v_actor.user_role<>'manager' or b.id=v_actor.branch_id)
      order by case when b.id=v_actor.branch_id then 0 else 1 end,b.name,b.id limit 1;
    end if;
    if v_department is null then
      select d.id,d.name into v_department,v_department_name from public.departments d
      where d.tenant_id=v_actor.tenant_id and (d.branch_id is null or d.branch_id=v_branch) and d.is_active and lower(d.name)=lower(btrim(v_row->>'department'))
      order by d.name,d.id limit 1;
    end if;
    if v_department is null then
      select d.id,d.name into v_department,v_department_name from public.departments d
      where d.tenant_id=v_actor.tenant_id and (d.branch_id is null or d.branch_id=v_branch) and d.is_active
      order by case when d.id=v_actor.department_id then 0 else 1 end,d.name,d.id limit 1;
    end if;
    if v_branch is null or v_department is null then
      raise exception 'No active tenant scope is available for task import' using errcode='23503';
    end if;
    v_normalized:=v_normalized||jsonb_build_array(v_row||jsonb_build_object('branch',v_branch_name,'department',v_department_name));
  end loop;

  delete from public.task_import_items item
  where item.batch_id=p_batch_id and item.outcome='rejected'
    and item.source_row in (select (value->>'source_row')::integer from jsonb_array_elements(v_normalized));

  v_result:=public.commit_task_bulk_import_chunk_v0104(p_batch_id,v_normalized);
  select count(*),count(*) filter(where outcome='created'),count(*) filter(where outcome='rejected'),count(*) filter(where outcome='replayed')
  into v_total,v_created,v_rejected,v_replayed from public.task_import_items where batch_id=p_batch_id;
  select count(*) into v_assigning_left
  from public.task_import_items item
  left join public.task_templates template on template.id=item.task_template_id
  left join public.task_instances instance on instance.id=item.task_instance_id
  where item.batch_id=p_batch_id and item.outcome='created'
    and coalesce(template.assignment_status,instance.assignment_status)='assigning_left';
  update public.task_import_batches set
    created_count=v_created,rejected_count=v_rejected,replayed_count=v_replayed,valid_count=v_created,error_count=v_rejected,
    one_time_count=(select count(*) from public.task_import_items where batch_id=p_batch_id and destination='tasks'),
    recurring_count=(select count(*) from public.task_import_items where batch_id=p_batch_id and destination='recurring_todo'),
    initial_instance_count=(select count(*) from public.task_import_items where batch_id=p_batch_id and destination='recurring_todo' and outcome='created' and task_instance_id is not null),
    outcome=case when v_total>=requested_count then case when v_rejected>0 then 'partial' else 'completed' end else 'in_progress' end,
    completed_at=case when v_total>=requested_count and v_rejected=0 then now() else null end
  where id=p_batch_id returning * into v_batch;
  return v_result||jsonb_build_object('created_count',v_created,'rejected_count',v_rejected,'replayed_count',v_replayed,'assigning_left_count',v_assigning_left,'outcome',v_batch.outcome);
end;
$$;

alter function public.assign_imported_task_with_audit(text,uuid,uuid) rename to assign_imported_task_with_audit_v0104;
revoke all on function public.assign_imported_task_with_audit_v0104(text,uuid,uuid) from public,anon,authenticated,service_role;

create function public.assign_imported_task_with_audit(p_record_kind text,p_record_id uuid,p_user_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_actor public.user_profiles; v_target public.user_profiles; v_initial uuid;
begin
  v_result:=public.assign_imported_task_with_audit_v0104(p_record_kind,p_record_id,p_user_profile_id);
  select * into v_actor from public.current_profile();
  select * into v_target from public.user_profiles where id=p_user_profile_id and tenant_id=v_actor.tenant_id;
  v_initial:=nullif(v_result->>'initial_instance_id','')::uuid;
  if p_record_kind='task' then
    update public.task_instances set branch_id=v_target.branch_id,department_id=v_target.department_id,updated_by=v_actor.id,updated_at=now()
    where id=p_record_id and tenant_id=v_actor.tenant_id;
  else
    update public.task_templates set branch_id=v_target.branch_id,department_id=v_target.department_id,updated_by=v_actor.id,updated_at=now()
    where id=p_record_id and tenant_id=v_actor.tenant_id;
    if v_initial is not null then
      update public.task_instances set branch_id=v_target.branch_id,department_id=v_target.department_id,updated_by=v_actor.id,updated_at=now()
      where id=v_initial and tenant_id=v_actor.tenant_id;
    end if;
  end if;
  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'assigning_left_scope_derived',case when p_record_kind='task' then 'tasks' else 'task_templates' end,p_record_id,jsonb_build_object('assignee_user_profile_id',p_user_profile_id,'branch_id',v_target.branch_id,'department_id',v_target.department_id));
  return v_result;
end;
$$;

revoke all on function public.commit_task_bulk_import_chunk(uuid,jsonb),public.assign_imported_task_with_audit(text,uuid,uuid) from public,anon,service_role;
grant execute on function public.commit_task_bulk_import_chunk(uuid,jsonb),public.assign_imported_task_with_audit(text,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
