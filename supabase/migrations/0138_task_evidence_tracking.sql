-- Task evidence tracking: authoritative attachment metadata, registration
-- hardened against the uploaded Storage object, authorized signed-URL
-- resolution, and a read-only evidence workspace for operational oversight.
set search_path=public,extensions;

alter table public.task_attachments
  add column if not exists original_filename text,
  add column if not exists mime_type text,
  add column if not exists size_bytes bigint;

-- The bucket previously rejected image/webp while the recurring-image completion
-- contract accepted it, so a WebP upload could never reach registration. Align
-- the bucket with the types the registration contract permits.
update storage.buckets
   set allowed_mime_types=array['image/jpeg','image/png','image/webp','application/pdf']
 where id='task-attachments';

create index if not exists idx_task_attachments_task on public.task_attachments(task_instance_id);
create index if not exists idx_task_attachments_uploaded_by on public.task_attachments(uploaded_by, created_at desc);

-- Clients store an object as "<uuid>-<safe name>" to keep paths unique. Oversight
-- needs the name a person would recognise, so the collision prefix is stripped.
create or replace function public.task_attachment_display_name(p_storage_path text)
returns text language sql immutable set search_path=public as $$
  select nullif(regexp_replace(
    regexp_replace(p_storage_path,'^.*/',''),
    '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-','' ),'')
$$;

-- Existing rows predate metadata capture; recover what Storage still knows.
update public.task_attachments a set
  original_filename=coalesce(a.original_filename,public.task_attachment_display_name(o.name)),
  mime_type=coalesce(a.mime_type,o.metadata->>'mimetype'),
  size_bytes=coalesce(a.size_bytes,(o.metadata->>'size')::bigint)
from storage.objects o
where o.bucket_id='task-attachments' and o.name=a.file_url
  and (a.original_filename is null or a.mime_type is null or a.size_bytes is null);

-- Registration now proves the caller actually uploaded the object it names,
-- under its own tenant/task prefix, within the bucket's declared limits. The
-- recorded metadata comes from Storage rather than from the browser, so the
-- workspace below reports the file that exists, not a client-supplied claim.
create or replace function public.add_task_attachment_with_audit(p_task_id uuid, p_file_url text)
returns uuid language plpgsql security definer set search_path=public,storage as $$
declare v_actor user_profiles; v_id uuid; v_tenant uuid; v_path text; v_object storage.objects; v_mime text; v_size bigint;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  select tenant_id into v_tenant from task_instances where id=p_task_id;
  if v_actor.id is null or not current_profile_is_active() or v_tenant is null or v_tenant<>v_actor.tenant_id
     or not (v_actor.user_role in ('super_admin','admin','manager') or is_task_participant(p_task_id)) then
    raise exception 'Task is not accessible' using errcode='42501';
  end if;
  v_path:=btrim(p_file_url);
  select * into v_object from storage.objects where bucket_id='task-attachments' and name=v_path;
  if v_object.id is null or v_object.owner_id is distinct from auth.uid()::text then
    raise exception 'Uploaded object is not owned by the caller' using errcode='42501';
  end if;
  v_mime:=coalesce(v_object.metadata->>'mimetype','');
  v_size:=coalesce((v_object.metadata->>'size')::bigint,0);
  if v_path not like v_tenant::text||'/'||p_task_id::text||'/%' or v_path like '%..%'
     or v_mime not in ('image/jpeg','image/png','image/webp','application/pdf')
     or v_size not between 1 and 10485760 then
    raise exception 'Invalid task attachment metadata' using errcode='22023';
  end if;
  insert into task_attachments(task_instance_id,file_url,uploaded_by,original_filename,mime_type,size_bytes)
  values (p_task_id,v_path,v_actor.id,task_attachment_display_name(v_path),v_mime,v_size)
  returning id into v_id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values (v_actor.tenant_id,v_actor.id,'task_attachment_added','tasks',p_task_id,
    jsonb_build_object('attachment_id',v_id,'mime_type',v_mime,'size_bytes',v_size));
  return v_id;
end $$;

-- The recurring image path registers its own attachment row; keep its captured
-- metadata consistent with the hardened generic contract.
create or replace function public.complete_recurring_task_with_image_with_audit(p_task_id uuid,p_file_url text)
returns void language plpgsql security definer set search_path=public,storage as $$
declare v_actor public.user_profiles; v_task public.task_instances; v_object storage.objects; v_attachment uuid;
begin
 select * into v_actor from public.user_profiles where auth_user_id=auth.uid();
 select * into v_task from public.task_instances where id=p_task_id for update;
 if v_actor.id is null or not public.current_profile_is_active() or v_task.id is null or v_task.tenant_id<>v_actor.tenant_id or v_task.task_template_id is null or v_task.task_type<>'delegation' or v_task.status='completed' or not exists(select 1 from public.task_assignees where task_instance_id=p_task_id and user_profile_id=v_actor.id and is_active) then raise exception 'Recurring image task completion denied' using errcode='42501'; end if;
 select * into v_object from storage.objects where bucket_id='task-attachments' and name=btrim(p_file_url);
 if v_object.id is null or v_object.name !~ ('^'||v_task.tenant_id::text||'/'||v_task.id::text||'/') or coalesce(v_object.metadata->>'mimetype','') not in ('image/jpeg','image/png','image/webp') or coalesce((v_object.metadata->>'size')::bigint,0)>5242880 then raise exception 'Task completion requires a permitted image upload' using errcode='23514'; end if;
 insert into public.task_attachments(task_instance_id,file_url,uploaded_by,original_filename,mime_type,size_bytes)
 values(p_task_id,v_object.name,v_actor.id,task_attachment_display_name(v_object.name),v_object.metadata->>'mimetype',(v_object.metadata->>'size')::bigint)
 returning id into v_attachment;
 update public.task_instances set status='completed',actual_datetime=now(),updated_by=v_actor.id,updated_at=now() where id=p_task_id;
 update public.task_assignees set completed_at=now() where task_instance_id=p_task_id and is_active;
 insert into public.audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'recurring_task_image_completed','recurring_todo',p_task_id,jsonb_build_object('attachment_id',v_attachment));
end;
$$;

-- The atomic upload-completion path (0137) is the third contract that inserts an
-- attachment row. It must record the same Storage-derived metadata, or evidence
-- completed through it would appear nameless in the oversight workspace. Its
-- permitted types are widened to match the bucket and the other two paths.
create or replace function public.complete_uploaded_task_with_audit(p_task_id uuid,p_file_url text)
returns void language plpgsql security definer set search_path=public,storage as $$
declare v_actor user_profiles; v_old task_instances; v_new task_instances; v_object storage.objects; v_attachment uuid; v_path text;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid() and account_status='active' and is_login_enabled;
  select * into v_old from task_instances where id=p_task_id for update;
  if v_actor.id is null or v_old.id is null or v_old.tenant_id<>v_actor.tenant_id
     or not exists(select 1 from task_assignees where task_instance_id=p_task_id and user_profile_id=v_actor.id and role_at_task='doer' and is_active) then
    raise exception 'Task is not accessible to an active doer' using errcode='42501';
  end if;
  if v_old.status in ('completed','blocked') or not v_old.requires_upload then
    raise exception 'Task is not eligible for upload completion' using errcode='22023';
  end if;
  if exists(select 1 from task_checklists where task_instance_id=p_task_id and is_required and not is_completed) then
    raise exception 'Complete all required checklist items first' using errcode='23514';
  end if;
  if v_old.requires_form then
    raise exception 'The required task form submission is missing' using errcode='23514';
  end if;
  if v_old.requires_remark then
    raise exception 'A completion remark is required' using errcode='23514';
  end if;
  v_path:=btrim(p_file_url);
  select * into v_object from storage.objects where bucket_id='task-attachments' and name=v_path;
  if v_object.id is null or v_path not like v_old.tenant_id::text||'/'||p_task_id::text||'/%' or v_path like '%..%'
     or coalesce(v_object.metadata->>'mimetype','') not in ('image/jpeg','image/png','image/webp','application/pdf')
     or coalesce((v_object.metadata->>'size')::bigint,0) not between 1 and 10485760 then
    raise exception 'Invalid task attachment metadata' using errcode='22023';
  end if;
  insert into task_attachments(task_instance_id,file_url,uploaded_by,original_filename,mime_type,size_bytes)
  values(p_task_id,v_path,v_actor.id,task_attachment_display_name(v_path),
    v_object.metadata->>'mimetype',(v_object.metadata->>'size')::bigint)
  returning id into v_attachment;
  update task_instances set status='completed',actual_datetime=now(),updated_by=v_actor.id,updated_at=now()
  where id=p_task_id returning * into v_new;
  update task_assignees set completed_at=now() where task_instance_id=p_task_id and role_at_task='doer' and is_active;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'task_upload_completed','tasks',p_task_id,to_jsonb(v_old),to_jsonb(v_new)||jsonb_build_object('attachment_id',v_attachment));
end $$;

-- Signed-URL authorization: the browser names an attachment it may read, never
-- the Storage object path it wants opened.
create or replace function public.get_task_attachment_path(p_attachment_id uuid)
returns text language plpgsql stable security definer set search_path=public as $$
declare v_row public.task_attachments;
begin
  select * into v_row from public.task_attachments where id=p_attachment_id;
  if v_row.id is null or not public.current_profile_is_active() or not public.can_read_task(v_row.task_instance_id) then
    raise exception 'Attachment is not accessible' using errcode='42501';
  end if;
  return v_row.file_url;
end $$;

-- Read-only oversight workspace: what was uploaded, by whom, against which
-- task, and which upload-required tasks are still outstanding. Manager scope is
-- narrowed to the manager's own branch server-side.
create or replace function public.get_task_evidence_workspace(p_filter jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare
  v_actor user_profiles; v_from date; v_to date; v_branch uuid; v_department uuid;
  v_user uuid; v_search text; v_page integer; v_page_size integer; v_result jsonb;
begin
  select * into v_actor from user_profiles where auth_user_id=auth.uid();
  if v_actor.id is null or not current_profile_is_active()
     or v_actor.user_role not in ('super_admin','admin','manager','hr') then
    raise exception 'Task evidence workspace access denied' using errcode='42501';
  end if;
  v_from:=coalesce(nullif(p_filter->>'from','')::date,(now() at time zone 'Asia/Kolkata')::date-29);
  v_to:=coalesce(nullif(p_filter->>'to','')::date,(now() at time zone 'Asia/Kolkata')::date);
  if v_to<v_from or v_to-v_from>366 then raise exception 'Date range is invalid' using errcode='22023'; end if;
  v_branch:=nullif(p_filter->>'branch_id','')::uuid;
  v_department:=nullif(p_filter->>'department_id','')::uuid;
  v_user:=nullif(p_filter->>'user_profile_id','')::uuid;
  v_search:=lower(btrim(coalesce(p_filter->>'search','')));
  v_page:=greatest(1,coalesce(nullif(p_filter->>'page','')::integer,1));
  v_page_size:=least(100,greatest(10,coalesce(nullif(p_filter->>'page_size','')::integer,25)));
  if v_actor.user_role='manager' then
    if v_branch is not null and v_branch<>v_actor.branch_id then
      raise exception 'Branch is not authorized' using errcode='42501';
    end if;
    v_branch:=v_actor.branch_id;
  end if;

  with scope as materialized (
    select t.id as task_id,t.title,t.status,t.task_type,coalesce(t.requires_upload,false) as requires_upload,
      t.planned_datetime,t.actual_datetime,t.due_datetime,b.name as branch_name,d.name as department_name,
      (select string_agg(u.employee_name,', ' order by u.employee_name)
         from task_assignees a join user_profiles u on u.id=a.user_profile_id
        where a.task_instance_id=t.id and a.is_active) as assignee_names,
      exists(select 1 from task_attachments x where x.task_instance_id=t.id) as has_evidence
    from task_instances t
    left join branches b on b.id=t.branch_id
    left join departments d on d.id=t.department_id
    where t.tenant_id=v_actor.tenant_id
      and (t.planned_datetime at time zone 'Asia/Kolkata')::date between v_from and v_to
      and (v_branch is null or t.branch_id=v_branch)
      and (v_department is null or t.department_id=v_department)
      and (v_user is null or exists(select 1 from task_assignees a
            where a.task_instance_id=t.id and a.is_active and a.user_profile_id=v_user))
      and (v_search='' or lower(t.title||' '||coalesce(t.description,'')) like '%'||v_search||'%')
  ), files as (
    select a.id as attachment_id,a.created_at as uploaded_at,a.original_filename,a.mime_type,a.size_bytes,
      u.employee_name as uploaded_by_name,s.*
    from task_attachments a
    join scope s on s.task_id=a.task_instance_id
    left join user_profiles u on u.id=a.uploaded_by
  ), outstanding as (
    select * from scope where requires_upload and not has_evidence
  ), stats as (
    select jsonb_build_object(
      'tasks_total',count(*),
      'upload_tasks',count(*) filter(where requires_upload),
      'upload_tasks_with_evidence',count(*) filter(where requires_upload and has_evidence),
      'upload_tasks_awaiting_evidence',count(*) filter(where requires_upload and not has_evidence),
      'completed',count(*) filter(where status='completed'),
      'remaining',count(*) filter(where status<>'completed'),
      'overdue',count(*) filter(where status not in ('completed','rejected')
        and coalesce(due_datetime,planned_datetime)<now()),
      'evidence_files',(select count(*) from files),
      'evidence_bytes',(select coalesce(sum(size_bytes),0) from files)
    ) as value from scope
  ), evidence_page as (
    select * from files order by uploaded_at desc limit v_page_size offset (v_page-1)*v_page_size
  ), evidence as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'attachment_id',attachment_id,'task_id',task_id,'task_title',title,'task_type',task_type,
      'task_status',status,'requires_upload',requires_upload,'branch_name',branch_name,
      'department_name',department_name,'assignee_names',assignee_names,'uploaded_at',uploaded_at,
      'uploaded_by_name',uploaded_by_name,'original_filename',original_filename,'mime_type',mime_type,
      'size_bytes',size_bytes,'planned_datetime',planned_datetime,'actual_datetime',actual_datetime
    ) order by uploaded_at desc),'[]'::jsonb) as value from evidence_page
  ), outstanding_page as (
    select * from outstanding order by coalesce(due_datetime,planned_datetime) limit 100
  ), missing as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'task_id',task_id,'task_title',title,'task_status',status,'assignee_names',assignee_names,
      'branch_name',branch_name,'department_name',department_name,'planned_datetime',planned_datetime,
      'due_datetime',due_datetime,
      'overdue',status not in ('completed','rejected') and coalesce(due_datetime,planned_datetime)<now()
    ) order by coalesce(due_datetime,planned_datetime)),'[]'::jsonb) as value from outstanding_page
  )
  select jsonb_build_object(
    'filters',jsonb_build_object('from',v_from,'to',v_to,'branch_id',v_branch,'department_id',v_department,
      'user_profile_id',v_user,'search',v_search,'page',v_page,'page_size',v_page_size),
    'stats',stats.value,
    'evidence',evidence.value,
    'evidence_total',(select count(*) from files),
    'missing',missing.value,
    'missing_total',(select count(*) from outstanding))
  into v_result from stats,evidence,missing;
  return v_result;
end $$;

-- The section maintenance contract must know the new route, or the merged
-- availability object the browser validates would be missing its key.
create or replace function default_section_availability()
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'home', true, 'dashboard', true, 'crm', true, 'checklist_tasks', true,
    'recurring_todo', true, 'task_templates', true, 'task_evidence', true,
    'delegation_tasks', true, 'fms_tasks', true, 'fms_builder', true,
    'forms_library', true, 'meeting_ai', true, 'notifications', true,
    'users', true, 'availability', true, 'reports', true,
    'dropdown_master', true, 'settings', true
  );
$$;

create or replace function validated_section_availability(p_availability jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare v_key text;
begin
  perform assert_json_keys(p_availability, array[
    'home','dashboard','crm','checklist_tasks','recurring_todo','task_templates',
    'task_evidence','delegation_tasks','fms_tasks','fms_builder','forms_library',
    'meeting_ai','notifications','users','availability','reports','dropdown_master','settings'
  ], 'section availability');

  for v_key in select jsonb_object_keys(p_availability) loop
    if jsonb_typeof(p_availability -> v_key) <> 'boolean' then
      raise exception 'Section availability values must be boolean' using errcode = '22023';
    end if;
  end loop;

  return default_section_availability() || p_availability;
end $$;

alter function default_section_availability() owner to postgres;
alter function validated_section_availability(jsonb) owner to postgres;

revoke all on function public.task_attachment_display_name(text) from public,anon;
grant execute on function public.task_attachment_display_name(text) to authenticated;
revoke all on function public.get_task_attachment_path(uuid) from public,anon;
grant execute on function public.get_task_attachment_path(uuid) to authenticated;
revoke all on function public.get_task_evidence_workspace(jsonb) from public,anon;
grant execute on function public.get_task_evidence_workspace(jsonb) to authenticated;
revoke all on function public.add_task_attachment_with_audit(uuid,text) from public,anon;
grant execute on function public.add_task_attachment_with_audit(uuid,text) to authenticated;
revoke all on function public.complete_recurring_task_with_image_with_audit(uuid,text) from public,anon;
grant execute on function public.complete_recurring_task_with_image_with_audit(uuid,text) to authenticated;
revoke all on function public.complete_uploaded_task_with_audit(uuid,text) from public,anon;
grant execute on function public.complete_uploaded_task_with_audit(uuid,text) to authenticated;

notify pgrst,'reload schema';

-- The bucket predates WebP support, but both the generic registration contract
-- above and the recurring image-completion path accept image/webp, and the
-- browser offers it in the file picker. Storage rejected those uploads before
-- the database was ever reached; align the bucket with the contract it serves,
-- matching every other evidence bucket in this schema.
update storage.buckets
   set allowed_mime_types = array['image/jpeg','image/png','image/webp','application/pdf']
 where id = 'task-attachments';

notify pgrst,'reload schema';
