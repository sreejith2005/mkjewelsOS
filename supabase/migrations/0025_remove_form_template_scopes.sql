-- Forms are tenant-wide. Branch/department remain operational data on
-- submissions and other business records, but never limit a template.

update form_templates set branch_id = null, department_id = null
where branch_id is not null or department_id is not null;

alter table form_templates drop constraint if exists form_templates_scope_pair;
drop index if exists idx_form_templates_library_scope;
drop index if exists idx_form_templates_branch;
drop index if exists idx_form_templates_department;
create index if not exists idx_form_templates_library_lifecycle
  on form_templates(tenant_id, lifecycle, name);

create or replace function can_manage_form_template(p_template_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select current_profile_is_active() and exists (
    select 1 from form_templates ft
    where ft.id = p_template_id and ft.tenant_id = current_tenant_id()
      and current_role_level() in ('super_admin','admin','manager')
  );
$$;

create or replace function can_read_form_submission(p_submission_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select current_profile_is_active() and exists (
    select 1 from form_submissions fs
    where fs.id = p_submission_id and fs.tenant_id = current_tenant_id()
      and (
        fs.submitted_by = (current_profile()).id
        or current_role_level() in ('super_admin','admin')
        or (current_role_level() = 'manager' and fs.branch_id = current_branch_id())
        or (fs.linked_module in ('checklist_task','delegation_task') and exists (
          select 1 from task_instances ti join task_assignees ta on ta.task_instance_id = ti.id
          where ti.id = fs.linked_record_id and ti.tenant_id = fs.tenant_id
            and ta.user_profile_id = (current_profile()).id and ta.is_active and ta.role_at_task = 'doer'
        ))
      )
  );
$$;

create or replace function can_access_form_template(p_template_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select current_profile_is_active() and exists (
    select 1 from form_templates ft
    where ft.id = p_template_id and ft.tenant_id = current_tenant_id() and (
      (ft.lifecycle = 'published' and ft.is_active and current_role_level() in ('super_admin','admin','manager','crm','staff','doer','housekeeping')
        and (current_role_level() in ('super_admin','admin') or (ft.permissions->'roles') ? current_role_level()::text))
      or (ft.lifecycle = 'draft' and current_role_level() in ('super_admin','admin','manager'))
      or exists(select 1 from form_submissions fs where fs.form_template_id = ft.id and can_read_form_submission(fs.id))
      or (ft.published_at is not null and ft.lifecycle in ('published','archived') and exists (
        select 1 from task_instances ti join task_assignees ta on ta.task_instance_id = ti.id
        where ti.tenant_id = ft.tenant_id and ti.form_template_id = ft.id and ti.requires_form
          and ta.user_profile_id = (current_profile()).id and ta.is_active
      ))
    )
  );
$$;

create or replace function save_form_draft_with_audit(p_template_id uuid, p_payload jsonb, p_fields jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_old form_templates; v_new form_templates; v_id uuid; v_family uuid; v_permissions jsonb; v_fields jsonb; v_old_fields jsonb;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'Only active manager, admin, or super_admin profiles can author forms' using errcode='42501'; end if;
  -- Legacy callers may still send scope keys. They are deliberately ignored.
  if jsonb_typeof(p_payload) <> 'object' or p_payload - array['name','description','permissions','branch_id','department_id'] <> '{}'::jsonb then raise exception 'Form draft payload contains unsupported keys' using errcode='22023'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null or length(btrim(p_payload->>'name')) > 150 or length(coalesce(p_payload->>'description','')) > 2000 then raise exception 'Form name or description exceeds its limit' using errcode='22023'; end if;
  v_permissions := normalize_form_permissions(p_payload->'permissions'); v_fields := normalize_form_fields(p_fields);
  if p_template_id is null then
    v_family := extensions.uuid_generate_v4();
    insert into form_templates(tenant_id,family_id,version,lifecycle,is_active,name,description,branch_id,department_id,permissions,created_by,updated_by,published_at)
    values(v_actor.tenant_id,v_family,1,'draft',false,btrim(p_payload->>'name'),nullif(btrim(p_payload->>'description'),''),null,null,v_permissions,v_actor.id,v_actor.id,null) returning * into v_new;
    v_id := v_new.id;
  else
    select * into v_old from form_templates where id=p_template_id for update;
    if v_old.id is null or v_old.tenant_id<>v_actor.tenant_id or v_old.lifecycle<>'draft' then raise exception 'Editable form draft not found' using errcode='42501'; end if;
    select coalesce(jsonb_agg(to_jsonb(ff) order by ff.sort_order),'[]'::jsonb) into v_old_fields from form_fields ff where ff.form_template_id=v_old.id;
    update form_templates set name=btrim(p_payload->>'name'),description=nullif(btrim(p_payload->>'description'),''),branch_id=null,department_id=null,permissions=v_permissions,updated_by=v_actor.id,updated_at=now() where id=p_template_id returning * into v_new;
    v_id := v_new.id;
  end if;
  perform replace_form_draft_fields(v_id,v_fields);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,case when p_template_id is null then 'form_draft_created' else 'form_draft_updated' end,'forms',v_id,case when p_template_id is null then null else jsonb_build_object('template',to_jsonb(v_old),'fields',v_old_fields) end,jsonb_build_object('template',to_jsonb(v_new),'fields',v_fields));
  return v_id;
end;
$$;

create or replace function create_form_revision_with_audit(p_source_template_id uuid, p_payload jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_source form_templates; v_new form_templates; v_permissions jsonb; v_version integer;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'Only active form authors can create revisions' using errcode='42501'; end if;
  if jsonb_typeof(p_payload) <> 'object' or p_payload - array['name','description','permissions','branch_id','department_id'] <> '{}'::jsonb then raise exception 'Form revision payload contains unsupported keys' using errcode='22023'; end if;
  select * into v_source from form_templates where id=p_source_template_id for update;
  if v_source.id is null or v_source.tenant_id<>v_actor.tenant_id or v_source.lifecycle not in ('published','archived') then raise exception 'Published or archived source form not found' using errcode='42501'; end if;
  if exists(select 1 from form_templates where tenant_id=v_source.tenant_id and family_id=v_source.family_id and lifecycle='draft') then raise exception 'This form family already has a draft revision' using errcode='23505'; end if;
  v_permissions := case when p_payload ? 'permissions' then normalize_form_permissions(p_payload->'permissions') else v_source.permissions end;
  select max(version)+1 into v_version from form_templates where tenant_id=v_source.tenant_id and family_id=v_source.family_id;
  insert into form_templates(tenant_id,family_id,version,lifecycle,is_active,name,description,branch_id,department_id,permissions,created_by,updated_by,published_at)
  values(v_actor.tenant_id,v_source.family_id,v_version,'draft',false,btrim(coalesce(p_payload->>'name',v_source.name)),nullif(btrim(case when p_payload ? 'description' then p_payload->>'description' else v_source.description end),''),null,null,v_permissions,v_actor.id,v_actor.id,null) returning * into v_new;
  insert into form_fields(form_template_id,field_key,field_name,field_type,group_name,is_shown,is_editable,is_required,initial_value,options,conditional_logic,sort_order,validation,placeholder,helper_text) select v_new.id,field_key,field_name,field_type,group_name,is_shown,is_editable,is_required,initial_value,options,conditional_logic,sort_order,validation,placeholder,helper_text from form_fields where form_template_id=v_source.id order by sort_order;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'form_revision_created','forms',v_new.id,to_jsonb(v_source),to_jsonb(v_new)); return v_new.id;
end;
$$;

create or replace function publish_form_with_audit(p_template_id uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_old form_templates; v_new form_templates; v_previous form_templates;
begin select * into v_actor from current_profile(); if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'Only active form authors can publish forms' using errcode='42501'; end if; select * into v_old from form_templates where id=p_template_id for update; if v_old.id is null or v_old.tenant_id<>v_actor.tenant_id or v_old.lifecycle<>'draft' then raise exception 'Publishable draft not found' using errcode='42501'; end if; perform assert_form_publishable(v_old.id); select * into v_previous from form_templates where tenant_id=v_old.tenant_id and family_id=v_old.family_id and lifecycle='published' for update; if v_previous.id is not null then update form_templates set lifecycle='archived',is_active=false,archived_by=v_actor.id,archived_at=now(),updated_by=v_actor.id,updated_at=now() where id=v_previous.id; end if; update form_templates set lifecycle='published',is_active=true,published_by=v_actor.id,published_at=now(),archived_by=null,archived_at=null,updated_by=v_actor.id,updated_at=now() where id=v_old.id returning * into v_new; insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'form_published','forms',v_new.id,to_jsonb(v_old),to_jsonb(v_new)); return v_new.id; end;
$$;

create or replace function archive_form_with_audit(p_template_id uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare v_actor user_profiles; v_old form_templates; v_new form_templates;
begin select * into v_actor from current_profile(); if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'Only active form authors can archive forms' using errcode='42501'; end if; select * into v_old from form_templates where id=p_template_id for update; if v_old.id is null or v_old.tenant_id<>v_actor.tenant_id or v_old.lifecycle='archived' then raise exception 'Archivable form not found' using errcode='42501'; end if; update form_templates set lifecycle='archived',is_active=false,archived_by=v_actor.id,archived_at=now(),updated_by=v_actor.id,updated_at=now() where id=v_old.id returning * into v_new; insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'form_archived','forms',v_new.id,to_jsonb(v_old),to_jsonb(v_new)); return v_new.id; end;
$$;
