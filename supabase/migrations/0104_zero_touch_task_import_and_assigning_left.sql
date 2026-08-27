-- Zero-touch current-sheet imports, durable unassigned work, and cross-file replay.
set search_path = public, extensions;

alter table public.task_instances
  add column if not exists assignment_status text not null default 'assigned';
alter table public.task_instances drop constraint if exists task_instances_assignment_status_check;
alter table public.task_instances add constraint task_instances_assignment_status_check
  check (assignment_status in ('assigned','assigning_left'));

alter table public.task_templates
  add column if not exists assignment_status text not null default 'assigned';
alter table public.task_templates drop constraint if exists task_templates_assignment_status_check;
alter table public.task_templates add constraint task_templates_assignment_status_check
  check (assignment_status in ('assigned','assigning_left'));
alter table public.task_templates drop constraint if exists task_templates_assignee_value_check;
alter table public.task_templates add constraint task_templates_assignee_value_check check (
  (assignment_status='assigning_left' and default_assignee_user_id is null and default_assignee_role is null)
  or
  (assignment_status='assigned' and (
    (default_assignee_type='specific_user' and default_assignee_user_id is not null and default_assignee_role is null)
    or (default_assignee_type='role' and default_assignee_role is not null and default_assignee_user_id is null)
  ))
);

alter table public.task_import_batches
  add column if not exists replayed_count integer not null default 0;
alter table public.task_import_batches drop constraint if exists task_import_batches_replayed_count_check;
alter table public.task_import_batches add constraint task_import_batches_replayed_count_check
  check (replayed_count between 0 and 2500);

create table public.task_import_row_registry(
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  business_fingerprint text not null check(business_fingerprint ~ '^[a-f0-9]{64}$'),
  first_batch_id uuid not null references public.task_import_batches(id) on delete cascade,
  task_instance_id uuid references public.task_instances(id),
  task_template_id uuid references public.task_templates(id),
  created_at timestamptz not null default now(),
  unique(tenant_id,business_fingerprint)
);
create index idx_task_import_row_registry_batch on public.task_import_row_registry(first_batch_id);
alter table public.task_import_row_registry enable row level security;
revoke all on table public.task_import_row_registry from public,anon,authenticated,service_role;

create or replace function public.task_import_business_fingerprint(p_row jsonb)
returns text language sql immutable set search_path=public,extensions as $$
  select encode(digest(jsonb_build_object(
    'destination',lower(btrim(coalesce(p_row->>'destination',''))),
    'schedule_kind',lower(btrim(coalesce(p_row->>'schedule_kind',''))),
    'task_type',lower(btrim(coalesce(p_row->>'task_type',''))),
    'core_task_label',btrim(coalesce(p_row->>'core_task_label','')),
    'title',btrim(coalesce(p_row->>'title','')),
    'description',btrim(coalesce(p_row->>'description','')),
    'priority',lower(btrim(coalesce(p_row->>'priority',''))),
    'branch',lower(btrim(coalesce(p_row->>'branch',''))),
    'department',lower(btrim(coalesce(p_row->>'department',''))),
    'category',lower(btrim(coalesce(p_row->>'category',''))),
    'assignee_email',lower(btrim(coalesce(p_row->>'assignee_email',''))),
    'assignee_name',lower(regexp_replace(btrim(coalesce(p_row->>'assignee_name','')),'\s+',' ','g')),
    'verifier_label',lower(regexp_replace(btrim(coalesce(p_row->>'verifier_label','')),'\s+',' ','g')),
    'starts_on',coalesce(p_row->>'starts_on',''),
    'start_time',coalesce(p_row->>'start_time',''),
    'due_time',coalesce(p_row->>'due_time',''),
    'recurrence_rule',upper(btrim(coalesce(p_row->>'recurrence_rule',''))),
    'requires_upload',coalesce((p_row->>'requires_upload')::boolean,false),
    'verification_required',coalesce((p_row->>'verification_required')::boolean,false),
    'buddy_assignment_allowed',coalesce((p_row->>'buddy_assignment_allowed')::boolean,false),
    'is_active',coalesce((p_row->>'is_active')::boolean,true),
    'checklist',coalesce(p_row->'checklist','[]'::jsonb)
  )::text,'sha256'),'hex')
$$;
revoke all on function public.task_import_business_fingerprint(jsonb) from public,anon,authenticated,service_role;

drop function if exists public.list_task_import_identity_candidates();
create function public.list_task_import_identity_candidates()
returns table(id uuid,employee_name text,email text,branch_id uuid,department_id uuid,manager_id uuid)
language plpgsql stable security definer set search_path=public as $$
declare v_actor public.user_profiles:=public.task_import_actor();
begin
  return query select u.id,u.employee_name,u.email,u.branch_id,u.department_id,u.reports_to_user_id
  from public.user_profiles u
  where u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
    and (v_actor.user_role<>'manager' or u.branch_id=v_actor.branch_id)
  order by u.employee_name,u.id;
end;
$$;

create or replace function public.commit_task_bulk_import_chunk(p_batch_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  v_actor public.user_profiles:=public.task_import_actor(); v_batch public.task_import_batches; v_row jsonb;
  v_branch uuid; v_department uuid; v_category uuid; v_assignee uuid; v_verifier uuid; v_task uuid; v_template uuid;
  v_hash text; v_business_hash text; v_created integer:=0; v_rejected integer:=0; v_replayed integer:=0; v_initial integer:=0;
  v_issues jsonb:='[]'::jsonb; v_planned timestamptz; v_due timestamptz; v_item jsonb; v_source_row integer; v_destination text;
  v_identity_count integer; v_assignment_status text; v_registry_id uuid; v_total integer;
begin
  if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'Import chunks must contain 1 to 100 rows' using errcode='22023'; end if;
  select * into v_batch from public.task_import_batches where id=p_batch_id for update;
  if v_batch.id is null or v_batch.tenant_id<>v_actor.tenant_id or v_batch.created_by<>v_actor.id or v_batch.outcome not in ('in_progress','partial') then
    raise exception 'Import batch is unavailable' using errcode='42501';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_source_row:=coalesce((v_row->>'source_row')::integer,0); v_destination:=v_row->>'destination';
    v_hash:=encode(digest(v_row::text,'sha256'),'hex');
    if exists(select 1 from public.task_import_items where batch_id=p_batch_id and (source_row=v_source_row or row_hash=v_hash)) then v_replayed:=v_replayed+1; continue; end if;
    begin
      if jsonb_typeof(v_row)<>'object' or v_row-array['source_row','task_key','destination','schedule_kind','task_type','core_task_label','title','description','priority','branch','department','category','assignee_email','assignee_profile_id','assignee_name','verifier_label','verifier_profile_id','starts_on','start_time','due_time','planned_at','due_at','recurrence_rule','requires_upload','verification_required','buddy_assignment_allowed','is_active','assignment_status','checklist']<>'{}'::jsonb then raise exception 'Unsupported row fields' using errcode='22023'; end if;
      if v_source_row not between 2 and 2501 or v_destination not in ('tasks','recurring_todo') or v_row->>'task_type' not in ('checklist','delegation') or nullif(btrim(v_row->>'title'),'') is null or length(btrim(v_row->>'title'))>200 then raise exception 'Row contract is invalid' using errcode='22023'; end if;

      select b.id into v_branch from public.branches b where b.tenant_id=v_actor.tenant_id and b.is_active and (lower(b.name)=lower(btrim(v_row->>'branch')) or lower(b.code)=lower(btrim(v_row->>'branch'))) and (v_actor.user_role<>'manager' or b.id=v_actor.branch_id);
      select d.id into v_department from public.departments d where d.tenant_id=v_actor.tenant_id and d.branch_id=v_branch and d.is_active and lower(d.name)=lower(btrim(v_row->>'department'));
      select dm.id into v_category from public.dropdown_masters dm where dm.tenant_id=v_actor.tenant_id and dm.master_type='task_category' and dm.is_active and (nullif(btrim(v_row->>'category'),'') is null or lower(dm.label)=lower(btrim(v_row->>'category')) or lower(dm.value)=lower(btrim(v_row->>'category'))) order by dm.sort_order limit 1;
      if v_branch is null or v_department is null or v_category is null then raise exception 'Authorized organizational mapping is invalid' using errcode='23503'; end if;

      v_assignee:=null;
      if nullif(btrim(v_row->>'assignee_email'),'') is not null then
        select count(*),min(u.id::text)::uuid into v_identity_count,v_assignee from public.user_profiles u
        where u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
          and (v_actor.user_role<>'manager' or u.branch_id=v_actor.branch_id) and lower(u.email)=lower(btrim(v_row->>'assignee_email'));
        if v_identity_count<>1 then v_assignee:=null; end if;
      elsif nullif(btrim(v_row->>'assignee_name'),'') is not null then
        select count(*),min(u.id::text)::uuid into v_identity_count,v_assignee from public.user_profiles u
        where u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
          and (v_actor.user_role<>'manager' or u.branch_id=v_actor.branch_id)
          and lower(regexp_replace(btrim(u.employee_name),'\s+',' ','g'))=lower(regexp_replace(btrim(v_row->>'assignee_name'),'\s+',' ','g'));
        if v_identity_count<>1 then v_assignee:=null; end if;
      end if;

      v_verifier:=null;
      if coalesce((v_row->>'verification_required')::boolean,false) then
        if nullif(btrim(v_row->>'verifier_label'),'') is not null then
          select count(*),min(u.id::text)::uuid into v_identity_count,v_verifier from public.user_profiles u
          where u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
            and (lower(regexp_replace(btrim(u.employee_name),'\s+',' ','g'))=lower(regexp_replace(btrim(v_row->>'verifier_label'),'\s+',' ','g')) or lower(u.email)=lower(btrim(v_row->>'verifier_label')));
          if v_identity_count<>1 then v_verifier:=null; end if;
        end if;
        if v_verifier is null and v_assignee is not null then
          select manager.id into v_verifier from public.user_profiles employee join public.user_profiles manager on manager.id=employee.reports_to_user_id
          where employee.id=v_assignee and manager.tenant_id=v_actor.tenant_id and manager.working_status='active' and manager.account_status='active' and manager.is_login_enabled;
        end if;
      end if;
      v_assignment_status:=case when v_assignee is not null then 'assigned' else 'assigning_left' end;

      v_business_hash:=public.task_import_business_fingerprint(v_row);
      insert into public.task_import_row_registry(tenant_id,business_fingerprint,first_batch_id)
      values(v_actor.tenant_id,v_business_hash,p_batch_id)
      on conflict(tenant_id,business_fingerprint) do nothing returning id into v_registry_id;
      if v_registry_id is null then
        select task_instance_id,task_template_id into v_task,v_template from public.task_import_row_registry where tenant_id=v_actor.tenant_id and business_fingerprint=v_business_hash;
        insert into public.task_import_items(tenant_id,batch_id,source_row,row_hash,destination,outcome,task_instance_id,task_template_id)
        values(v_actor.tenant_id,p_batch_id,v_source_row,v_hash,v_destination,'replayed',v_task,v_template);
        v_replayed:=v_replayed+1; v_task:=null; v_template:=null; continue;
      end if;
      if v_destination='tasks' then v_task:=extensions.uuid_generate_v4(); else v_template:=extensions.uuid_generate_v4(); end if;

      if v_destination='tasks' then
        v_planned:=((v_row->>'planned_at')||' Asia/Kolkata')::timestamptz; v_due:=((v_row->>'due_at')||' Asia/Kolkata')::timestamptz;
        if v_due<=v_planned then raise exception 'Due time must follow start time' using errcode='22023'; end if;
        insert into public.task_instances(id,tenant_id,branch_id,department_id,category_id,task_type,title,description,priority,status,planned_datetime,due_datetime,core_task_label,verifier_user_profile_id,requires_upload,requires_remark,requires_form,source,created_by,updated_by,verification_status,buddy_assignment_allowed,assignment_status)
        values(v_task,v_actor.tenant_id,v_branch,v_department,v_category,(v_row->>'task_type')::public.task_type,btrim(v_row->>'title'),nullif(btrim(v_row->>'description'),''),coalesce(nullif(v_row->>'priority',''),'medium')::public.task_priority,'pending',v_planned,v_due,nullif(btrim(v_row->>'core_task_label'),''),v_verifier,coalesce((v_row->>'requires_upload')::boolean,false),false,false,'bulk_import',v_actor.id,v_actor.id,case when coalesce((v_row->>'verification_required')::boolean,false) then 'pending' else 'not_required' end,coalesce((v_row->>'buddy_assignment_allowed')::boolean,true),v_assignment_status);
        if v_assignee is not null then insert into public.task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values(v_task,v_assignee,'doer',true,true); end if;
        for v_item in select value from jsonb_array_elements(coalesce(v_row->'checklist','[]'::jsonb)) loop insert into public.task_checklists(task_instance_id,item_text,is_required,sort_order) values(v_task,btrim(v_item->>'item_text'),coalesce((v_item->>'required')::boolean,true),coalesce((v_item->>'sort_order')::integer,0)); end loop;
        insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'task_bulk_import_row_created','tasks',v_task,jsonb_build_object('batch_id',p_batch_id,'source_row',v_source_row,'assignment_status',v_assignment_status));
      else
        if v_row->>'schedule_kind' not in ('daily','weekly','monthly','quarterly','yearly','as_required') or nullif(v_row->>'recurrence_rule','') is null then raise exception 'Recurring schedule is invalid' using errcode='22023'; end if;
        insert into public.task_templates(id,tenant_id,branch_id,department_id,category_id,title,description,task_type,recurrence_rule,planned_time,due_time,priority,default_assignee_type,default_assignee_user_id,default_assignee_role,checklist_items,requires_upload,requires_remark,requires_form,is_active,schedule_kind,starts_on,verification_required,verifier_user_profile_id,buddy_assignment_allowed,core_task_label,created_by,updated_by,assignment_status)
        values(v_template,v_actor.tenant_id,v_branch,v_department,v_category,btrim(v_row->>'title'),nullif(btrim(v_row->>'description'),''),(v_row->>'task_type')::public.task_type,v_row->>'recurrence_rule',(v_row->>'start_time')::time,(v_row->>'due_time')::time,coalesce(nullif(v_row->>'priority',''),'medium')::public.task_priority,'specific_user',v_assignee,null,coalesce(v_row->'checklist','[]'::jsonb),coalesce((v_row->>'requires_upload')::boolean,false),false,false,case when v_assignment_status='assigned' and v_row->>'schedule_kind'<>'as_required' then coalesce((v_row->>'is_active')::boolean,true) else false end,v_row->>'schedule_kind',nullif(v_row->>'starts_on','')::date,coalesce((v_row->>'verification_required')::boolean,false),v_verifier,coalesce((v_row->>'buddy_assignment_allowed')::boolean,true),nullif(btrim(v_row->>'core_task_label'),''),v_actor.id,v_actor.id,v_assignment_status);
        if v_assignment_status='assigned' and v_row->>'schedule_kind'<>'as_required' and nullif(v_row->>'starts_on','') is not null then
          v_task:=public.create_recurring_todo_instance(v_template,(v_row->>'starts_on')::date,array[v_assignee]);
          if v_task is not null then v_initial:=v_initial+1; end if;
        end if;
        insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'task_bulk_import_schedule_created','task_templates',v_template,jsonb_build_object('batch_id',p_batch_id,'source_row',v_source_row,'initial_instance_id',v_task,'assignment_status',v_assignment_status));
      end if;
      update public.task_import_row_registry set task_instance_id=case when v_destination='tasks' then v_task else null end,task_template_id=case when v_destination='recurring_todo' then v_template else null end where id=v_registry_id;
      insert into public.task_import_items(tenant_id,batch_id,source_row,row_hash,destination,outcome,task_instance_id,task_template_id) values(v_actor.tenant_id,p_batch_id,v_source_row,v_hash,v_destination,'created',v_task,v_template);
      v_created:=v_created+1;
    exception when others then
      insert into public.task_import_items(tenant_id,batch_id,source_row,row_hash,destination,outcome,error_code) values(v_actor.tenant_id,p_batch_id,greatest(v_source_row,2),v_hash,case when v_destination in ('tasks','recurring_todo') then v_destination else 'tasks' end,'rejected',sqlstate);
      v_rejected:=v_rejected+1; v_issues:=v_issues||jsonb_build_array(jsonb_build_object('row',v_source_row,'field','row','reason','Server validation rejected this row','guidance','Review the grouped correction summary and retry a corrected file.','code',sqlstate));
    end;
    v_task:=null; v_template:=null; v_assignee:=null; v_verifier:=null; v_branch:=null; v_department:=null; v_category:=null; v_registry_id:=null;
  end loop;
  select count(*) into v_total from public.task_import_items where batch_id=p_batch_id;
  update public.task_import_batches set created_count=created_count+v_created,rejected_count=rejected_count+v_rejected,replayed_count=replayed_count+v_replayed,
    valid_count=valid_count+v_created,error_count=error_count+v_rejected,
    one_time_count=one_time_count+(select count(*) from jsonb_array_elements(p_rows) r where r->>'destination'='tasks'),
    recurring_count=recurring_count+(select count(*) from jsonb_array_elements(p_rows) r where r->>'destination'='recurring_todo'),
    initial_instance_count=initial_instance_count+v_initial,
    outcome=case when v_total>=requested_count then case when rejected_count+v_rejected>0 then 'partial' else 'completed' end else 'in_progress' end,
    completed_at=case when v_total>=requested_count then now() else null end where id=p_batch_id returning * into v_batch;
  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'task_bulk_import_chunk_committed','task_import_batches',p_batch_id,jsonb_build_object('created',v_created,'rejected',v_rejected,'replayed',v_replayed));
  return jsonb_build_object('batch_id',p_batch_id,'created',v_created,'rejected',v_rejected,'replayed',v_replayed,'created_count',v_batch.created_count,'rejected_count',v_batch.rejected_count,'replayed_count',v_batch.replayed_count,'outcome',v_batch.outcome,'issues',v_issues);
end;
$$;

create or replace function public.list_assigning_left_tasks()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor public.user_profiles; v_result jsonb;
begin
  select * into v_actor from public.current_profile();
  if v_actor.id is null or not public.current_profile_is_active() or v_actor.user_role not in ('super_admin','admin') then raise exception 'Assigning Left access denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(item order by item->>'created_at' desc),'[]'::jsonb) into v_result from (
    select jsonb_build_object('record_kind','task','id',t.id,'title',t.title,'destination','Tasks','branch_id',t.branch_id,'department_id',t.department_id,'starts_at',t.planned_datetime,'verification_pending',t.verification_status='pending' and t.verifier_user_profile_id is null,'created_at',t.created_at) item
    from public.task_instances t where t.tenant_id=v_actor.tenant_id and t.assignment_status='assigning_left'
    union all
    select jsonb_build_object('record_kind','template','id',t.id,'title',t.title,'destination',case when t.schedule_kind='as_required' then 'As Required' else 'Recurring / To-Do' end,'branch_id',t.branch_id,'department_id',t.department_id,'starts_at',t.starts_on,'verification_pending',t.verification_required and t.verifier_user_profile_id is null,'created_at',t.created_at) item
    from public.task_templates t where t.tenant_id=v_actor.tenant_id and t.assignment_status='assigning_left'
  ) queued;
  return v_result;
end;
$$;

create or replace function public.assign_imported_task_with_audit(p_record_kind text,p_record_id uuid,p_user_profile_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.user_profiles; v_target public.user_profiles; v_task public.task_instances; v_template public.task_templates; v_status text; v_initial uuid;
begin
  select * into v_actor from public.current_profile();
  if v_actor.id is null or not public.current_profile_is_active() or v_actor.user_role not in ('super_admin','admin') then raise exception 'Assigning Left update denied' using errcode='42501'; end if;
  select * into v_target from public.user_profiles where id=p_user_profile_id and tenant_id=v_actor.tenant_id and working_status='active' and account_status='active' and is_login_enabled;
  if v_target.id is null then raise exception 'Selected assignee is unavailable' using errcode='23503'; end if;
  if p_record_kind='task' then
    select * into v_task from public.task_instances where id=p_record_id and tenant_id=v_actor.tenant_id and assignment_status='assigning_left' for update;
    if v_task.id is null then raise exception 'Assigning Left task is unavailable' using errcode='22023'; end if;
    update public.task_assignees set is_active=true,is_original=true,role_at_task='doer',completed_at=null
    where task_instance_id=v_task.id and user_profile_id=v_target.id;
    if not found then
      insert into public.task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values(v_task.id,v_target.id,'doer',true,true);
    end if;
    if v_task.verification_status='pending' and v_task.verifier_user_profile_id is null then
      update public.task_instances set verifier_user_profile_id=(select id from public.user_profiles where id=v_target.reports_to_user_id and tenant_id=v_actor.tenant_id and working_status='active' and account_status='active' and is_login_enabled) where id=v_task.id returning * into v_task;
    end if;
    v_status:='assigned';
    update public.task_instances set assignment_status=v_status,updated_by=v_actor.id,updated_at=now() where id=v_task.id;
  elsif p_record_kind='template' then
    select * into v_template from public.task_templates where id=p_record_id and tenant_id=v_actor.tenant_id and assignment_status='assigning_left' for update;
    if v_template.id is null then raise exception 'Assigning Left schedule is unavailable' using errcode='22023'; end if;
    if v_template.verification_required and v_template.verifier_user_profile_id is null then
      select id into v_template.verifier_user_profile_id from public.user_profiles where id=v_target.reports_to_user_id and tenant_id=v_actor.tenant_id and working_status='active' and account_status='active' and is_login_enabled;
    end if;
    v_status:='assigned';
    update public.task_templates set default_assignee_type='specific_user',default_assignee_user_id=v_target.id,default_assignee_role=null,verifier_user_profile_id=v_template.verifier_user_profile_id,assignment_status=v_status,is_active=(v_status='assigned' and schedule_kind<>'as_required'),updated_by=v_actor.id,updated_at=now() where id=v_template.id returning * into v_template;
    if v_status='assigned' and v_template.schedule_kind<>'as_required' and v_template.starts_on is not null and v_template.starts_on<=(now() at time zone 'Asia/Kolkata')::date then
      v_initial:=public.create_recurring_todo_instance(v_template.id,v_template.starts_on,array[v_target.id]);
    end if;
  else raise exception 'Assigning Left record kind is invalid' using errcode='22023';
  end if;
  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'assigning_left_resolved',case when p_record_kind='task' then 'tasks' else 'task_templates' end,p_record_id,jsonb_build_object('record_kind',p_record_kind,'assignee_user_profile_id',p_user_profile_id,'assignment_status',v_status,'initial_instance_id',v_initial));
  return jsonb_build_object('record_kind',p_record_kind,'record_id',p_record_id,'assignment_status',v_status,'initial_instance_id',v_initial);
end;
$$;

revoke all on function public.list_task_import_identity_candidates(),public.commit_task_bulk_import_chunk(uuid,jsonb),public.list_assigning_left_tasks(),public.assign_imported_task_with_audit(text,uuid,uuid) from public,anon,service_role;
grant execute on function public.list_task_import_identity_candidates(),public.commit_task_bulk_import_chunk(uuid,jsonb),public.list_assigning_left_tasks(),public.assign_imported_task_with_audit(text,uuid,uuid) to authenticated;

notify pgrst,'reload schema';
