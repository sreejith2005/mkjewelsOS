-- Resumable, metadata-only import staging for the current task sheet.
alter table public.task_import_batches drop constraint if exists task_import_batches_requested_count_check;
alter table public.task_import_batches drop constraint if exists task_import_batches_created_count_check;
alter table public.task_import_batches drop constraint if exists task_import_batches_rejected_count_check;
alter table public.task_import_batches drop constraint if exists task_import_batches_valid_count_check;
alter table public.task_import_batches drop constraint if exists task_import_batches_error_count_check;
alter table public.task_import_batches drop constraint if exists task_import_batches_one_time_count_check;
alter table public.task_import_batches drop constraint if exists task_import_batches_recurring_count_check;
alter table public.task_import_batches drop constraint if exists task_import_batches_initial_instance_count_check;
alter table public.task_import_batches drop constraint if exists task_import_batches_outcome_check;
alter table public.task_import_batches
  add constraint task_import_batches_requested_count_check check(requested_count between 1 and 2500),
  add constraint task_import_batches_created_count_check check(created_count between 0 and 2500),
  add constraint task_import_batches_rejected_count_check check(rejected_count between 0 and 2500),
  add constraint task_import_batches_valid_count_check check(valid_count between 0 and 2500),
  add constraint task_import_batches_error_count_check check(error_count between 0 and 2500),
  add constraint task_import_batches_one_time_count_check check(one_time_count between 0 and 2500),
  add constraint task_import_batches_recurring_count_check check(recurring_count between 0 and 2500),
  add constraint task_import_batches_initial_instance_count_check check(initial_instance_count between 0 and 2500),
  add constraint task_import_batches_outcome_check check(outcome in ('validated','in_progress','completed','partial','cancelled','replayed','failed'));

create table public.task_import_items(
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  batch_id uuid not null references public.task_import_batches(id) on delete cascade,
  source_row integer not null check(source_row between 2 and 2501),
  row_hash text not null check(row_hash ~ '^[a-f0-9]{64}$'),
  destination text not null check(destination in ('tasks','recurring_todo')),
  outcome text not null check(outcome in ('created','replayed','rejected')),
  task_instance_id uuid references public.task_instances(id),
  task_template_id uuid references public.task_templates(id),
  error_code text,
  created_at timestamptz not null default now(),
  unique(batch_id,source_row),
  unique(batch_id,row_hash)
);
create index idx_task_import_items_batch on public.task_import_items(batch_id,source_row);
alter table public.task_import_items enable row level security;
create policy task_import_items_select on public.task_import_items for select to authenticated using(
  public.current_profile_is_active() and tenant_id=public.current_tenant_id() and exists(
    select 1 from public.task_import_batches b where b.id=batch_id
      and (b.created_by=(public.current_profile()).id or public.current_role_level() in ('super_admin','admin'))
  )
);
revoke all on table public.task_import_items from public,anon,authenticated,service_role;
grant select on table public.task_import_items to authenticated;

create or replace function public.task_import_actor()
returns public.user_profiles language plpgsql stable security definer set search_path=public as $$
declare v_actor public.user_profiles;
begin
  select * into v_actor from public.current_profile();
  if v_actor.id is null or not public.current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then
    raise exception 'Task bulk import denied' using errcode='42501';
  end if;
  return v_actor;
end;
$$;

create or replace function public.list_task_import_identity_candidates()
returns table(id uuid,employee_name text,email text,branch_id uuid,department_id uuid)
language plpgsql stable security definer set search_path=public as $$
declare v_actor public.user_profiles:=public.task_import_actor();
begin
  return query select u.id,u.employee_name,u.email,u.branch_id,u.department_id from public.user_profiles u
    where u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled
      and (v_actor.user_role<>'manager' or u.branch_id=v_actor.branch_id)
    order by u.employee_name,u.id;
end;
$$;

create or replace function public.begin_task_bulk_import(p_import_hash text,p_file_label text,p_requested_count integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.user_profiles:=public.task_import_actor(); v_batch public.task_import_batches;
begin
  if coalesce(p_import_hash,'') !~ '^[a-f0-9]{64}$' or p_requested_count not between 1 and 2500 then
    raise exception 'Import metadata is invalid' using errcode='22023';
  end if;
  if coalesce(p_file_label,'') !~ '^[A-Za-z0-9._ -]{1,120}$' then raise exception 'File label is unsafe' using errcode='22023'; end if;
  select * into v_batch from public.task_import_batches where tenant_id=v_actor.tenant_id and import_hash=p_import_hash for update;
  if v_batch.id is not null then
    return jsonb_build_object('batch_id',v_batch.id,'outcome',v_batch.outcome,'replayed',true,'created_count',v_batch.created_count,'rejected_count',v_batch.rejected_count);
  end if;
  insert into public.task_import_batches(tenant_id,created_by,import_hash,source_headers,requested_count,safe_file_label,outcome,validated_at)
  values(v_actor.tenant_id,v_actor.id,p_import_hash,array['mk_jewels_daily_checklist_v1'],p_requested_count,p_file_label,'in_progress',now()) returning * into v_batch;
  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'task_bulk_import_started','task_import_batches',v_batch.id,jsonb_build_object('requested_count',p_requested_count,'import_hash',p_import_hash));
  return jsonb_build_object('batch_id',v_batch.id,'outcome','in_progress','replayed',false,'created_count',0,'rejected_count',0);
end;
$$;

create or replace function public.commit_task_bulk_import_chunk(p_batch_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  v_actor public.user_profiles:=public.task_import_actor(); v_batch public.task_import_batches; v_row jsonb;
  v_branch uuid; v_department uuid; v_category uuid; v_assignee uuid; v_verifier uuid; v_task uuid; v_template uuid;
  v_hash text; v_created integer:=0; v_rejected integer:=0; v_replayed integer:=0; v_issues jsonb:='[]'::jsonb;
  v_planned timestamptz; v_due timestamptz; v_item jsonb; v_source_row integer; v_destination text;
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
      if jsonb_typeof(v_row)<>'object' or v_row-array['source_row','task_key','destination','schedule_kind','task_type','core_task_label','title','description','priority','branch','department','category','assignee_email','assignee_profile_id','assignee_name','verifier_label','verifier_profile_id','starts_on','start_time','due_time','planned_at','due_at','recurrence_rule','requires_upload','verification_required','buddy_assignment_allowed','is_active','checklist']<>'{}'::jsonb then raise exception 'Unsupported row fields' using errcode='22023'; end if;
      if v_source_row not between 2 and 2501 or v_destination not in ('tasks','recurring_todo') or v_row->>'task_type' not in ('checklist','delegation') or nullif(btrim(v_row->>'title'),'') is null or length(btrim(v_row->>'title'))>200 then raise exception 'Row contract is invalid' using errcode='22023'; end if;
      select b.id into v_branch from public.branches b where b.tenant_id=v_actor.tenant_id and b.is_active and (lower(b.name)=lower(btrim(v_row->>'branch')) or lower(b.code)=lower(btrim(v_row->>'branch'))) and (v_actor.user_role<>'manager' or b.id=v_actor.branch_id);
      select d.id into v_department from public.departments d where d.tenant_id=v_actor.tenant_id and d.branch_id=v_branch and d.is_active and lower(d.name)=lower(btrim(v_row->>'department'));
      select dm.id into v_category from public.dropdown_masters dm where dm.tenant_id=v_actor.tenant_id and dm.master_type='task_category' and dm.is_active and (nullif(btrim(v_row->>'category'),'') is null or lower(dm.label)=lower(btrim(v_row->>'category')) or lower(dm.value)=lower(btrim(v_row->>'category'))) order by dm.sort_order limit 1;
      select u.id into v_assignee from public.user_profiles u where u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled and (v_actor.user_role<>'manager' or u.branch_id=v_actor.branch_id) and ((nullif(v_row->>'assignee_profile_id','') is not null and u.id=(v_row->>'assignee_profile_id')::uuid) or (nullif(v_row->>'assignee_profile_id','') is null and nullif(v_row->>'assignee_email','') is not null and lower(u.email)=lower(btrim(v_row->>'assignee_email'))));
      if coalesce((v_row->>'verification_required')::boolean,false) then select u.id into v_verifier from public.user_profiles u where u.tenant_id=v_actor.tenant_id and u.working_status='active' and u.account_status='active' and u.is_login_enabled and u.id=nullif(v_row->>'verifier_profile_id','')::uuid; else v_verifier:=null; end if;
      if v_branch is null or v_department is null or v_category is null or v_assignee is null or (coalesce((v_row->>'verification_required')::boolean,false) and v_verifier is null) then raise exception 'Authorized reference mapping is invalid' using errcode='23503'; end if;
      if v_destination='tasks' then
        v_planned:=((v_row->>'planned_at')||' Asia/Kolkata')::timestamptz; v_due:=((v_row->>'due_at')||' Asia/Kolkata')::timestamptz;
        if v_due<=v_planned then raise exception 'Due time must follow start time' using errcode='22023'; end if;
        insert into public.task_instances(tenant_id,branch_id,department_id,category_id,task_type,title,description,priority,status,planned_datetime,due_datetime,core_task_label,verifier_user_profile_id,requires_upload,requires_remark,requires_form,source,created_by,updated_by,verification_status,buddy_assignment_allowed)
        values(v_actor.tenant_id,v_branch,v_department,v_category,(v_row->>'task_type')::public.task_type,btrim(v_row->>'title'),nullif(btrim(v_row->>'description'),''),coalesce(nullif(v_row->>'priority',''),'medium')::public.task_priority,'pending',v_planned,v_due,nullif(btrim(v_row->>'core_task_label'),''),v_verifier,coalesce((v_row->>'requires_upload')::boolean,false),false,false,'bulk_import',v_actor.id,v_actor.id,case when coalesce((v_row->>'verification_required')::boolean,false) then 'pending' else 'not_required' end,coalesce((v_row->>'buddy_assignment_allowed')::boolean,true)) returning id into v_task;
        insert into public.task_assignees(task_instance_id,user_profile_id,role_at_task,is_original,is_active) values(v_task,v_assignee,'doer',true,true);
        for v_item in select value from jsonb_array_elements(coalesce(v_row->'checklist','[]'::jsonb)) loop insert into public.task_checklists(task_instance_id,item_text,is_required,sort_order) values(v_task,btrim(v_item->>'item_text'),coalesce((v_item->>'required')::boolean,true),coalesce((v_item->>'sort_order')::integer,0)); end loop;
        insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'task_bulk_import_row_created','tasks',v_task,jsonb_build_object('batch_id',p_batch_id,'source_row',v_source_row));
      else
        if v_row->>'schedule_kind' not in ('daily','weekly','monthly','quarterly','yearly','as_required') or nullif(v_row->>'recurrence_rule','') is null then raise exception 'Recurring schedule is invalid' using errcode='22023'; end if;
        insert into public.task_templates(tenant_id,branch_id,department_id,category_id,title,description,task_type,recurrence_rule,planned_time,due_time,priority,default_assignee_type,default_assignee_user_id,checklist_items,requires_upload,requires_remark,requires_form,is_active,schedule_kind,starts_on,verification_required,verifier_user_profile_id,buddy_assignment_allowed,core_task_label,created_by,updated_by)
        values(v_actor.tenant_id,v_branch,v_department,v_category,btrim(v_row->>'title'),nullif(btrim(v_row->>'description'),''),(v_row->>'task_type')::public.task_type,v_row->>'recurrence_rule',(v_row->>'start_time')::time,(v_row->>'due_time')::time,coalesce(nullif(v_row->>'priority',''),'medium')::public.task_priority,'specific_user',v_assignee,coalesce(v_row->'checklist','[]'::jsonb),coalesce((v_row->>'requires_upload')::boolean,false),false,false,case when v_row->>'schedule_kind'='as_required' then false else coalesce((v_row->>'is_active')::boolean,true) end,v_row->>'schedule_kind',nullif(v_row->>'starts_on','')::date,coalesce((v_row->>'verification_required')::boolean,false),v_verifier,coalesce((v_row->>'buddy_assignment_allowed')::boolean,true),nullif(btrim(v_row->>'core_task_label'),''),v_actor.id,v_actor.id) returning id into v_template;
        if v_row->>'schedule_kind'<>'as_required' and nullif(v_row->>'starts_on','') is not null then v_task:=public.create_recurring_todo_instance(v_template,(v_row->>'starts_on')::date,array[v_assignee]); end if;
        insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'task_bulk_import_schedule_created','task_templates',v_template,jsonb_build_object('batch_id',p_batch_id,'source_row',v_source_row,'initial_instance_id',v_task));
      end if;
      insert into public.task_import_items(tenant_id,batch_id,source_row,row_hash,destination,outcome,task_instance_id,task_template_id) values(v_actor.tenant_id,p_batch_id,v_source_row,v_hash,v_destination,'created',v_task,v_template);
      v_created:=v_created+1;
    exception when others then
      insert into public.task_import_items(tenant_id,batch_id,source_row,row_hash,destination,outcome,error_code) values(v_actor.tenant_id,p_batch_id,greatest(v_source_row,2),v_hash,case when v_destination in ('tasks','recurring_todo') then v_destination else 'tasks' end,'rejected',sqlstate);
      v_rejected:=v_rejected+1; v_issues:=v_issues||jsonb_build_array(jsonb_build_object('row',v_source_row,'field','row','reason','Server validation rejected this row','guidance','Correct the mapped references or row values and start a new import.','code',sqlstate));
    end;
    v_task:=null; v_template:=null; v_assignee:=null; v_verifier:=null; v_branch:=null; v_department:=null; v_category:=null;
  end loop;
  update public.task_import_batches set created_count=created_count+v_created,rejected_count=rejected_count+v_rejected,
    valid_count=valid_count+v_created,error_count=error_count+v_rejected,
    one_time_count=one_time_count+(select count(*) from jsonb_array_elements(p_rows) r where r->>'destination'='tasks'),
    recurring_count=recurring_count+(select count(*) from jsonb_array_elements(p_rows) r where r->>'destination'='recurring_todo'),
    initial_instance_count=initial_instance_count+(select count(*) from public.task_import_items i where i.batch_id=p_batch_id and i.created_at>=statement_timestamp() and i.task_template_id is not null and i.task_instance_id is not null),
    outcome=case when created_count+rejected_count+v_created+v_rejected>=requested_count then case when rejected_count+v_rejected>0 then 'partial' else 'completed' end else 'in_progress' end,
    completed_at=case when created_count+rejected_count+v_created+v_rejected>=requested_count then now() else null end where id=p_batch_id returning * into v_batch;
  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'task_bulk_import_chunk_committed','task_import_batches',p_batch_id,jsonb_build_object('created',v_created,'rejected',v_rejected,'replayed',v_replayed));
  return jsonb_build_object('batch_id',p_batch_id,'created',v_created,'rejected',v_rejected,'replayed',v_replayed,'created_count',v_batch.created_count,'rejected_count',v_batch.rejected_count,'outcome',v_batch.outcome,'issues',v_issues);
end;
$$;

create or replace function public.cancel_task_bulk_import(p_batch_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.user_profiles:=public.task_import_actor(); v_batch public.task_import_batches;
begin
  update public.task_import_batches set outcome='cancelled',completed_at=now() where id=p_batch_id and tenant_id=v_actor.tenant_id and created_by=v_actor.id and outcome in ('in_progress','partial') returning * into v_batch;
  if v_batch.id is null then raise exception 'Import batch cannot be cancelled' using errcode='42501'; end if;
  insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'task_bulk_import_cancelled','task_import_batches',p_batch_id,jsonb_build_object('created_count',v_batch.created_count,'rejected_count',v_batch.rejected_count));
  return jsonb_build_object('batch_id',p_batch_id,'outcome','cancelled');
end;
$$;

create or replace function public.get_task_import_batch_status(p_batch_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_actor public.user_profiles:=public.task_import_actor(); v_batch public.task_import_batches;
begin
  select * into v_batch from public.task_import_batches where id=p_batch_id and tenant_id=v_actor.tenant_id and (created_by=v_actor.id or v_actor.user_role in ('super_admin','admin'));
  if v_batch.id is null then raise exception 'Import batch is unavailable' using errcode='42501'; end if;
  return jsonb_build_object('batch_id',v_batch.id,'requested_count',v_batch.requested_count,'created_count',v_batch.created_count,'rejected_count',v_batch.rejected_count,'outcome',v_batch.outcome,'completed_at',v_batch.completed_at);
end;
$$;

revoke all on function public.task_import_actor(),public.list_task_import_identity_candidates(),public.begin_task_bulk_import(text,text,integer),public.commit_task_bulk_import_chunk(uuid,jsonb),public.cancel_task_bulk_import(uuid),public.get_task_import_batch_status(uuid) from public,anon,service_role;
grant execute on function public.list_task_import_identity_candidates(),public.begin_task_bulk_import(text,text,integer),public.commit_task_bulk_import_chunk(uuid,jsonb),public.cancel_task_bulk_import(uuid),public.get_task_import_batch_status(uuid) to authenticated;
notify pgrst,'reload schema';
