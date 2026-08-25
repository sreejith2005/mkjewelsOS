-- Independent task deadlines, imported source labels, and designated verification.
alter table public.task_templates
  add column if not exists core_task_label text,
  add column if not exists due_time time,
  add column if not exists verifier_user_profile_id uuid references public.user_profiles(id);

alter table public.task_instances
  add column if not exists core_task_label text,
  add column if not exists due_datetime timestamptz,
  add column if not exists verifier_user_profile_id uuid references public.user_profiles(id);

alter table public.task_templates drop constraint if exists task_templates_due_after_start;
alter table public.task_templates add constraint task_templates_due_after_start
  check (due_time is null or planned_time is null or due_time > planned_time);

create index if not exists idx_task_instances_effective_due
  on public.task_instances (tenant_id, (coalesce(revised_datetime,due_datetime,planned_datetime)))
  where status not in ('completed','rejected');

create or replace function public.task_effective_due_datetime(p_task public.task_instances)
returns timestamptz language sql immutable parallel safe set search_path=public as $$
  select coalesce(p_task.revised_datetime,p_task.due_datetime,p_task.planned_datetime)
$$;

create or replace function public.detect_scheduled_notification_events(p_limit integer default 100,p_now timestamptz default now())
returns table(task_overdue_events integer,fms_sla_events integer)
language plpgsql security definer set search_path=public as $$
declare v_task public.task_instances; v_stage record; v_count_task integer:=0; v_count_fms integer:=0; v_ids jsonb; v_deadline timestamptz;
begin
  if current_user not in ('postgres','service_role') or p_limit not between 1 and 500 then raise exception 'Scheduled detection is not authorized' using errcode='42501'; end if;
  for v_task in select * from public.task_instances where status not in ('completed','blocked') and public.task_effective_due_datetime(task_instances)<p_now order by public.task_effective_due_datetime(task_instances) limit p_limit loop
    v_deadline:=public.task_effective_due_datetime(v_task);
    select coalesce(jsonb_agg(user_profile_id),'[]') into v_ids from public.task_assignees where task_instance_id=v_task.id and is_active and role_at_task='doer';
    perform public.enqueue_notification_event(v_task.tenant_id,v_task.branch_id,v_task.department_id,'task_overdue','tasks',v_task.id,null,jsonb_build_object('task_title',v_task.title,'planned_datetime',v_deadline,'priority',v_task.priority,'_assigned_user_ids',v_ids,'_task_creator_id',v_task.created_by,'_link_url','/tasks/'||v_task.task_type),'task_overdue:'||v_task.id||':'||v_deadline::text,p_now);
    v_count_task:=v_count_task+1;
  end loop;
  for v_stage in select s.*,i.tenant_id,i.branch_id,i.department_id,i.started_by,i.reference_number,i.priority,f.name flow_name,d.name stage_name from public.fms_instance_stages s join public.fms_instances i on i.id=s.fms_instance_id join public.fms_stages d on d.id=s.fms_stage_id join public.fms_flows f on f.id=i.fms_flow_id where i.status in ('active','overdue') and s.status in ('pending','in_progress','in_review','overdue') and s.planned_datetime<p_now order by s.planned_datetime limit p_limit loop
    update public.fms_instance_stages set sla_breached=true,status=case when status='pending' then 'overdue'::public.task_status else status end where id=v_stage.id;
    perform public.enqueue_notification_event(v_stage.tenant_id,v_stage.branch_id,v_stage.department_id,'fms_sla_breached','fms',v_stage.id,null,jsonb_build_object('flow_name',v_stage.flow_name,'stage_name',v_stage.stage_name,'reference',v_stage.reference_number,'planned_datetime',v_stage.planned_datetime,'priority',v_stage.priority,'_assigned_user_ids',to_jsonb(v_stage.assigned_to),'_instance_starter_id',v_stage.started_by,'_link_url','/tasks/fms?instance='||v_stage.fms_instance_id),'fms_sla_breached:'||v_stage.id||':'||v_stage.planned_datetime::text,p_now);
    v_count_fms:=v_count_fms+1;
  end loop;
  return query select v_count_task,v_count_fms;
end;
$$;

create or replace function public.initialize_imported_task_requirements()
returns trigger language plpgsql set search_path=public as $$
declare v_template public.task_templates;
begin
  if new.task_template_id is null then return new; end if;
  select * into v_template from public.task_templates where id=new.task_template_id;
  new.core_task_label:=coalesce(new.core_task_label,v_template.core_task_label);
  new.verifier_user_profile_id:=coalesce(new.verifier_user_profile_id,v_template.verifier_user_profile_id);
  new.requires_upload:=v_template.requires_upload;
  new.verification_status:=case when v_template.verification_required then 'pending' else 'not_required' end;
  if new.due_datetime is null and v_template.due_time is not null then
    new.due_datetime:=(coalesce(new.scheduled_date,(new.planned_datetime at time zone 'Asia/Kolkata')::date)::text||' '||v_template.due_time::text||' Asia/Kolkata')::timestamptz;
  end if;
  return new;
end;
$$;

drop trigger if exists task_instances_imported_requirements on public.task_instances;
create trigger task_instances_imported_requirements before insert on public.task_instances
for each row execute function public.initialize_imported_task_requirements();
revoke all on function public.initialize_imported_task_requirements() from public,anon,authenticated,service_role;

create or replace function public.verify_recurring_task_with_audit(p_task_id uuid,p_decision text,p_note text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor public.user_profiles; v_task public.task_instances;
begin
  select * into v_actor from public.user_profiles where auth_user_id=auth.uid();
  select * into v_task from public.task_instances where id=p_task_id for update;
  if v_actor.id is null or not public.current_profile_is_active() or v_task.id is null
    or v_task.tenant_id<>v_actor.tenant_id or v_task.task_template_id is null
    or not (v_actor.user_role in ('super_admin','admin') or v_task.verifier_user_profile_id=v_actor.id) then
    raise exception 'Recurring task verification denied' using errcode='42501';
  end if;
  if v_task.status<>'completed' or v_task.verification_status not in ('pending','rejected') then
    raise exception 'Only completed tasks awaiting verification can be reviewed' using errcode='23514';
  end if;
  if p_decision not in ('verified','rejected') then raise exception 'Verification decision is invalid' using errcode='22023'; end if;
  if v_actor.user_role in ('super_admin','admin') and v_task.verifier_user_profile_id is distinct from v_actor.id
    and nullif(btrim(p_note),'') is null then raise exception 'An admin override note is required' using errcode='22023'; end if;
  if p_decision='rejected' and nullif(btrim(p_note),'') is null then raise exception 'A rejection note is required' using errcode='22023'; end if;
  update public.task_instances set verification_status=p_decision,verified_by=v_actor.id,verified_at=now(),
    verification_note=nullif(btrim(p_note),''),updated_by=v_actor.id,updated_at=now() where id=p_task_id;
  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'recurring_task_'||p_decision,'recurring_todo',p_task_id,
    jsonb_build_object('verification_status',v_task.verification_status),
    jsonb_build_object('verification_status',p_decision,'note',nullif(btrim(p_note),''),
      'admin_override',v_actor.user_role in ('super_admin','admin') and v_task.verifier_user_profile_id is distinct from v_actor.id));
end;
$$;

create or replace function public.get_recurring_todo_workspace(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor public.user_profiles; v_from date; v_to date; v_search text; v_templates jsonb; v_instances jsonb; v_stats jsonb;
begin
  select * into v_actor from public.user_profiles where auth_user_id=auth.uid();
  if v_actor.id is null or not public.current_profile_is_active() or v_actor.user_role not in ('super_admin','admin') then
    raise exception 'Recurring workspace access denied' using errcode='42501';
  end if;
  v_from:=coalesce(nullif(p_filter->>'date_from','')::date,(now() at time zone 'Asia/Kolkata')::date-7);
  v_to:=coalesce(nullif(p_filter->>'date_to','')::date,(now() at time zone 'Asia/Kolkata')::date+30);
  v_search:=lower(btrim(coalesce(p_filter->>'search','')));
  select coalesce(jsonb_agg(to_jsonb(t) order by t.title),'[]'::jsonb) into v_templates
  from public.task_templates t where t.tenant_id=v_actor.tenant_id and t.task_type in ('checklist','delegation')
    and t.recurrence_rule is not null and (v_search='' or lower(t.title||' '||coalesce(t.description,'')) like '%'||v_search||'%');
  with visible as (
    select ti.* from public.task_instances ti where ti.tenant_id=v_actor.tenant_id and ti.task_template_id is not null
      and (ti.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to
      and (v_search='' or lower(ti.title||' '||coalesce(ti.description,'')) like '%'||v_search||'%')
  )
  select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object(
    'assignees',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.employee_name,'is_original',a.is_original)),'[]'::jsonb) from public.task_assignees a join public.user_profiles u on u.id=a.user_profile_id where a.task_instance_id=v.id and a.is_active),
    'checklist',(select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order),'[]'::jsonb) from public.task_checklists c where c.task_instance_id=v.id),
    'has_attachment',exists(select 1 from public.task_attachments a where a.task_instance_id=v.id),
    'has_form_submission',exists(select 1 from public.form_submissions s where s.linked_record_id=v.id and s.form_template_id=v.form_template_id)
  ) order by public.task_effective_due_datetime(v)),'[]'::jsonb) into v_instances from visible v;
  select jsonb_build_object('total',count(*),'pending',count(*) filter(where status='pending'),
    'in_progress',count(*) filter(where status='in_progress'),'completed',count(*) filter(where status='completed'),
    'overdue',count(*) filter(where status not in ('completed','rejected') and public.task_effective_due_datetime(ti)<now()),
    'coverage_required',count(*) filter(where coverage_status='coverage_required'),
    'manager_review',count(*) filter(where coverage_status='manager_review')) into v_stats
  from public.task_instances ti where ti.tenant_id=v_actor.tenant_id and ti.task_template_id is not null
    and (ti.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to;
  return jsonb_build_object('filters',jsonb_build_object('date_from',v_from,'date_to',v_to),'templates',v_templates,'instances',v_instances,'stats',v_stats);
end;
$$;

revoke all on function public.task_effective_due_datetime(public.task_instances) from public,anon;
grant execute on function public.task_effective_due_datetime(public.task_instances) to authenticated,service_role;
revoke all on function public.get_recurring_todo_workspace(jsonb) from public,anon;
grant execute on function public.get_recurring_todo_workspace(jsonb) to authenticated;
revoke all on function public.verify_recurring_task_with_audit(uuid,text,text) from public,anon;
grant execute on function public.verify_recurring_task_with_audit(uuid,text,text) to authenticated;

drop view if exists public.v_all_tasks;
create view public.v_all_tasks with (security_invoker=true) as
  select ti.id,ti.tenant_id,ti.branch_id,ti.department_id,ti.category_id,ti.task_template_id,
    ti.task_type,ti.title,ti.description,ti.priority,ti.status,ti.created_by,ti.planned_datetime,
    ti.revised_datetime,ti.actual_datetime,ti.delay_minutes,ti.source,ti.requires_upload,
    ti.requires_remark,ti.requires_form,ti.form_template_id,ta.user_profile_id as assignee_id,
    coalesce(round(100.0*count(tc.id) filter(where tc.is_required and tc.is_completed)
      /nullif(count(tc.id) filter(where tc.is_required),0)),
      case when count(tc.id) filter(where tc.is_required)=0 then 100 else 0 end)::integer as checklist_completion_pct,
    ti.due_datetime,ti.core_task_label,ti.verifier_user_profile_id
  from public.task_instances ti
  left join public.task_assignees ta on ta.task_instance_id=ti.id and ta.is_active and ta.role_at_task='doer'
  left join public.task_checklists tc on tc.task_instance_id=ti.id
  group by ti.id,ta.user_profile_id
  union all
  select fis.id,fi.tenant_id,fi.branch_id,null::uuid,null::uuid,null::uuid,'fms'::public.task_type,
    fs.name,fs.method,fi.priority,fis.status,fi.started_by,fis.planned_datetime,null::timestamptz,
    fis.actual_datetime,fis.delay_minutes,'fms'::text,fs.requires_upload,fs.requires_remark,
    (fs.form_template_id is not null),fs.form_template_id,unnest(fis.assigned_to),0,
    null::timestamptz,null::text,null::uuid
  from public.fms_instance_stages fis
  join public.fms_instances fi on fi.id=fis.fms_instance_id
  join public.fms_stages fs on fs.id=fis.fms_stage_id;
grant select on public.v_all_tasks to authenticated;
notify pgrst,'reload schema';
