-- Full occurrence editing. Preserve task identity, child progress and old clients.
set search_path=public,extensions;
alter table public.task_checklists add column deleted_at timestamptz;
alter table public.task_instances add column upload_requirement_overridden boolean not null default false;
-- Keep live-row composite casts aligned with the table's appended internal field.
create or replace view public.task_instances_live with (security_invoker=true) as
  select * from public.task_instances where deleted_at is null;
create policy task_checklists_active_read on public.task_checklists
  as restrictive for select to authenticated using (deleted_at is null);

create or replace function public.complete_task_checklist_items(p_task_id uuid,p_actor_id uuid)
returns void language sql security definer set search_path=public as $$
  update task_checklists set is_completed=true,completed_by=p_actor_id,completed_at=now()
  where task_instance_id=p_task_id and deleted_at is null and not is_completed;
$$;

create or replace function public.admin_edit_task_with_audit(p_task_id uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare
  a user_profiles:=current_profile(); old_task task_instances; new_task task_instances; candidate task_instances;
  old_children jsonb; new_children jsonb; prev text; key text; item jsonb; item_id uuid; item_ids uuid[]:='{}'; pos integer:=0;
  doers uuid[]; watchers uuid[]; old_doers uuid[]; old_watchers uuid[]; added_doers uuid[]; added_watchers uuid[];
  verification boolean; scope text; selected_branch uuid; v_user uuid;
begin
  perform assert_module_access('tasks');
  if a.id is null or not current_profile_is_active() or not has_permission('tasks.view_all') then
    raise exception 'Task administration denied' using errcode='42501'; end if;
  select * into old_task from task_instances where id=p_task_id and tenant_id=a.tenant_id and deleted_at is null for update;
  if old_task.id is null then raise exception 'Task administration denied' using errcode='42501'; end if;
  if old_task.task_type='fms' then raise exception 'FMS work must be edited through its workflow' using errcode='22023'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload='{}'::jsonb
    or p_payload-array['title','description','priority','planned_datetime','due_datetime','task_type','requires_upload','requires_remark',
      'requires_form','form_template_id','verification_required','verifier_user_profile_id','buddy_assignment_allowed',
      'branch_id','department_id','category_id','core_task_label','doer_ids','watcher_ids','checklist']<>'{}'::jsonb
    or (p_payload ? 'title' and (jsonb_typeof(p_payload->'title')<>'string' or length(btrim(p_payload->>'title')) not between 1 and 300))
    or (p_payload ? 'description' and jsonb_typeof(p_payload->'description') not in ('string','null'))
    or length(coalesce(p_payload->>'description',''))>10000
    or (p_payload ? 'core_task_label' and (jsonb_typeof(p_payload->'core_task_label') not in ('string','null') or length(coalesce(p_payload->>'core_task_label',''))>300))
    or (p_payload ? 'priority' and (jsonb_typeof(p_payload->'priority')<>'string' or p_payload->>'priority' not in ('low','medium','high')))
    or (p_payload ? 'task_type' and (jsonb_typeof(p_payload->'task_type')<>'string' or p_payload->>'task_type' not in ('delegation','checklist')))
    or (p_payload ? 'planned_datetime' and (jsonb_typeof(p_payload->'planned_datetime')<>'string' or nullif(p_payload->>'planned_datetime','') is null))
    or (p_payload ? 'due_datetime' and (jsonb_typeof(p_payload->'due_datetime')<>'string' or nullif(p_payload->>'due_datetime','') is null)) then
    raise exception 'Invalid task edit' using errcode='22023'; end if;
  foreach key in array array['requires_upload','requires_remark','requires_form','verification_required','buddy_assignment_allowed'] loop
    if p_payload ? key and jsonb_typeof(p_payload->key)<>'boolean' then
      raise exception 'Invalid task edit' using errcode='22023'; end if;
  end loop;
  foreach key in array array['branch_id','department_id','category_id','form_template_id','verifier_user_profile_id'] loop
    if p_payload ? key and jsonb_typeof(p_payload->key) not in ('string','null') then
      raise exception 'Invalid task edit' using errcode='22023'; end if;
  end loop;
  begin
    select * into candidate from jsonb_populate_record(old_task,p_payload-array['verification_required','doer_ids','watcher_ids','checklist']);
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'Invalid task edit' using errcode='22023';
  end;
  candidate.title:=btrim(candidate.title); candidate.description:=nullif(btrim(candidate.description),'');
  candidate.core_task_label:=nullif(btrim(candidate.core_task_label),'');
  if not isfinite(candidate.planned_datetime) or (candidate.due_datetime is not null and not isfinite(candidate.due_datetime)) then
    raise exception 'Invalid task edit' using errcode='22023'; end if;
  if candidate.due_datetime<candidate.planned_datetime then raise exception 'Due time must follow start time' using errcode='22023'; end if;
  scope:=task_assignment_scope();
  if candidate.branch_id is distinct from old_task.branch_id and candidate.branch_id is not null then
    if not exists(select 1 from branches where id=candidate.branch_id and tenant_id=a.tenant_id and is_active)
      or (scope in ('branch','department') and candidate.branch_id is distinct from a.branch_id) then
      raise exception 'Task reference is outside your scope' using errcode='42501'; end if;
  end if;
  if candidate.department_id is not null then
    select branch_id into selected_branch from departments where id=candidate.department_id and tenant_id=a.tenant_id
      and (is_active or candidate.department_id=old_task.department_id);
    if not found or (candidate.department_id is distinct from old_task.department_id and scope='department' and candidate.department_id is distinct from a.department_id) then
      raise exception 'Task reference is outside your scope' using errcode='42501'; end if;
    if selected_branch is not null and selected_branch is distinct from candidate.branch_id then
      raise exception 'Department must belong to the selected branch' using errcode='22023'; end if;
  end if;
  if candidate.category_id is distinct from old_task.category_id and candidate.category_id is not null and not exists(
    select 1 from dropdown_masters where id=candidate.category_id and master_type='task_category' and is_active and (tenant_id=a.tenant_id or tenant_id is null)
  ) then raise exception 'Task reference is outside your scope' using errcode='42501'; end if;
  if candidate.form_template_id is distinct from old_task.form_template_id and candidate.form_template_id is not null and not exists(
    select 1 from form_templates where id=candidate.form_template_id and tenant_id=a.tenant_id and lifecycle='published' and is_active
  ) then raise exception 'Select a published required form' using errcode='22023'; end if;
  if candidate.requires_form and (candidate.form_template_id is null or not exists(
    select 1 from form_templates where id=candidate.form_template_id and tenant_id=a.tenant_id
      and (lifecycle='published' or (id=old_task.form_template_id and lifecycle='archived'))
  )) then raise exception 'Select a published required form' using errcode='22023'; end if;
  verification:=case when p_payload ? 'verification_required' then (p_payload->>'verification_required')::boolean else old_task.verification_status<>'not_required' end;
  if verification and candidate.verifier_user_profile_id is null then raise exception 'Select an active verifier' using errcode='22023'; end if;
  if candidate.verifier_user_profile_id is distinct from old_task.verifier_user_profile_id and candidate.verifier_user_profile_id is not null then
    if not task_assignment_user_in_scope(candidate.verifier_user_profile_id) then
      raise exception 'Task participant is inactive or outside your assignment scope' using errcode='42501'; end if;
  end if;
  select coalesce(array_agg(user_profile_id order by user_profile_id),'{}') into old_doers from task_assignees where task_instance_id=p_task_id and is_active and role_at_task='doer';
  select coalesce(array_agg(user_profile_id order by user_profile_id),'{}') into old_watchers from task_watchers where task_instance_id=p_task_id;
  doers:=old_doers; watchers:=old_watchers;
  foreach key in array array['doer_ids','watcher_ids'] loop
    if p_payload ? key then
      if jsonb_typeof(p_payload->key)<>'array' then raise exception 'Invalid task participants' using errcode='22023'; end if;
      if jsonb_array_length(p_payload->key)>100 or exists(select 1 from jsonb_array_elements(p_payload->key) x where jsonb_typeof(x)<>'string') then
        raise exception 'Invalid task participants' using errcode='22023'; end if;
      begin
        select coalesce(array_agg(value::uuid order by value),'{}') into item_ids from jsonb_array_elements_text(p_payload->key);
      exception when invalid_text_representation then raise exception 'Invalid task participants' using errcode='22023'; end;
      if cardinality(item_ids)<>(select count(distinct id) from unnest(item_ids) id) then raise exception 'Invalid task participants' using errcode='22023'; end if;
      if key='doer_ids' then doers:=item_ids; else watchers:=item_ids; end if;
    end if;
  end loop;
  if doers && watchers and (doers is distinct from old_doers or watchers is distinct from old_watchers) then
    raise exception 'A doer cannot also be In Loop' using errcode='22023'; end if;
  select coalesce(array_agg(id),'{}') into added_doers from unnest(doers) id where not id=any(old_doers);
  select coalesce(array_agg(id),'{}') into added_watchers from unnest(watchers) id where not id=any(old_watchers);
  perform assert_task_assignment_targets(added_doers,added_watchers);
  if p_payload ? 'checklist' then
    if jsonb_typeof(p_payload->'checklist')<>'array' then raise exception 'Invalid checklist edit' using errcode='22023'; end if;
    if jsonb_array_length(p_payload->'checklist')>100 then raise exception 'Invalid checklist edit' using errcode='22023'; end if;
    item_ids:='{}';
    for item in select value from jsonb_array_elements(p_payload->'checklist') loop
      if jsonb_typeof(item)<>'object' or item-array['id','item_text','is_required']<>'{}'::jsonb
        or jsonb_typeof(item->'item_text') is distinct from 'string'
        or length(btrim(item->>'item_text')) not between 1 and 500
        or jsonb_typeof(item->'is_required') is distinct from 'boolean' then
        raise exception 'Invalid checklist edit' using errcode='22023'; end if;
      if item ? 'id' then
        begin item_id:=(item->>'id')::uuid;
        exception when invalid_text_representation then raise exception 'Invalid checklist edit' using errcode='22023'; end;
        if item_id is null or item_id=any(item_ids) or not exists(
          select 1 from task_checklists where id=item_id and task_instance_id=p_task_id and deleted_at is null
        ) then raise exception 'Checklist item is not editable on this task' using errcode='22023'; end if;
        item_ids:=array_append(item_ids,item_id);
      end if;
    end loop;
  end if;
  select jsonb_build_object('assignees',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from task_assignees r where task_instance_id=p_task_id),'[]'),
    'watchers',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from task_watchers r where task_instance_id=p_task_id),'[]'),
    'checklist',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from task_checklists r where task_instance_id=p_task_id),'[]')) into old_children;
  prev:=current_setting('jewelos.admin_task_actor',true);
  perform set_config('jewelos.admin_task_actor',a.id::text,true);
  -- Only authoring fields change; completion timestamps, evidence and verification history survive.
  update task_instances set title=candidate.title,description=candidate.description,priority=candidate.priority,task_type=candidate.task_type,
    planned_datetime=candidate.planned_datetime,due_datetime=candidate.due_datetime,
    revised_datetime=case when p_payload ? 'due_datetime' then null else revised_datetime end,
    requires_upload=candidate.requires_upload,
    upload_requirement_overridden=case when p_payload ? 'requires_upload' then not candidate.requires_upload else upload_requirement_overridden end,
    requires_remark=candidate.requires_remark,requires_form=candidate.requires_form,
    form_template_id=candidate.form_template_id,buddy_assignment_allowed=candidate.buddy_assignment_allowed,
    branch_id=candidate.branch_id,department_id=candidate.department_id,category_id=candidate.category_id,core_task_label=candidate.core_task_label,
    verifier_user_profile_id=candidate.verifier_user_profile_id,
    verification_status=case when not verification then 'not_required'
      when old_task.verification_status='not_required' or candidate.verifier_user_profile_id is distinct from old_task.verifier_user_profile_id then 'pending'
      else verification_status end,
    updated_by=a.id,updated_at=now() where id=p_task_id;
  if p_payload ? 'watcher_ids' then
    delete from task_watchers where task_instance_id=p_task_id and not user_profile_id=any(watchers);
  end if;
  if p_payload ? 'doer_ids' then
    update task_assignees set is_active=false where task_instance_id=p_task_id and role_at_task='doer' and is_active and not user_profile_id=any(doers);
    foreach v_user in array added_doers loop
      insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active,completed_at)
      values(p_task_id,v_user,'doer',true,true,case when old_task.status='completed' then old_task.actual_datetime else null end);
    end loop;
  end if;
  if p_payload ? 'watcher_ids' then
    insert into task_watchers(tenant_id,task_instance_id,user_profile_id,created_by)
      select a.tenant_id,p_task_id,id,a.id from unnest(added_watchers) id on conflict do nothing;
  end if;
  if p_payload ? 'checklist' then
    update task_checklists set deleted_at=now() where task_instance_id=p_task_id and deleted_at is null and not id=any(item_ids);
    for item in select value from jsonb_array_elements(p_payload->'checklist') loop
      if item ? 'id' then
        update task_checklists set item_text=btrim(item->>'item_text'),is_required=(item->>'is_required')::boolean,sort_order=pos
          where id=(item->>'id')::uuid and task_instance_id=p_task_id and deleted_at is null;
      else
        insert into task_checklists(task_instance_id,item_text,is_required,sort_order)
        values(p_task_id,btrim(item->>'item_text'),(item->>'is_required')::boolean,pos);
      end if;
      pos:=pos+1;
    end loop;
  end if;
  -- Removed participants retain their alerts as read history; this is durable assignment state.
  update notifications n set is_read=true,read_at=coalesce(read_at,now())
    where n.tenant_id=a.tenant_id and n.source_record_id=p_task_id and n.source_module='tasks' and not n.is_read
      and (old_task.status='completed' or (
        n.user_profile_id=any(old_doers||old_watchers)
        and not exists(select 1 from task_assignees s where s.task_instance_id=p_task_id and s.user_profile_id=n.user_profile_id and s.is_active and s.role_at_task='doer')
        and not exists(select 1 from task_watchers w where w.task_instance_id=p_task_id and w.user_profile_id=n.user_profile_id)));
  select * into new_task from task_instances where id=p_task_id;
  select jsonb_build_object('assignees',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from task_assignees r where task_instance_id=p_task_id),'[]'),
    'watchers',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from task_watchers r where task_instance_id=p_task_id),'[]'),
    'checklist',coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from task_checklists r where task_instance_id=p_task_id),'[]')) into new_children;
  perform set_config('jewelos.admin_task_actor',coalesce(prev,''),true);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(a.tenant_id,a.id,'task_admin_edited','tasks',p_task_id,to_jsonb(old_task)||old_children,to_jsonb(new_task)||new_children);
end;
$$;
revoke all on function public.admin_edit_task_with_audit(uuid,jsonb) from public,anon,service_role;
grant execute on function public.admin_edit_task_with_audit(uuid,jsonb) to authenticated;

-- Extend the existing watcher exception only for authoring changes made by the audited RPC.
-- Completion, evidence, checklist progress and all normal watcher writes stay protected.
do $upgrade$
declare f text; n text;
begin
  f:=pg_get_functiondef('public.reject_watcher_task_mutation()'::regprocedure);
  n:=replace(f,$old$'deleted_at','updated_by','updated_at'$old$,
    $new$'deleted_at','updated_by','updated_at','task_type','requires_upload','upload_requirement_overridden','requires_remark','requires_form','form_template_id','verifier_user_profile_id','verification_status','buddy_assignment_allowed','branch_id','department_id','category_id','core_task_label','coverage_status','coverage_original_assignee_id','coverage_resolution','coverage_resolved_for_date'$new$);
  n:=replace(n,$old$if v_actor_id is not null$old$,
    $new$if tg_table_name in ('task_assignees','task_watchers','task_checklists')
    and current_setting('jewelos.admin_task_actor',true)=v_actor_id::text
    and public.has_permission('tasks.view_all') then
    return case when tg_op='DELETE' then old else new end;
  end if;
  if v_actor_id is not null$new$);
  if n=f then raise exception 'Task watcher authoring guard upgrade failed'; end if;
  execute n;
  -- A durable override may only be set by an authorized audited edit.
  f:=pg_get_functiondef('public.guard_task_lifecycle_and_import_proof()'::regprocedure);
  n:=replace(f,'begin',$guard$begin
  if ((tg_op='UPDATE' and new.upload_requirement_overridden is distinct from old.upload_requirement_overridden)
    or (tg_op='INSERT' and new.upload_requirement_overridden))
    and not (current_profile_is_active() and has_permission('tasks.view_all')
      and current_setting('jewelos.admin_task_actor',true) is not distinct from (current_profile()).id::text) then
    raise exception 'Task administration denied' using errcode='42501'; end if;$guard$);
  n:=replace(n,$old$if new.status<>'completed' then new.requires_upload:=true; end if;$old$,
    $new$if new.status<>'completed' and not new.upload_requirement_overridden then new.requires_upload:=true; end if;$new$);
  n:=replace(n,$old$if new.status='completed' and$old$,
    $new$if (new.requires_upload or not new.upload_requirement_overridden) and new.status='completed' and$new$);
  if n=f then raise exception 'Imported task requirement upgrade failed'; end if;
  execute n;
end $upgrade$;

-- Prior proof is accepted only if an audited edit records the former task type.
-- The exact task/template/tenant checks remain in the completion functions.
create function public.task_form_submission_module_matches(p_task public.task_instances,p_module text)
returns boolean language sql stable security definer set search_path=public as $$
  select p_module=case p_task.task_type when 'delegation' then 'delegation_task' when 'checklist' then 'checklist_task' else null end
    or (p_task.task_type in ('delegation','checklist') and p_module in ('delegation_task','checklist_task') and exists(
      select 1 from audit_logs where tenant_id=p_task.tenant_id and record_id=p_task.id and action='task_admin_edited'
        and old_value->>'task_type' is distinct from new_value->>'task_type'
        and p_module=case old_value->>'task_type' when 'delegation' then 'delegation_task' when 'checklist' then 'checklist_task' else null end
    ));
$$;
revoke all on function public.task_form_submission_module_matches(public.task_instances,text) from public,anon,authenticated,service_role;

-- Do not rewrite historical submissions.
do $form_proof$
declare signature text; f text; n text;
begin
  foreach signature in array array[
    'public.update_task_with_audit(uuid,text,uuid,boolean,text)',
    'public.complete_uploaded_task_with_audit(uuid,text)'
  ] loop
    f:=pg_get_functiondef(signature::regprocedure);
    n:=replace(f,'fs.linked_module = v_linked_module',
      'public.task_form_submission_module_matches(v_old,fs.linked_module)');
    n:=replace(n,'fs.linked_module=v_linked_module',
      'public.task_form_submission_module_matches(v_old,fs.linked_module)');
    if n=f then raise exception 'Task form proof continuity upgrade failed: %',signature; end if;
    execute n;
  end loop;
end $form_proof$;

-- Definer-owned workspace/report RPCs must filter archived rows explicitly.
do $readers$
declare r record; f text; n text;
begin
  for r in select oid::regprocedure signature from pg_proc where pronamespace='public'::regnamespace
    and proname in ('get_recurring_todo_workspace','get_home_summary','get_dashboard_metrics','report_rows_for_profile') loop
    f:=pg_get_functiondef(r.signature);
    n:=replace(f,'from task_checklists tc','from (select * from public.task_checklists where deleted_at is null) tc');
    n:=replace(n,'from public.task_checklists tc','from (select * from public.task_checklists where deleted_at is null) tc');
    n:=replace(n,'from public.task_checklists c','from (select * from public.task_checklists where deleted_at is null) c');
    if n=f then raise exception 'Archived checklist reader upgrade failed: %',r.signature; end if;
    execute n;
  end loop;
end $readers$;

-- The submission, requirement checks and completion still share one transaction.
-- Older submit_form callers remain compatible unless a newly edited task requires a remark.
create function public.submit_task_form_with_audit(p_task_id uuid,p_form_template_id uuid,p_answers jsonb,p_remark text default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile(); t task_instances; result uuid; prev text;
begin
  perform assert_module_access('tasks');
  select * into t from task_instances where id=p_task_id and tenant_id=a.tenant_id and deleted_at is null for update;
  if a.id is null or not current_profile_is_active() or t.id is null
    or not can_read_task(t.id) or t.task_type not in ('delegation','checklist') then
    raise exception 'Task form submission denied' using errcode='42501'; end if;
  if not t.requires_form or t.form_template_id is distinct from p_form_template_id or t.status in ('completed','blocked') then
    raise exception 'This task does not require this form' using errcode='22023'; end if;
  if length(coalesce(p_remark,''))>2000 then raise exception 'Completion remark is too long' using errcode='22023'; end if;
  prev:=current_setting('jewelos.task_form_completion_remark',true);
  perform set_config('jewelos.task_form_completion_remark',coalesce(p_remark,''),true);
  result:=submit_form_with_audit(p_form_template_id,p_answers,
    case t.task_type when 'delegation' then 'delegation_task' else 'checklist_task' end,p_task_id);
  perform set_config('jewelos.task_form_completion_remark',coalesce(prev,''),true);
  return result;
end;
$$;
revoke all on function public.submit_task_form_with_audit(uuid,uuid,jsonb,text) from public,anon,service_role;
grant execute on function public.submit_task_form_with_audit(uuid,uuid,jsonb,text) to authenticated;

create or replace function public.complete_task_from_required_form_submission()
returns trigger language plpgsql security definer set search_path=public as $$
declare t task_instances; completed task_instances;
begin
  if new.linked_module not in ('checklist_task','delegation_task') then return new; end if;
  select * into t from task_instances where id=new.linked_record_id for update;
  if t.id is null or t.status='completed' or t.coverage_status='coverage_required'
    or not t.requires_form or t.form_template_id is distinct from new.form_template_id then return new; end if;
  perform update_task_with_audit(t.id,'complete',p_remark=>nullif(current_setting('jewelos.task_form_completion_remark',true),''));
  select * into completed from task_instances where id=t.id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(t.tenant_id,new.submitted_by,'task_form_submitted_and_completed','tasks',t.id,to_jsonb(t),
    jsonb_build_object('task',to_jsonb(completed),'form_submission_id',new.id,'form_template_id',new.form_template_id));
  return new;
end;
$$;

-- No upload-only endpoint may bypass a required completion remark.
do $upload_paths$
declare signature text; f text; n text;
begin
  foreach signature in array array['public.complete_uploaded_task_with_audit(uuid,text)','public.complete_recurring_task_with_image_with_audit(uuid,text)'] loop
    f:=pg_get_functiondef(signature::regprocedure);
    n:=replace(f,'v_task.task_type<>''delegation''','v_task.task_type not in (''delegation'',''checklist'')');
    if signature='public.complete_uploaded_task_with_audit(uuid,text)' then
      n:=replace(n,'  v_linked_module:=',$guard$  if v_old.requires_remark or not v_own then
    raise exception 'Upload evidence, then complete with a remark' using errcode='23514'; end if;
  v_linked_module:=$guard$);
    else
      n:=replace(n,'  select * into v_object',$guard$  if v_task.requires_form then
    raise exception 'Complete the required form after uploading evidence' using errcode='23514'; end if;
  if v_task.requires_remark or not v_own then
    raise exception 'Upload evidence, then complete with a remark' using errcode='23514'; end if;
  select * into v_object$guard$);
    end if;
    if n=f then raise exception 'Upload requirement continuity upgrade failed: %',signature; end if;
    execute n;
  end loop;
end $upload_paths$;

-- An archived item cannot be ticked or altered by a completion path or a direct write.
create function public.guard_archived_task_checklist()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.deleted_at is not null then raise exception 'Archived checklist items cannot be changed' using errcode='22023'; end if;
  if new.deleted_at is distinct from old.deleted_at and (
    current_setting('jewelos.admin_task_actor',true) is distinct from (current_profile()).id::text
    or not current_profile_is_active() or not has_permission('tasks.view_all')
  ) then raise exception 'Checklist administration denied' using errcode='42501'; end if;
  return new;
end;
$$;
create trigger archived_task_checklist before update on task_checklists for each row execute function guard_archived_task_checklist();
revoke all on function public.guard_archived_task_checklist() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
