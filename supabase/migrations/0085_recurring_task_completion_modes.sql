-- Recurring Task / Checklist completion modes.
alter table public.task_templates add column if not exists buddy_assignment_allowed boolean not null default true;
alter table public.task_instances add column if not exists buddy_assignment_allowed boolean not null default true;

create or replace function public.save_recurring_todo_template_with_audit(p_template_id uuid,p_payload jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_actor user_profiles; v_old task_templates; v_new task_templates;
  v_base jsonb; v_kind text; v_starts_on date; v_task_type task_type;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then
    raise exception 'Recurring schedule management denied' using errcode='42501';
  end if;
  if jsonb_typeof(p_payload)<>'object' then raise exception 'Recurring schedule payload is invalid' using errcode='22023'; end if;
  v_task_type:=coalesce(nullif(p_payload->>'task_type','')::task_type,'checklist');
  if v_task_type not in ('checklist','delegation') then raise exception 'Recurring task type is unsupported' using errcode='22023'; end if;
  v_kind:=coalesce(nullif(p_payload->>'schedule_kind',''),'recurring');
  if v_kind not in ('recurring','daily','weekly','monthly','nth_weekday','quarterly','yearly','one_time','as_required') then raise exception 'Schedule kind is unsupported' using errcode='22023'; end if;
  v_starts_on:=coalesce(nullif(p_payload->>'starts_on','')::date,case when p_template_id is null then (now() at time zone 'Asia/Kolkata')::date else null end);
  if p_template_id is not null then
    select * into v_old from task_templates where id=p_template_id for update;
    if v_old.id is null or v_old.tenant_id<>v_actor.tenant_id or (v_actor.user_role='manager' and v_old.branch_id is distinct from v_actor.branch_id) then raise exception 'Recurring schedule not found' using errcode='42501'; end if;
    update task_templates set task_type='checklist' where id=p_template_id;
  end if;
  v_base:=p_payload-array['schedule_kind','starts_on','verification_required','followup_enabled','personal_performance_enabled','task_type','buddy_assignment_allowed'];
  v_base:=v_base||jsonb_build_object('requires_upload',v_task_type='delegation','checklist_items',case when v_task_type='delegation' then '[]'::jsonb else coalesce(p_payload->'checklist_items','[]'::jsonb) end);
  if v_kind='as_required' then
    v_base:=v_base||jsonb_build_object('is_active',false);
  elsif p_template_id is null then
    v_base:=v_base||jsonb_build_object('initial_planned_datetime',(v_starts_on::text||' '||coalesce(nullif(p_payload->>'planned_time',''),'09:00')||' Asia/Kolkata')::timestamptz);
  end if;
  v_id:=save_task_template_with_audit(p_template_id,v_base);
  update task_templates set task_type=v_task_type, buddy_assignment_allowed=coalesce((p_payload->>'buddy_assignment_allowed')::boolean,true),
    requires_upload=(v_task_type='delegation'), checklist_items=case when v_task_type='delegation' then '[]'::jsonb else checklist_items end,
    schedule_kind=v_kind,starts_on=coalesce(v_starts_on,starts_on),verification_required=coalesce((p_payload->>'verification_required')::boolean,false),
    followup_enabled=coalesce((p_payload->>'followup_enabled')::boolean,false),personal_performance_enabled=coalesce((p_payload->>'personal_performance_enabled')::boolean,true),
    updated_by=v_actor.id,updated_at=now() where id=v_id returning * into v_new;
  update task_instances set task_type=v_task_type,requires_upload=(v_task_type='delegation'),buddy_assignment_allowed=v_new.buddy_assignment_allowed,
    updated_by=v_actor.id,updated_at=now() where task_template_id=v_id and status='pending'
    and (planned_datetime at time zone 'Asia/Kolkata')::date=coalesce(v_starts_on,v_new.starts_on);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values
    (v_actor.tenant_id,v_actor.id,case when p_template_id is null then 'recurring_todo_created' else 'recurring_todo_updated' end,'recurring_todo',v_id,
     case when v_old.id is null then null else to_jsonb(v_old) end,to_jsonb(v_new));
  return v_id;
end;
$$;

create or replace function public.create_recurring_todo_instance(p_template_id uuid,p_target_date date,p_original_assignee_ids uuid[])
returns uuid language plpgsql security definer set search_path=public as $$
declare v_template task_templates; v_task task_instances; v_original_id uuid; v_resolution record; v_item jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' and not exists(select 1 from user_profiles u where u.auth_user_id=auth.uid() and u.account_status='active' and u.is_login_enabled and u.user_role in ('super_admin','admin','manager')) then raise exception 'Recurring task creation denied' using errcode='42501'; end if;
  if p_target_date is null or coalesce(array_length(p_original_assignee_ids,1),0)=0 then raise exception 'Target date and original assignees are required' using errcode='22023'; end if;
  select * into v_template from task_templates where id=p_template_id and (is_active or schedule_kind='as_required') and task_type in ('checklist','delegation') for update;
  if v_template.id is null then raise exception 'Template not found' using errcode='22023'; end if;
  if exists(select 1 from task_instances where task_template_id=p_template_id and scheduled_date=p_target_date) then return null; end if;
  insert into task_instances(tenant_id,branch_id,department_id,category_id,task_template_id,task_type,title,description,priority,status,planned_datetime,scheduled_date,requires_upload,requires_remark,requires_form,form_template_id,source,created_by,buddy_assignment_allowed)
  values(v_template.tenant_id,v_template.branch_id,v_template.department_id,v_template.category_id,v_template.id,v_template.task_type,v_template.title,v_template.description,v_template.priority,'pending',
    (p_target_date::text||' '||coalesce(v_template.planned_time,'23:59'::time)::text||' Asia/Kolkata')::timestamptz,p_target_date,
    v_template.task_type='delegation',v_template.requires_remark,v_template.requires_form,v_template.form_template_id,'checklist',coalesce(v_template.created_by,v_template.updated_by,p_original_assignee_ids[1]),v_template.buddy_assignment_allowed)
  returning * into v_task;
  if v_template.task_type='checklist' then
    for v_item in select value from jsonb_array_elements(v_template.checklist_items) loop insert into task_checklists(task_instance_id,item_text,is_required,sort_order) values(v_task.id,v_item->>'item_text',coalesce((v_item->>'is_required')::boolean,true),coalesce((v_item->>'sort_order')::integer,0)); end loop;
  end if;
  foreach v_original_id in array p_original_assignee_ids loop
    if not exists(select 1 from user_profiles u where u.id=v_original_id and u.tenant_id=v_template.tenant_id) then raise exception 'Original recurring doer is invalid' using errcode='23503'; end if;
    if not v_template.buddy_assignment_allowed then
      insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values(v_task.id,v_original_id,'doer',true,true);
    else
      select * into v_resolution from resolve_task_coverage(v_original_id,p_target_date);
      if v_resolution.effective_assignee_id is null then insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values(v_task.id,v_original_id,'doer',true,false);
      else insert into task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values(v_task.id,v_resolution.effective_assignee_id,'doer',v_resolution.resolution='original',true); end if;
    end if;
  end loop;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_template.tenant_id,null,'recurring_task_generated','tasks',v_task.id,jsonb_build_object('template_id',p_template_id,'scheduled_date',p_target_date));
  return v_task.id;
exception when unique_violation then return null;
end;
$$;

create or replace function public.get_recurring_todo_workspace(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles; v_from date; v_to date; v_search text; v_templates jsonb; v_instances jsonb; v_stats jsonb;
begin
 select * into v_actor from user_profiles where auth_user_id=auth.uid(); if v_actor.id is null or not current_profile_is_active() then raise exception 'Recurring workspace access denied' using errcode='42501'; end if;
 v_from:=coalesce(nullif(p_filter->>'date_from','')::date,(now() at time zone 'Asia/Kolkata')::date-7); v_to:=coalesce(nullif(p_filter->>'date_to','')::date,(now() at time zone 'Asia/Kolkata')::date+30); v_search:=lower(btrim(coalesce(p_filter->>'search','')));
 select coalesce(jsonb_agg(to_jsonb(t) order by t.title),'[]'::jsonb) into v_templates from task_templates t where t.tenant_id=v_actor.tenant_id and t.task_type in ('checklist','delegation') and t.recurrence_rule is not null and (v_actor.user_role in ('super_admin','admin','manager') or t.created_by=v_actor.id or t.default_assignee_user_id=v_actor.id) and (v_search='' or lower(t.title||' '||coalesce(t.description,'')) like '%'||v_search||'%');
 with visible as (select ti.* from task_instances ti where ti.tenant_id=v_actor.tenant_id and ti.task_template_id is not null and (ti.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to and (v_search='' or lower(ti.title||' '||coalesce(ti.description,'')) like '%'||v_search||'%') and can_read_task(ti.id))
 select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('assignees',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.employee_name,'is_original',a.is_original)),'[]'::jsonb) from task_assignees a join user_profiles u on u.id=a.user_profile_id where a.task_instance_id=v.id and a.is_active),'checklist',(select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order),'[]'::jsonb) from task_checklists c where c.task_instance_id=v.id),'has_attachment',exists(select 1 from task_attachments a where a.task_instance_id=v.id),'has_form_submission',exists(select 1 from form_submissions s where s.linked_record_id=v.id and s.form_template_id=v.form_template_id)) order by v.planned_datetime),'[]'::jsonb) into v_instances from visible v;
 select jsonb_build_object('total',count(*),'pending',count(*) filter(where status='pending'),'in_progress',count(*) filter(where status='in_progress'),'completed',count(*) filter(where status='completed'),'overdue',count(*) filter(where status='overdue'),'coverage_required',count(*) filter(where coverage_status='coverage_required'),'manager_review',count(*) filter(where coverage_status='manager_review')) into v_stats from task_instances ti where ti.tenant_id=v_actor.tenant_id and ti.task_template_id is not null and (ti.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to and can_read_task(ti.id);
 return jsonb_build_object('filters',jsonb_build_object('date_from',v_from,'date_to',v_to),'templates',v_templates,'instances',v_instances,'stats',v_stats);
end;
$$;

create or replace function public.complete_recurring_task_with_image_with_audit(p_task_id uuid,p_file_url text)
returns void language plpgsql security definer set search_path=public,storage as $$
declare v_actor public.user_profiles; v_task public.task_instances; v_object storage.objects; v_attachment uuid;
begin
 select * into v_actor from public.user_profiles where auth_user_id=auth.uid();
 select * into v_task from public.task_instances where id=p_task_id for update;
 if v_actor.id is null or not public.current_profile_is_active() or v_task.id is null or v_task.tenant_id<>v_actor.tenant_id or v_task.task_template_id is null or v_task.task_type<>'delegation' or v_task.status='completed' or not exists(select 1 from public.task_assignees where task_instance_id=p_task_id and user_profile_id=v_actor.id and is_active) then raise exception 'Recurring image task completion denied' using errcode='42501'; end if;
 select * into v_object from storage.objects where bucket_id='task-attachments' and name=btrim(p_file_url);
 if v_object.id is null or v_object.name !~ ('^'||v_task.tenant_id::text||'/'||v_task.id::text||'/') or coalesce(v_object.metadata->>'mimetype','') not in ('image/jpeg','image/png','image/webp') or coalesce((v_object.metadata->>'size')::bigint,0)>5242880 then raise exception 'Task completion requires a permitted image upload' using errcode='23514'; end if;
 insert into public.task_attachments(task_instance_id,file_url,uploaded_by) values(p_task_id,v_object.name,v_actor.id) returning id into v_attachment;
 update public.task_instances set status='completed',actual_datetime=now(),updated_by=v_actor.id,updated_at=now() where id=p_task_id;
 update public.task_assignees set completed_at=now() where task_instance_id=p_task_id and is_active;
 insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'recurring_task_image_completed','recurring_todo',p_task_id,jsonb_build_object('attachment_id',v_attachment));
end;
$$;
revoke all on function public.complete_recurring_task_with_image_with_audit(uuid,text) from public,anon;
grant execute on function public.complete_recurring_task_with_image_with_audit(uuid,text) to authenticated;
notify pgrst,'reload schema';
