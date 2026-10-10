-- Bounded task pages, audited administration, and imported Task evidence.
set search_path = public, extensions;

alter table public.task_instances add column deleted_at timestamptz;
alter table public.task_templates add column deleted_at timestamptz;
alter table public.task_import_row_registry add column retired_business_fingerprint text;
alter table public.task_import_batches add column retired_import_hash text;

create index idx_tasks_live_tenant_deadline on public.task_instances
  (tenant_id, (coalesce(revised_datetime,due_datetime,planned_datetime)), id)
  where deleted_at is null;
create index idx_tasks_live_creator on public.task_instances(tenant_id,created_by,id) where deleted_at is null;
create policy task_instances_not_deleted on public.task_instances as restrictive
  for select to authenticated using (deleted_at is null);
create policy task_templates_not_deleted on public.task_templates as restrictive
  for select to authenticated using (deleted_at is null);

create or replace function public.can_read_task(p_task_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select current_profile_is_active() and exists (
    select 1 from task_instances ti where ti.id=p_task_id
    and ti.tenant_id=current_tenant_id() and ti.deleted_at is null
    and (has_permission('tasks.view_all') or has_permission('tasks.manage_team') or ti.created_by=(current_profile()).id
      or is_task_participant(ti.id) or is_task_watcher(ti.id))
  );
$$;

-- Resolve actor once, aggregate narrow records once, and hydrate only a page.
-- This definer read applies the same tenant/participation boundary explicitly;
-- it never returns a caller-selected user's scope.
create function public.task_feed_page(p_view text,p_status text,p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_actor user_profiles:=public.current_profile();
  v_admin boolean:=public.has_permission('tasks.view_all');
  v_manager boolean:=public.has_permission('tasks.manage_team');
  v_start timestamptz:=date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_end timestamptz:=v_start+interval '1 day';
  v_result jsonb;
begin
  perform public.assert_module_access('tasks');
  if v_actor.id is null or not public.current_profile_is_active() then
    raise exception 'Task page access denied' using errcode='42501';
  end if;
  if p_view not in ('mine','delegated','inLoop','all') or p_view is null
    or p_status not in ('pending','overdue','completed') or p_status is null
    or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Invalid task page' using errcode='22023';
  end if;
  if p_view='all' and not v_admin then raise exception 'All tasks access denied' using errcode='42501'; end if;
  with ordinary as (
    select t.id,t.status,t.task_type,t.task_template_id,t.created_by,
      coalesce(t.revised_datetime,t.due_datetime,t.planned_datetime) deadline,
      exists(select 1 from task_assignees a where a.task_instance_id=t.id
        and a.user_profile_id=v_actor.id and a.is_active and a.role_at_task='doer') assigned,
      exists(select 1 from task_watchers w where w.task_instance_id=t.id and w.user_profile_id=v_actor.id) watched,
      t.status='blocked' and not exists(select 1 from task_assignees a where a.task_instance_id=t.id and a.is_active and a.role_at_task='doer') coverage
    from task_instances t where t.tenant_id=v_actor.tenant_id and t.deleted_at is null
      and (v_admin or v_manager or t.created_by=v_actor.id
        or exists(select 1 from task_assignees a where a.task_instance_id=t.id and a.user_profile_id=v_actor.id and a.is_active)
        or exists(select 1 from task_watchers w where w.task_instance_id=t.id and w.user_profile_id=v_actor.id))
  ), workflow as (
    select s.id,s.status,'fms'::task_type task_type,null::uuid task_template_id,i.started_by created_by,
      s.planned_datetime deadline,v_actor.id=any(s.assigned_to) assigned,false watched,false coverage
    from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id
    where i.tenant_id=v_actor.tenant_id and public.module_accessible('fms',false)
      and public.can_read_fms_instance(i.id)
    union all
    select s.id,'pending'::task_status,'fms'::task_type,null::uuid,s.assigned_by,s.created_at,
      s.user_profile_id=v_actor.id,false,false
    from fms_starter_assignments s where s.tenant_id=v_actor.tenant_id and s.status='pending'
      and public.module_accessible('fms',false) and (v_admin or s.user_profile_id=v_actor.id or s.assigned_by=v_actor.id)
  ), scoped as materialized (
    select *,case when status='completed' then 'completed'
      when status='overdue' or deadline<now() then 'overdue' else 'pending' end bucket
    from (select * from ordinary union all select * from workflow) t
    where (p_view='all'
      or (p_view='inLoop' and watched and not assigned)
      or (p_view='mine' and not (watched and not assigned)
        and (assigned or (v_manager and coverage)) and (v_admin or task_template_id is not null or task_type='fms'))
      or (p_view='delegated' and not (watched and not assigned)
        and case when v_admin then created_by=v_actor.id else assigned and task_template_id is null and task_type<>'fms' end))
    and (p_view='all' or
      (task_type='fms' and status in ('pending','in_progress','in_review','overdue')) or
      (task_type<>'fms' and (deadline>=v_start and deadline<v_end
        or (status not in ('completed','rejected','blocked') and (deadline<v_start or (deadline>=v_end and task_template_id is null))))))
  ), page as (
    select id,deadline from scoped where bucket=p_status
    order by deadline desc nulls last,id desc limit p_limit offset p_offset
  )
  select jsonb_build_object('ids',coalesce((select jsonb_agg(id order by deadline desc nulls last,id desc) from page),'[]'::jsonb),
    'total',(select count(*) from scoped where bucket=p_status),
    'counts',jsonb_build_object('pending',count(*) filter(where bucket='pending'),
      'overdue',count(*) filter(where bucket='overdue'),'completed',count(*) filter(where bucket='completed'),
      'open',count(*) filter(where bucket<>'completed')))
  into v_result from scoped;
  return v_result;
end;
$$;

-- Registered proof must refer to a real object in this task's private scope.
-- Covers generic completion, form completion and direct writes as well as UI.
create function public.guard_task_lifecycle_and_import_proof()
returns trigger language plpgsql security definer set search_path=public,storage as $$
declare v_imported boolean; v_deleted timestamptz;
begin
  if tg_op='UPDATE' and old.deleted_at is not null then
    raise exception 'Deleted tasks cannot be changed' using errcode='22023';
  end if;
  if new.task_template_id is not null then
    select deleted_at into v_deleted from task_templates where id=new.task_template_id for share;
    if v_deleted is not null and (tg_op='INSERT' or new.deleted_at is null) then
      raise exception 'Deleted schedules cannot generate tasks' using errcode='22023';
    end if;
  end if;
  v_imported:=new.source='bulk_import' or exists(select 1 from task_import_row_registry r
    where r.task_template_id=new.task_template_id) or exists(select 1 from task_instances sibling where sibling.task_template_id=new.task_template_id and sibling.source='bulk_import');
  if v_imported and new.task_type='delegation' then
    if new.status<>'completed' then new.requires_upload:=true; end if;
    if new.status='completed' and (tg_op='INSERT' or old.status<>'completed') and not exists(
      select 1 from task_attachments a join storage.objects o on o.bucket_id='task-attachments' and o.name=a.file_url
      where a.task_instance_id=new.id and o.name like new.tenant_id::text||'/'||new.id::text||'/%'
        and coalesce(o.metadata->>'mimetype','') in ('image/jpeg','image/png','image/webp','application/pdf')
        and coalesce((o.metadata->>'size')::bigint,0) between 1 and 10485760
    ) then raise exception 'A required upload is missing' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;
create trigger task_lifecycle_and_import_proof before insert or update on public.task_instances
  for each row execute function public.guard_task_lifecycle_and_import_proof();

create function public.guard_deleted_task_template()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.deleted_at is not null then raise exception 'Deleted schedules cannot be changed' using errcode='22023'; end if;
  return new;
end;
$$;
create trigger deleted_task_template before update on public.task_templates
  for each row execute function public.guard_deleted_task_template();

create function public.admin_edit_task_with_audit(p_task_id uuid,p_payload jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles:=public.current_profile(); v_old task_instances; v_new task_instances; v_previous text;
begin
  perform public.assert_module_access('tasks');
  if v_actor.id is null or not current_profile_is_active() or not has_permission('tasks.view_all') then
    raise exception 'Task administration denied' using errcode='42501'; end if;
  select * into v_old from task_instances where id=p_task_id and tenant_id=v_actor.tenant_id and deleted_at is null for update;
  if v_old.id is null then raise exception 'Task administration denied' using errcode='42501'; end if;
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or p_payload='{}'::jsonb
    or p_payload-array['title','description','priority','planned_datetime','due_datetime']<>'{}'::jsonb
    or (p_payload ? 'title' and (jsonb_typeof(p_payload->'title')<>'string' or length(btrim(p_payload->>'title')) not between 1 and 300))
    or (p_payload ? 'description' and jsonb_typeof(p_payload->'description') not in ('string','null'))
    or length(coalesce(p_payload->>'description',''))>10000
    or (p_payload ? 'priority' and (p_payload->>'priority' is null or p_payload->>'priority' not in ('low','medium','high')))
    or (p_payload ? 'planned_datetime' and nullif(p_payload->>'planned_datetime','') is null)
    or (p_payload ? 'due_datetime' and nullif(p_payload->>'due_datetime','') is null) then
    raise exception 'Invalid task edit' using errcode='22023'; end if;
  v_previous:=current_setting('jewelos.admin_task_actor',true);
  perform set_config('jewelos.admin_task_actor',v_actor.id::text,true);
  update task_instances set title=case when p_payload ? 'title' then btrim(p_payload->>'title') else title end,
    description=case when p_payload ? 'description' then nullif(btrim(p_payload->>'description'),'') else description end,
    priority=case when p_payload ? 'priority' then (p_payload->>'priority')::task_priority else priority end,
    planned_datetime=case when p_payload ? 'planned_datetime' then (p_payload->>'planned_datetime')::timestamptz else planned_datetime end,
    due_datetime=case when p_payload ? 'due_datetime' then (p_payload->>'due_datetime')::timestamptz else due_datetime end,
    revised_datetime=case when p_payload ? 'due_datetime' then null else revised_datetime end,
    updated_by=v_actor.id,updated_at=now() where id=p_task_id returning * into v_new;
  perform set_config('jewelos.admin_task_actor',coalesce(v_previous,''),true);
  if v_new.due_datetime<v_new.planned_datetime then raise exception 'Due time must follow start time' using errcode='22023'; end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(v_actor.tenant_id,v_actor.id,'task_admin_edited','tasks',p_task_id,to_jsonb(v_old),to_jsonb(v_new));
end;
$$;

create function public.delete_task_lifecycle_with_audit(p_task_id uuid,p_entire_series boolean default false,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public,extensions as $$
declare
  v_actor user_profiles:=public.current_profile(); v_old task_instances; v_template task_templates;
  v_ids uuid[]; v_batches uuid[]; v_removed integer; v_preserved integer:=0; v_previous text;
begin
  perform public.assert_module_enabled('tasks');
  if v_actor.id is null or not current_profile_is_active() or not has_permission('tasks.view_all') then
    raise exception 'Task administration denied' using errcode='42501'; end if;
  if p_entire_series is null or length(coalesce(p_reason,''))>1000 then raise exception 'Invalid deletion request' using errcode='22023'; end if;
  -- Lock the series first, matching materialization's lock order, then tasks.
  select * into v_old from task_instances where id=p_task_id and tenant_id=v_actor.tenant_id and deleted_at is null;
  if v_old.id is null then raise exception 'Task administration denied' using errcode='42501'; end if;
  if p_entire_series then
    if v_old.task_template_id is null then raise exception 'This task has no recurring series' using errcode='22023'; end if;
    select * into v_template from task_templates where id=v_old.task_template_id and tenant_id=v_actor.tenant_id and deleted_at is null for update;
    if v_template.id is null then raise exception 'Series is not available' using errcode='22023'; end if;
  end if;
  perform 1 from task_instances where id=p_task_id for update;
  if p_entire_series then
    perform 1 from task_instances where task_template_id=v_template.id and deleted_at is null order by id for update;
    select coalesce(array_agg(id),'{}'::uuid[]),count(*) filter(where status='completed')
      into v_ids,v_preserved from task_instances where task_template_id=v_template.id and deleted_at is null and status<>'completed';
    -- Historical completions remain visible and attached to the same template.
    select count(*) into v_preserved from task_instances where task_template_id=v_template.id and status='completed';
  else v_ids:=array[p_task_id]; end if;
  v_previous:=current_setting('jewelos.admin_task_actor',true);
  perform set_config('jewelos.admin_task_actor',v_actor.id::text,true);
  update task_instances set deleted_at=now(),updated_by=v_actor.id,updated_at=now() where id=any(v_ids);
  get diagnostics v_removed=row_count;
  perform set_config('jewelos.admin_task_actor',coalesce(v_previous,''),true);
  if p_entire_series then
    update task_templates set is_active=false,deleted_at=now(),updated_by=v_actor.id,updated_at=now() where id=v_template.id;
  end if;
  -- Closing alerts is driven by the durable deletion, without erasing history.
  update notifications set is_read=true,read_at=coalesce(read_at,now())
    where tenant_id=v_actor.tenant_id and source_record_id=any(v_ids) and not is_read;
  select coalesce(array_agg(distinct batch_id),'{}'::uuid[]) into v_batches from task_import_items
    where tenant_id=v_actor.tenant_id and ((task_instance_id=any(v_ids) and task_template_id is null) or (p_entire_series and task_template_id=v_template.id));
  select coalesce(array_agg(distinct batch_id),'{}'::uuid[]) into v_batches from (
    select unnest(v_batches) batch_id union select source_ref_id from task_instances
      where tenant_id=v_actor.tenant_id and id=any(v_ids) and source='bulk_import' and source_ref_id is not null
        and (p_entire_series or task_template_id is null)
  ) affected;
  update task_import_row_registry set retired_business_fingerprint=business_fingerprint,
    business_fingerprint=encode(digest(business_fingerprint||id::text,'sha256'),'hex')
    where tenant_id=v_actor.tenant_id and retired_business_fingerprint is null
      and ((not p_entire_series and task_instance_id=p_task_id and task_template_id is null)
        or (p_entire_series and task_template_id=v_template.id));
  update task_import_batches set retired_import_hash=import_hash,
    import_hash=encode(digest(import_hash||id::text,'sha256'),'hex')
    where tenant_id=v_actor.tenant_id and id=any(v_batches) and retired_import_hash is null;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(v_actor.tenant_id,v_actor.id,'task_admin_deleted','tasks',p_task_id,to_jsonb(v_old),
      jsonb_build_object('entire_series',p_entire_series,'template_id',v_template.id,'removed',v_removed,
        'task_ids',v_ids,'completed_preserved',v_preserved,'reason',nullif(btrim(p_reason),''),'batch_ids',v_batches));
  return jsonb_build_object('removed',v_removed,'completed_preserved',v_preserved);
end;
$$;
create function public.admin_delete_task_with_audit(p_task_id uuid,p_entire_series boolean default false,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.assert_module_access('tasks');
  return public.delete_task_lifecycle_with_audit(p_task_id,p_entire_series,p_reason);
end;
$$;
revoke all on function public.delete_task_lifecycle_with_audit(uuid,boolean,text) from public,anon,authenticated,service_role;

-- Preserve source fingerprints; change persisted requirements after the existing
-- validated import/replay transaction, including the initial generated task.
create function public.enforce_imported_task_proof(p_actor_id uuid)
returns integer language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_row record; v_count integer:=0;
begin
  select * into v_actor from user_profiles where id=p_actor_id;
  if v_actor.id is null then raise exception 'Import actor missing' using errcode='42501'; end if;
  for v_row in
    update task_templates t set requires_upload=true,updated_by=v_actor.id,updated_at=now()
      where t.tenant_id=v_actor.tenant_id and t.deleted_at is null and t.task_type='delegation' and not t.requires_upload
        and (exists(select 1 from task_import_row_registry r where r.task_template_id=t.id) or exists(select 1 from task_import_items i where i.task_template_id=t.id))
      returning t.id
  loop
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_actor.tenant_id,v_actor.id,'imported_task_proof_required','task_templates',v_row.id,
        '{"requires_upload":false}','{"requires_upload":true}'); v_count:=v_count+1;
  end loop;
  for v_row in
    update task_instances t set requires_upload=true,updated_by=v_actor.id,updated_at=now()
      where t.tenant_id=v_actor.tenant_id and t.deleted_at is null and t.status<>'completed'
        and t.task_type='delegation' and not t.requires_upload
        and (t.source='bulk_import' or exists(select 1 from task_import_row_registry r where r.task_template_id=t.task_template_id) or exists(select 1 from task_import_items i where i.task_template_id=t.task_template_id))
      returning t.id
  loop
    insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(v_actor.tenant_id,v_actor.id,'imported_task_proof_required','tasks',v_row.id,
        '{"requires_upload":false}','{"requires_upload":true}'); v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
alter function public.commit_task_bulk_import_chunk(uuid,jsonb) rename to commit_task_bulk_import_chunk_v0208;
revoke all on function public.commit_task_bulk_import_chunk_v0208(uuid,jsonb) from public,anon,authenticated,service_role;
create function public.commit_task_bulk_import_chunk(p_batch_id uuid,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles:=public.task_import_actor(); v_result jsonb;
begin
  perform public.assert_module_enabled('tasks');
  v_result:=public.commit_task_bulk_import_chunk_v0208(p_batch_id,p_rows);
  return v_result||jsonb_build_object('task_proof_corrected_count',public.enforce_imported_task_proof(v_actor.id));
end;
$$;
do $$ declare v_actor uuid; begin
  for v_actor in select distinct coalesce(t.created_by,t.updated_by) from task_templates t
    where exists(select 1 from task_import_row_registry r where r.task_template_id=t.id)
    union select distinct coalesce(t.created_by,t.updated_by) from task_instances t where t.source='bulk_import'
  loop if v_actor is not null then perform public.enforce_imported_task_proof(v_actor); end if; end loop;
end; $$;

revoke all on function public.task_feed_page(text,text,integer,integer),
  public.admin_edit_task_with_audit(uuid,jsonb),public.admin_delete_task_with_audit(uuid,boolean,text),
  public.commit_task_bulk_import_chunk(uuid,jsonb) from public,anon,service_role;
grant execute on function public.task_feed_page(text,text,integer,integer),
  public.admin_edit_task_with_audit(uuid,jsonb),public.admin_delete_task_with_audit(uuid,boolean,text),
  public.commit_task_bulk_import_chunk(uuid,jsonb) to authenticated;
revoke all on function public.guard_task_lifecycle_and_import_proof(),public.guard_deleted_task_template(),
  public.enforce_imported_task_proof(uuid) from public,anon,authenticated,service_role;

-- Retained canonical/legacy import routes use the same mandatory proof policy.
CREATE OR REPLACE FUNCTION public.import_task_bulk_with_audit(p_payload jsonb, p_import_hash text, p_file_label text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_actor user_profiles; v_check jsonb; v_row jsonb; v_batch task_import_batches; v_doers uuid[]; v_watchers uuid[]; v_primary uuid; v_payload jsonb; v_rrule text; v_once integer:=0; v_rec integer:=0; v_task uuid; v_template uuid; v_row_number integer:=1;
begin
  perform public.assert_module_enabled('checklist_tasks');
 select * into v_actor from current_profile(); v_check:=task_bulk_import_validation(p_payload,p_import_hash); if not coalesce((v_check->>'valid')::boolean,false) then raise exception 'Bulk import validation failed' using errcode='22023'; end if;
 if coalesce(p_file_label,'') !~ '^[A-Za-z0-9._ -]{1,120}$' then raise exception 'File label is unsafe' using errcode='22023'; end if;
 select * into v_batch from task_import_batches where tenant_id=v_actor.tenant_id and import_hash=p_import_hash for update; if v_batch.id is not null then return jsonb_build_object('batch_id',v_batch.id,'replayed',true,'outcome',v_batch.outcome,'created_count',v_batch.created_count); end if;
 insert into task_import_batches(tenant_id,created_by,import_hash,source_headers,requested_count,valid_count,error_count,one_time_count,recurring_count,initial_instance_count,safe_file_label,outcome,validated_at,completed_at) values(v_actor.tenant_id,v_actor.id,p_import_hash,array['task_bulk_import'],jsonb_array_length(p_payload->'tasks'),jsonb_array_length(p_payload->'tasks'),0,(v_check->'summary'->>'one_time_count')::int,(v_check->'summary'->>'recurring_count')::int,(v_check->'summary'->>'initial_instance_count')::int,p_file_label,'completed',now(),now()) returning * into v_batch;
 for v_row in select value from jsonb_array_elements(p_payload->'tasks') loop
  select array_agg(id order by id) into v_doers from user_profiles where tenant_id=v_actor.tenant_id and lower(email)=any(array(select lower(jsonb_array_elements_text(coalesce(v_row->'doer_emails','[]')))));
  select array_agg(id order by id) into v_watchers from user_profiles where tenant_id=v_actor.tenant_id and lower(email)=any(array(select lower(jsonb_array_elements_text(coalesce(v_row->'watcher_emails','[]')))));
  if v_row->>'task_mode'='one_time' then v_payload:=jsonb_build_object('title',v_row->>'title','description',nullif(v_row->>'description',''),'planned_datetime',v_row->>'planned_at','priority',coalesce(nullif(v_row->>'priority',''),'medium'),'branch_id',(select id from branches where tenant_id=v_actor.tenant_id and (lower(name)=lower(v_row->>'branch') or lower(code)=lower(v_row->>'branch')) limit 1),'department_id',null,'category_id',(select id from dropdown_masters where tenant_id=v_actor.tenant_id and master_type='task_category' and (lower(label)=lower(v_row->>'category') or lower(value)=lower(v_row->>'category')) limit 1),'requires_upload',true,'requires_remark',coalesce((v_row->>'requires_remark')::boolean,false),'requires_form',nullif(v_row->>'published_form','') is not null,'form_template_id',(select id from form_templates where tenant_id=v_actor.tenant_id and lower(name)=lower(v_row->>'published_form') limit 1)); v_task:=create_delegation_task_with_audit(v_payload,v_doers,coalesce(v_watchers,'{}'),coalesce(v_row->'checklist','[]')); update task_instances set source='bulk_import',source_ref_id=v_batch.id,requires_upload=true where id=v_task; v_once:=v_once+1; else select id into v_primary from user_profiles where tenant_id=v_actor.tenant_id and lower(email)=lower(v_row->>'primary_doer_email'); v_rrule:='RRULE:FREQ='||case v_row->>'recurrence_kind' when 'daily' then 'DAILY' when 'weekly' then 'WEEKLY' else 'MONTHLY' end||';INTERVAL='||coalesce(v_row->>'recurrence_interval','1'); if v_row->>'recurrence_kind'='weekly' then v_rrule:=v_rrule||';BYDAY='||replace(replace(replace(replace(replace(replace(replace(array_to_string(array(select jsonb_array_elements_text(v_row->'weekly_days')),','),'MON','MO'),'TUE','TU'),'WED','WE'),'THU','TH'),'FRI','FR'),'SAT','SA'),'SUN','SU'); end if; if v_row->>'recurrence_kind'='monthly_day' then v_rrule:=v_rrule||';BYMONTHDAY='||(v_row->>'monthly_day'); end if; if v_row->>'recurrence_kind'='monthly_nth' then v_rrule:=v_rrule||';BYDAY='||(v_row->>'monthly_nth')||replace(replace(replace(replace(replace(replace(replace(v_row->>'monthly_weekday','MON','MO'),'TUE','TU'),'WED','WE'),'THU','TH'),'FRI','FR'),'SAT','SA'),'SUN','SU'); end if; v_template:=save_task_template_with_audit(null,jsonb_build_object('title',v_row->>'title','description',nullif(v_row->>'description',''),'recurrence_rule',v_rrule,'planned_time',substring(v_row->>'planned_at' from 12 for 5),'priority',coalesce(nullif(v_row->>'priority',''),'medium'),'requires_upload',true,'requires_remark',coalesce((v_row->>'requires_remark')::boolean,false),'requires_form',false,'form_template_id',null,'default_assignee_type','specific_user','default_assignee_user_id',v_primary,'default_assignee_role',null,'branch_id',v_actor.branch_id,'department_id',null,'category_id',(select id from dropdown_masters where tenant_id=v_actor.tenant_id and master_type='task_category' order by sort_order limit 1),'checklist_items',coalesce(v_row->'checklist','[]'),'is_active',true,'initial_planned_datetime',v_row->>'planned_at')); update task_templates set task_type='delegation',requires_upload=true where id=v_template; update task_instances set task_type='delegation',source='bulk_import',source_ref_id=v_batch.id,requires_upload=true where task_template_id=v_template; v_rec:=v_rec+1; end if;
 v_row_number:=v_row_number+1; insert into task_import_items(tenant_id,batch_id,source_row,row_hash,destination,outcome,task_instance_id,task_template_id) values(v_actor.tenant_id,v_batch.id,v_row_number,encode(extensions.digest(v_row::text,'sha256'),'hex'),case when v_row->>'task_mode'='one_time' then 'tasks' else 'recurring_todo' end,'created',v_task,v_template); v_task:=null; v_template:=null;
 end loop;
 update task_import_batches set created_count=v_once+v_rec where id=v_batch.id; insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'task_bulk_imported','task_import_batches',v_batch.id,jsonb_build_object('one_time_count',v_once,'recurring_count',v_rec,'import_hash',p_import_hash)); return jsonb_build_object('batch_id',v_batch.id,'created_count',v_once+v_rec,'replayed',false,'outcome','completed');
end $function$;


CREATE OR REPLACE FUNCTION public.import_delegation_tasks_with_audit(p_rows jsonb, p_import_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor user_profiles;
  v_row jsonb;
  v_batch task_import_batches;
  v_task_id uuid;
  v_doer_id uuid;
  v_name_id uuid;
  v_email_id uuid;
  v_name_count integer;
  v_email_count integer;
  v_branch_id uuid;
  v_department_id uuid;
  v_payload jsonb;
  v_checklist jsonb;
  v_headers text[];
  v_requested integer;
  v_created integer := 0;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin', 'admin', 'manager') then
    raise exception 'Task import denied' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 500 then
    raise exception 'Task import must contain 1 to 500 rows' using errcode = '22023';
  end if;
  if coalesce(p_import_hash, '') !~ '^[a-f0-9]{64}$' then
    raise exception 'Task import hash is invalid' using errcode = '22023';
  end if;

  select * into v_batch from task_import_batches
  where tenant_id = v_actor.tenant_id and import_hash = p_import_hash;
  if v_batch.id is not null then
    return jsonb_build_object('batch_id', v_batch.id, 'created_count', v_batch.created_count, 'rejected_count', v_batch.rejected_count, 'replayed', true);
  end if;

  select coalesce(array_agg(key order by key), '{}'::text[])
  into v_headers
  from jsonb_object_keys(p_rows -> 0) key;
  v_requested := jsonb_array_length(p_rows);
  insert into task_import_batches(tenant_id, created_by, import_hash, source_headers, requested_count)
  values (v_actor.tenant_id, v_actor.id, p_import_hash, v_headers, v_requested)
  returning * into v_batch;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object'
       or v_row - array['title','doer_name','doer_email','description','due_at','priority','branch','department','checklist','frequency','source_rows'] <> '{}'::jsonb then
      raise exception 'Task import row contains unsupported fields' using errcode = '22023';
    end if;
    if nullif(btrim(v_row ->> 'title'), '') is null or length(btrim(v_row ->> 'title')) > 200 then
      raise exception 'Task import title must contain 1 to 200 characters' using errcode = '22023';
    end if;
    if coalesce(nullif(lower(btrim(v_row ->> 'frequency')), ''), 'once') <> 'once' then
      raise exception 'Recurring task imports are not available yet' using errcode = '22023';
    end if;
    if nullif(btrim(v_row ->> 'doer_name'), '') is null and nullif(lower(btrim(v_row ->> 'doer_email')), '') is null then
      raise exception 'Task import doer is required' using errcode = '22023';
    end if;

    select count(*), (array_agg(id order by id))[1] into v_name_count, v_name_id
    from user_profiles
    where tenant_id = v_actor.tenant_id and working_status = 'active' and is_login_enabled
      and nullif(btrim(v_row ->> 'doer_name'), '') is not null
      and lower(btrim(employee_name)) = lower(btrim(v_row ->> 'doer_name'));
    select count(*), (array_agg(id order by id))[1] into v_email_count, v_email_id
    from user_profiles
    where tenant_id = v_actor.tenant_id and working_status = 'active' and is_login_enabled
      and nullif(lower(btrim(v_row ->> 'doer_email')), '') is not null
      and lower(btrim(email)) = lower(btrim(v_row ->> 'doer_email'));
    if (nullif(btrim(v_row ->> 'doer_name'), '') is not null and v_name_count <> 1)
       or (nullif(lower(btrim(v_row ->> 'doer_email')), '') is not null and v_email_count <> 1)
       or (v_name_id is not null and v_email_id is not null and v_name_id <> v_email_id) then
      raise exception 'Task import doer is unresolved or ambiguous' using errcode = '23503';
    end if;
    v_doer_id := coalesce(v_name_id, v_email_id);

    v_branch_id := v_actor.branch_id;
    if nullif(btrim(v_row ->> 'branch'), '') is not null then
      select id into v_branch_id from branches
      where tenant_id = v_actor.tenant_id and is_active
        and (lower(btrim(name)) = lower(btrim(v_row ->> 'branch')) or lower(btrim(code)) = lower(btrim(v_row ->> 'branch')));
    end if;
    v_department_id := v_actor.department_id;
    if nullif(btrim(v_row ->> 'department'), '') is not null then
      select id into v_department_id from departments
      where tenant_id = v_actor.tenant_id and is_active and branch_id = v_branch_id
        and (lower(btrim(name)) = lower(btrim(v_row ->> 'department')) or lower(btrim(code)) = lower(btrim(v_row ->> 'department')));
    end if;
    if jsonb_typeof(coalesce(v_row -> 'checklist', '[]'::jsonb)) <> 'array' then
      raise exception 'Task import checklist is invalid' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('item_text', btrim(value), 'is_required', true, 'sort_order', ordinality - 1) order by ordinality), '[]'::jsonb)
    into v_checklist
    from jsonb_array_elements_text(coalesce(v_row -> 'checklist', '[]'::jsonb)) with ordinality items(value, ordinality)
    where nullif(btrim(value), '') is not null;
    v_payload := jsonb_build_object(
      'title', btrim(v_row ->> 'title'),
      'description', nullif(btrim(v_row ->> 'description'), ''),
      'planned_datetime', coalesce(nullif(btrim(v_row ->> 'due_at'), ''), now()::text),
      'priority', coalesce(nullif(lower(btrim(v_row ->> 'priority')), ''), 'medium'),
      'branch_id', v_branch_id,
      'department_id', v_department_id,
      'requires_upload', true,
      'requires_remark', false,
      'requires_form', false,
      'form_template_id', null
    );
    v_task_id := create_delegation_task_with_audit(v_payload, array[v_doer_id], '{}'::uuid[], v_checklist);
    update task_instances set source='bulk_import',source_ref_id=v_batch.id where id=v_task_id;
    v_created := v_created + 1;
  end loop;

  update task_import_batches set created_count = v_created where id = v_batch.id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'delegation_tasks_imported', 'task_import_batches', v_batch.id,
    jsonb_build_object('requested_count', v_requested, 'created_count', v_created, 'import_hash', p_import_hash));
  return jsonb_build_object('batch_id', v_batch.id, 'created_count', v_created, 'rejected_count', 0, 'replayed', false);
exception
  when invalid_text_representation or datetime_field_overflow then
    raise exception 'Task import contains an invalid date, priority, or identifier' using errcode = '22023';
end;
$function$;


CREATE OR REPLACE FUNCTION public.reject_watcher_task_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_task_id uuid;
  v_actor_id uuid;
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'task_instances' then
    v_task_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_task_id := case when tg_op = 'DELETE' then old.task_instance_id else new.task_instance_id end;
  end if;
  select id into v_actor_id from public.current_profile();
  if tg_table_name='task_instances' and tg_op='UPDATE'
    and current_setting('jewelos.admin_task_actor',true)=v_actor_id::text
    and public.has_permission('tasks.view_all')
    and to_jsonb(old)-array['title','description','priority','planned_datetime','due_datetime','revised_datetime','deleted_at','updated_by','updated_at']
      =to_jsonb(new)-array['title','description','priority','planned_datetime','due_datetime','revised_datetime','deleted_at','updated_by','updated_at'] then
    return new;
  end if;
  if v_actor_id is not null
     and exists (
       select 1 from public.task_watchers w
       where w.task_instance_id = v_task_id and w.user_profile_id = v_actor_id
     )
     and not exists (
       select 1 from public.task_assignees a
       where a.task_instance_id = v_task_id and a.user_profile_id = v_actor_id
         and a.role_at_task = 'doer' and a.is_active
     ) then
    raise exception 'In Loop participants may only view and comment on this task' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;


CREATE OR REPLACE FUNCTION public.can_write_task_attachment_object(p_name text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
declare
  v_task_id uuid;
  v_task_tenant uuid;
begin
  if not current_profile_is_active()
     or (storage.foldername(p_name))[1] <> current_tenant_id()::text then
    return false;
  end if;
  v_task_id := (storage.foldername(p_name))[2]::uuid;
  select tenant_id into v_task_tenant from task_instances where id = v_task_id and deleted_at is null;
  if v_task_tenant is distinct from current_tenant_id() then return false; end if;
  if is_task_watcher(v_task_id) and not is_task_participant(v_task_id) then return false; end if;
  return current_role_level() in ('super_admin', 'admin', 'manager')
    or is_task_participant(v_task_id);
exception when invalid_text_representation or array_subscript_error then
  return false;
end;
$function$;



create function public.reject_deleted_task_child_write()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from task_instances where id=new.task_instance_id and deleted_at is not null) then
    raise exception 'Deleted tasks cannot be changed' using errcode='22023';
  end if;
  return new;
end;
$$;
do $$ declare v_table text; begin
  foreach v_table in array array['task_assignees','task_checklists','task_attachments','task_comments','task_revisions','task_watchers'] loop
    execute format('create trigger deleted_task_child_write before insert or update on public.%I for each row execute function public.reject_deleted_task_child_write()',v_table);
  end loop;
end; $$;
revoke all on function public.reject_deleted_task_child_write() from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
