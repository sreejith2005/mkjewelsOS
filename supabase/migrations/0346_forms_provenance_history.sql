-- Forms 2.0: definitions only; submissions and pinned template IDs are untouched.
set search_path=public,extensions;

create table form_family_provenance (
  family_id uuid primary key,
  tenant_id uuid not null references tenants(id),
  origin text not null check(origin in ('library','fms','ai_import','duplicate','legacy_unknown')),
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now(),
  source_flow_id uuid,
  source_flow_name text,
  source_stage_key text,
  source_stage_name text,
  source_template_id uuid,
  import_method text
);
create table form_definition_checkpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  family_id uuid not null,
  template_id uuid not null,
  version integer not null,
  sequence integer not null,
  action text not null,
  actor_id uuid references user_profiles(id),
  actor_name text,
  created_at timestamptz not null default now(),
  definition jsonb not null,
  -- Preserve legacy defaults without expanding the native authoring contract.
  legacy_field_defaults jsonb not null default '{}'::jsonb,
  lifecycle text not null,
  change_note text check(length(change_note)<=1000),
  previous_id uuid references form_definition_checkpoints(id),
  unique(tenant_id,family_id,sequence)
);
create index form_definition_checkpoints_template on form_definition_checkpoints(template_id);
create table forms_import_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  actor_id uuid not null references user_profiles(id),
  request_key uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  success boolean,
  unique(tenant_id,actor_id,request_key)
);
create index forms_import_requests_quota on forms_import_requests(tenant_id,actor_id,created_at);
alter table form_family_provenance enable row level security;
alter table form_definition_checkpoints enable row level security;
alter table forms_import_requests enable row level security;
revoke all on form_family_provenance,form_definition_checkpoints,forms_import_requests from public,anon,authenticated,service_role;
-- Raw provenance is deliberately never selectable: it contains restricted FMS labels.
create policy module_accessible on form_family_provenance as restrictive for select to authenticated using(module_accessible('forms_library'));
create policy module_accessible on form_definition_checkpoints as restrictive for select to authenticated using(module_accessible('forms_library'));
create policy module_accessible on forms_import_requests as restrictive for select to authenticated using(module_accessible('forms_library'));

create function guard_form_history_immutable() returns trigger
language plpgsql set search_path=public as $$begin raise exception 'Form history and provenance are immutable' using errcode='55000'; end$$;
create trigger form_provenance_immutable before update or delete on form_family_provenance for each row execute function guard_form_history_immutable();
create trigger form_checkpoint_immutable before update or delete on form_definition_checkpoints for each row execute function guard_form_history_immutable();

create function assert_forms_workspace_actor() returns user_profiles
language plpgsql security definer set search_path=public as $$
declare actor user_profiles:=current_profile();
begin
  perform assert_module_enabled('forms_library');
  if actor.id is null or not current_profile_is_active() or not has_permission('forms.manage') then
    raise exception 'Active form author required' using errcode='42501';
  end if;
  return actor;
end$$;

create function form_checkpoint_definition(p_template_id uuid) returns jsonb
language sql stable security definer set search_path=public as $$
 select jsonb_strip_nulls(jsonb_build_object('name',t.name,'description',t.description,
 'recordNameFieldKey',t.record_name_field_key,'sections',t.sections,'permissions',t.permissions,
 'fields',coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
   'key',f.field_key,'label',f.field_name,'type',f.field_type,'sortOrder',f.sort_order,
   'sectionKey',f.group_name,'required',f.is_required,'shown',f.is_shown,'editable',f.is_editable,
   'placeholder',f.placeholder,'helperText',f.helper_text,'options',f.options,
   'optionSource',case when f.option_source='dropdown_master' then jsonb_build_object('kind','master','masterType',f.dropdown_master_type) end,
   'branches',f.branch_logic,'validation',f.validation,
   'condition',case when f.conditional_logic ? 'kind' then null else f.conditional_logic end,
   'rule',case when f.conditional_logic ? 'kind' then f.conditional_logic else null end
 )) order by f.sort_order,f.field_key) from form_fields f where f.form_template_id=t.id),'[]'::jsonb)))
 from form_templates t where t.id=p_template_id
$$;

create function record_form_checkpoint(p_template_id uuid,p_action text,p_note text default null) returns void
language plpgsql security definer set search_path=public as $$
declare t form_templates; prior form_definition_checkpoints; previous_template form_definition_checkpoints; d jsonb; v_defaults jsonb; actor user_profiles:=current_profile();
begin
 select * into t from form_templates where id=p_template_id;
 if t.id is null then return; end if;
 perform pg_advisory_xact_lock(hashtextextended('form_family:'||t.family_id::text,0));
 d:=form_checkpoint_definition(t.id);
 select coalesce(jsonb_object_agg(field_key,initial_value),'{}'::jsonb) into v_defaults
 from form_fields where form_template_id=t.id and initial_value is not null;
 select * into prior from form_definition_checkpoints where tenant_id=t.tenant_id and family_id=t.family_id order by sequence desc limit 1;
 select * into previous_template from form_definition_checkpoints where template_id=t.id and tenant_id=t.tenant_id order by sequence desc limit 1;
 if previous_template.definition=d and previous_template.lifecycle=t.lifecycle::text and previous_template.legacy_field_defaults=v_defaults then return; end if;
 insert into form_definition_checkpoints(tenant_id,family_id,template_id,version,sequence,action,actor_id,actor_name,definition,legacy_field_defaults,lifecycle,change_note,previous_id)
 values(t.tenant_id,t.family_id,t.id,t.version,coalesce(prior.sequence,0)+1,p_action,actor.id,actor.employee_name,d,v_defaults,t.lifecycle::text,nullif(btrim(p_note),''),prior.id);
 insert into form_family_provenance(family_id,tenant_id,origin,created_by,created_at)
 values(t.family_id,t.tenant_id,'library',t.created_by,t.created_at) on conflict do nothing;
end$$;

-- Baselines are observed now, not fabricated historical events. Original origin
-- cannot safely be inferred from current FMS usage.
insert into form_family_provenance(family_id,tenant_id,origin,created_by,created_at)
select distinct on(family_id) family_id,tenant_id,'legacy_unknown',created_by,created_at from form_templates order by family_id,version;
do $$declare t record; begin
 for t in select id from form_templates order by family_id,version loop perform record_form_checkpoint(t.id,'baseline'); end loop;
end$$;

-- Wrap the installed writers (including record-name/visibility patches), never
-- replace their authorization, validation, audit, or pinned-reference guards.
alter function save_form_draft_with_audit(uuid,jsonb,jsonb) rename to save_form_draft_before_checkpoints;
alter function save_published_form_with_audit(uuid,jsonb,jsonb) rename to save_published_form_before_checkpoints;
alter function create_form_revision_with_audit(uuid,jsonb) rename to create_form_revision_before_checkpoints;
alter function duplicate_form_with_audit(uuid,text) rename to duplicate_form_before_checkpoints;
alter function publish_form_with_audit(uuid) rename to publish_form_before_checkpoints;
alter function archive_form_with_audit(uuid) rename to archive_form_before_checkpoints;

create function save_form_draft_with_audit(p_template_id uuid,p_payload jsonb,p_fields jsonb) returns uuid
language plpgsql security definer set search_path=public as $$declare result_id uuid; begin
 perform assert_forms_workspace_actor();
 perform pg_advisory_xact_lock(hashtextextended('form_family:'||family_id::text,0)) from form_templates where form_templates.id=p_template_id;
 result_id:=save_form_draft_before_checkpoints(p_template_id,p_payload,p_fields);
 perform record_form_checkpoint(result_id,case when p_template_id is null then 'created' else 'saved' end); return result_id;
end$$;
create function save_published_form_with_audit(p_template_id uuid,p_payload jsonb,p_fields jsonb) returns uuid
language plpgsql security definer set search_path=public as $$declare result_id uuid; begin
 perform assert_forms_workspace_actor();
 perform pg_advisory_xact_lock(hashtextextended('form_family:'||family_id::text,0)) from form_templates where form_templates.id=p_template_id;
 result_id:=save_published_form_before_checkpoints(p_template_id,p_payload,p_fields);
 perform record_form_checkpoint(result_id,'published_edit'); return result_id;
end$$;
create function create_form_revision_with_audit(p_source_template_id uuid,p_payload jsonb default '{}') returns uuid
language plpgsql security definer set search_path=public as $$declare result_id uuid; begin
 perform assert_forms_workspace_actor();
 perform pg_advisory_xact_lock(hashtextextended('form_family:'||family_id::text,0)) from form_templates where form_templates.id=p_source_template_id;
 result_id:=create_form_revision_before_checkpoints(p_source_template_id,p_payload);
 perform record_form_checkpoint(result_id,'revision_created'); return result_id;
end$$;
create function duplicate_form_with_audit(p_source_template_id uuid,p_name text default null) returns uuid
language plpgsql security definer set search_path=public as $$declare result_id uuid; begin
 perform assert_forms_workspace_actor(); result_id:=duplicate_form_before_checkpoints(p_source_template_id,p_name);
 insert into form_family_provenance(family_id,tenant_id,origin,created_by,source_template_id)
 select family_id,tenant_id,'duplicate',created_by,p_source_template_id from form_templates where form_templates.id=result_id;
 perform record_form_checkpoint(result_id,'duplicated'); return result_id;
end$$;
create function publish_form_with_audit(p_template_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$declare result_id uuid; begin
 perform assert_forms_workspace_actor();
 perform pg_advisory_xact_lock(hashtextextended('form_family:'||family_id::text,0)) from form_templates where form_templates.id=p_template_id;
 result_id:=publish_form_before_checkpoints(p_template_id);
 perform record_form_checkpoint(t.id,'archived') from form_templates t
 where t.family_id=(select family_id from form_templates where id=result_id) and t.lifecycle='archived';
 perform record_form_checkpoint(result_id,'published'); return result_id;
end$$;
create function archive_form_with_audit(p_template_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$declare result_id uuid; begin
 perform assert_forms_workspace_actor();
 perform pg_advisory_xact_lock(hashtextextended('form_family:'||family_id::text,0)) from form_templates where form_templates.id=p_template_id;
 result_id:=archive_form_before_checkpoints(p_template_id);
 perform record_form_checkpoint(result_id,'archived'); return result_id;
end$$;

create function save_form_workspace_with_audit(p_template_id uuid,p_payload jsonb,p_fields jsonb,p_expected_updated_at timestamptz,p_origin jsonb default '{}',p_change_note text default null) returns uuid
language plpgsql security definer set search_path=public as $$
declare actor user_profiles:=assert_forms_workspace_actor(); t form_templates; result_id uuid; kind text; flow fms_flows; stage fms_stages;
begin
 if length(coalesce(p_change_note,''))>1000 or jsonb_typeof(p_origin) is distinct from 'object' then raise exception 'Invalid form save metadata' using errcode='22023'; end if;
 if p_template_id is not null then
  select * into t from form_templates where form_templates.id=p_template_id and tenant_id=actor.tenant_id;
  if t.id is null then raise exception 'Form not found' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('form_family:'||t.family_id::text,0));
  select * into t from form_templates where form_templates.id=p_template_id for update;
  if p_expected_updated_at is null or t.updated_at is distinct from p_expected_updated_at then raise exception 'Form changed; reload before saving' using errcode='40001'; end if;
  if p_origin<>'{}' then raise exception 'Creation origin is immutable' using errcode='22023'; end if;
  if t.lifecycle='published' then result_id:=save_published_form_before_checkpoints(p_template_id,p_payload,p_fields);
  else result_id:=save_form_draft_before_checkpoints(p_template_id,p_payload,p_fields); end if;
 else
  kind:=coalesce(p_origin->>'kind','library');
  if kind not in ('library','fms','ai_import') or p_origin-array['kind','flow_id','stage_key','import_method']<>'{}' then raise exception 'Invalid creation origin' using errcode='22023'; end if;
  if kind='fms' then
   perform assert_module_enabled('fms_builder');
   select * into flow from fms_flows where fms_flows.id=(p_origin->>'flow_id')::uuid and tenant_id=actor.tenant_id;
   if flow.id is null or not can_manage_fms_flow(flow.id) then raise exception 'Source workflow unavailable' using errcode='42501'; end if;
   select * into stage from fms_stages where fms_flow_id=flow.id and stage_key=p_origin->>'stage_key';
   if stage.id is null then raise exception 'Source stage unavailable; save the workflow draft first' using errcode='23514'; end if;
  end if;
  result_id:=save_form_draft_before_checkpoints(null,p_payload,p_fields);
  insert into form_family_provenance(family_id,tenant_id,origin,created_by,source_flow_id,source_flow_name,source_stage_key,source_stage_name,import_method)
  select family_id,tenant_id,kind,actor.id,flow.id,flow.name,stage.stage_key,stage.name,case when kind='ai_import' then 'html' end from form_templates where form_templates.id=result_id;
 end if;
 perform record_form_checkpoint(result_id,case when p_template_id is null then 'created' when t.lifecycle='published' then 'published_edit' else 'saved' end,p_change_note);
 return result_id;
end$$;

create function list_form_history(p_template_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare actor user_profiles:=assert_forms_workspace_actor(); t form_templates; result jsonb; begin
 select * into t from form_templates where id=p_template_id and tenant_id=actor.tenant_id;
 if t.id is null or not can_manage_form_template(t.id) then raise exception 'Form not found' using errcode='42501'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'template_id',h.template_id,'family_id',h.family_id,'version',h.version,'sequence',h.sequence,'action',h.action,'actor_name',h.actor_name,'created_at',h.created_at,'definition',h.definition,'lifecycle',h.lifecycle,'change_note',h.change_note,'previous_id',h.previous_id) order by h.sequence desc),'[]') into result from form_definition_checkpoints h where h.family_id=t.family_id and h.tenant_id=actor.tenant_id;
 return result;
end$$;

-- Result is an object keyed by the requested template UUID. Restricted source
-- identifiers/names are omitted together, including when a workflow is deleted.
create function get_form_provenance(p_template_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path=public as $$declare actor user_profiles:=current_profile(); result jsonb; begin
 perform assert_module_enabled('forms_library');
 if actor.id is null or not current_profile_is_active() or not has_permission('forms.view') then raise exception 'Active forms viewer required' using errcode='42501'; end if;
 if cardinality(p_template_ids)>200 then raise exception 'Too many forms' using errcode='22023'; end if;
 select coalesce(jsonb_object_agg(t.id::text,jsonb_build_object('family_id',p.family_id,'origin',p.origin,'created_by',p.created_by,'created_at',p.created_at,'source_template_id',case when can_access_form_template(p.source_template_id) then p.source_template_id end,'import_method',p.import_method,'used_in_fms',module_accessible('fms_builder') and exists(select 1 from fms_stages s where s.form_template_id=t.id and can_manage_fms_flow(s.fms_flow_id))) ||
 case when module_accessible('fms_builder') then jsonb_build_object('workflows',coalesce((select jsonb_agg(jsonb_build_object('id',flow.id,'name',flow.name,'stage_name',stage.name,'active_instances',(select count(*) from fms_instances instance where instance.fms_flow_id=flow.id and instance.status in ('active','overdue','on_hold'))) order by flow.name,stage.sort_order) from fms_stages stage join fms_flows flow on flow.id=stage.fms_flow_id where stage.form_template_id=t.id and can_manage_fms_flow(flow.id)),'[]'::jsonb)) else '{}'::jsonb end ||
 case when p.origin='fms' and can_manage_fms_flow(p.source_flow_id) and module_accessible('fms_builder') then jsonb_build_object('source_flow_id',p.source_flow_id,'source_flow_name',p.source_flow_name,'source_stage_key',p.source_stage_key,'source_stage_name',p.source_stage_name) else '{}'::jsonb end ||
 case when p.origin='fms' and not exists(select 1 from fms_flows source where source.id=p.source_flow_id and source.tenant_id=actor.tenant_id) then jsonb_build_object('source_deleted',true) else '{}'::jsonb end),'{}') into result
 from form_templates t join form_family_provenance p on p.family_id=t.family_id and p.tenant_id=t.tenant_id
 where t.id=any(p_template_ids) and t.tenant_id=actor.tenant_id and can_access_form_template(t.id);
 return result;
end$$;

create function restore_form_checkpoint_with_audit(p_checkpoint_id uuid,p_as_new_family boolean,p_expected_checkpoint_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare actor user_profiles:=assert_forms_workspace_actor(); checkpoint form_definition_checkpoints; latest uuid; result_id uuid; payload jsonb; next_version integer;
begin
 select * into checkpoint from form_definition_checkpoints where form_definition_checkpoints.id=p_checkpoint_id and tenant_id=actor.tenant_id;
 if checkpoint.id is null or not can_manage_form_template(checkpoint.template_id) then raise exception 'Checkpoint unavailable' using errcode='42501'; end if;
 if p_as_new_family is null then raise exception 'Choose restore or copy' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('form_family:'||checkpoint.family_id::text,0));
 select h.id into latest from form_definition_checkpoints h where h.family_id=checkpoint.family_id and h.tenant_id=actor.tenant_id order by sequence desc limit 1;
 if p_expected_checkpoint_id is null or latest is distinct from p_expected_checkpoint_id then raise exception 'Form history changed; reload before restoring' using errcode='40001'; end if;
 if not p_as_new_family and exists(select 1 from form_templates where family_id=checkpoint.family_id and tenant_id=actor.tenant_id and lifecycle='draft') then raise exception 'This form family already has a draft revision' using errcode='23505'; end if;
 payload:=jsonb_build_object('name',checkpoint.definition->'name','description',checkpoint.definition->'description','permissions',checkpoint.definition->'permissions','sections',checkpoint.definition->'sections','record_name_field_key',checkpoint.definition->'recordNameFieldKey');
 -- Snapshots carry sortOrder for native previews; the established writer takes
 -- field order from the array and deliberately rejects a sortOrder property.
 result_id:=save_form_draft_before_checkpoints(null,payload,
   (select coalesce(jsonb_agg(field-'sortOrder' order by position),'[]'::jsonb)
    from jsonb_array_elements(checkpoint.definition->'fields') with ordinality as saved(field,position)));
 update form_fields set initial_value=checkpoint.legacy_field_defaults->>field_key
 where form_template_id=result_id and checkpoint.legacy_field_defaults ? field_key;
 update form_templates set library_visible=source.library_visible from form_templates source where form_templates.id=result_id and source.id=checkpoint.template_id;
 if p_as_new_family then
  insert into form_family_provenance(family_id,tenant_id,origin,created_by,source_template_id) select family_id,tenant_id,'duplicate',actor.id,checkpoint.template_id from form_templates where form_templates.id=result_id;
 else
  select max(version)+1 into next_version from form_templates where family_id=checkpoint.family_id and tenant_id=actor.tenant_id;
  update form_templates set family_id=checkpoint.family_id,version=next_version where form_templates.id=result_id;
 end if;
 perform record_form_checkpoint(result_id,case when p_as_new_family then 'checkpoint_copied' else 'checkpoint_restored' end);
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(actor.tenant_id,actor.id,'form_checkpoint_restored','forms',result_id,jsonb_build_object('checkpoint_id',checkpoint.id,'as_new_family',p_as_new_family,'definition',form_checkpoint_definition(result_id)));
 return result_id;
end$$;

create function start_forms_import_request(p_request_key uuid) returns uuid
language plpgsql security definer set search_path=public as $$declare actor user_profiles:=assert_forms_workspace_actor(); result_id uuid; day_start timestamptz; begin
 if p_request_key is null then raise exception 'Request key required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('forms_import:'||actor.tenant_id::text||':'||actor.id::text,0));
 if exists(select 1 from forms_import_requests where tenant_id=actor.tenant_id and actor_id=actor.id and request_key=p_request_key) then raise exception 'forms_import_duplicate_request' using errcode='P0001'; end if;
 day_start:=date_trunc('day',now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
 if (select count(*) from forms_import_requests where tenant_id=actor.tenant_id and actor_id=actor.id and created_at>=day_start)>=10 then raise exception 'forms_import_daily_limit_reached' using errcode='P0001'; end if;
 insert into forms_import_requests(tenant_id,actor_id,request_key) values(actor.tenant_id,actor.id,p_request_key) returning forms_import_requests.id into result_id;
 return result_id;
end$$;
create function finish_forms_import_request(p_request_id uuid,p_success boolean) returns void
language plpgsql security definer set search_path=public as $$declare actor user_profiles:=assert_forms_workspace_actor(); begin
 if p_success is null then raise exception 'Success status required' using errcode='22023'; end if;
 update forms_import_requests set success=p_success,completed_at=now() where id=p_request_id and tenant_id=actor.tenant_id and actor_id=actor.id and completed_at is null;
 if not found then raise exception 'Import request unavailable or already completed' using errcode='42501'; end if;
end$$;

-- Only the explicitly documented RPCs are callable. Private helpers and the
-- renamed original writers must not provide an alternate browser write path.
revoke all on function guard_form_history_immutable(),assert_forms_workspace_actor(),form_checkpoint_definition(uuid),record_form_checkpoint(uuid,text,text),save_form_draft_before_checkpoints(uuid,jsonb,jsonb),save_published_form_before_checkpoints(uuid,jsonb,jsonb),create_form_revision_before_checkpoints(uuid,jsonb),duplicate_form_before_checkpoints(uuid,text),publish_form_before_checkpoints(uuid),archive_form_before_checkpoints(uuid) from public,anon,authenticated,service_role;
revoke all on function archive_form_with_audit(uuid) from public,anon,authenticated,service_role;
grant execute on function archive_form_with_audit(uuid) to authenticated;
revoke all on function save_form_draft_with_audit(uuid,jsonb,jsonb),save_published_form_with_audit(uuid,jsonb,jsonb),create_form_revision_with_audit(uuid,jsonb),duplicate_form_with_audit(uuid,text),publish_form_with_audit(uuid),save_form_workspace_with_audit(uuid,jsonb,jsonb,timestamptz,jsonb,text),list_form_history(uuid),get_form_provenance(uuid[]),restore_form_checkpoint_with_audit(uuid,boolean,uuid),start_forms_import_request(uuid),finish_forms_import_request(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function save_form_draft_with_audit(uuid,jsonb,jsonb),save_published_form_with_audit(uuid,jsonb,jsonb),create_form_revision_with_audit(uuid,jsonb),duplicate_form_with_audit(uuid,text),publish_form_with_audit(uuid),save_form_workspace_with_audit(uuid,jsonb,jsonb,timestamptz,jsonb,text),list_form_history(uuid),get_form_provenance(uuid[]),restore_form_checkpoint_with_audit(uuid,boolean,uuid),start_forms_import_request(uuid),finish_forms_import_request(uuid,boolean) to authenticated;
notify pgrst,'reload schema';
