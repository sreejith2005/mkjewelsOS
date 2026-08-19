-- Complete local FMS definition and transactional runtime contract.
set search_path = public, extensions;

alter table fms_flows
  add column family_id uuid default extensions.uuid_generate_v4(),
  add column scope_type text not null default 'tenant',
  add column archived_by uuid references user_profiles(id),
  add column archived_at timestamptz,
  add column updated_by uuid references user_profiles(id),
  add constraint fms_flows_version_positive check (version > 0),
  add constraint fms_flows_name_length check (length(btrim(name)) between 1 and 150),
  add constraint fms_flows_description_length check (description is null or length(description) <= 2000),
  add constraint fms_flows_manual_trigger_only check (trigger_type = 'manual'),
  add constraint fms_flows_scope check (
    (scope_type='tenant' and branch_id is null and department_id is null)
    or (scope_type='branch' and branch_id is not null and department_id is null)
    or (scope_type='department' and branch_id is not null and department_id is not null)
  );

update fms_flows set family_id=id where family_id is null;
alter table fms_flows alter column family_id set not null;
create unique index idx_fms_flows_family_version on fms_flows(tenant_id,family_id,version);
create unique index idx_fms_flows_one_draft on fms_flows(tenant_id,family_id) where status='draft';
create unique index idx_fms_flows_one_published on fms_flows(tenant_id,family_id) where status='published';
create index idx_fms_flows_library on fms_flows(tenant_id,status,branch_id,department_id,name);

alter table fms_stages
  add column stage_key text default ('stage_'||replace(extensions.uuid_generate_v4()::text,'-','')),
  add column default_next_stage_id uuid references fms_stages(id),
  add column parallel_target_stage_ids uuid[] not null default '{}',
  add column checklist_definition jsonb not null default '[]',
  add column notification_config jsonb not null default '{}',
  add constraint fms_stages_order_nonnegative check (sort_order >= 0),
  add constraint fms_stages_name_length check (length(btrim(name)) between 1 and 150),
  add constraint fms_stages_method_length check (method is null or length(method) <= 4000),
  add constraint fms_stages_checklist_array check (jsonb_typeof(checklist_definition)='array'),
  add constraint fms_stages_notification_object check (jsonb_typeof(notification_config)='object');

with numbered as (
  select id, 'stage_' || lpad(row_number() over(partition by fms_flow_id order by sort_order,id)::text,3,'0') as generated
  from fms_stages
) update fms_stages s set stage_key=n.generated from numbered n where n.id=s.id and s.stage_key is null;
alter table fms_stages alter column stage_key set not null;
alter table fms_stages add constraint fms_stages_key_format check (stage_key ~ '^[a-z][a-z0-9_]{0,63}$');
alter table fms_stages add constraint fms_stages_flow_key_unique unique(fms_flow_id,stage_key);
alter table fms_stages add constraint fms_stages_flow_order_unique unique(fms_flow_id,sort_order);

alter table fms_stage_assignees
  add column sort_order integer not null default 0,
  add column allow_next_selection boolean not null default false;
create index idx_fms_stage_assignees_order on fms_stage_assignees(fms_stage_id,sort_order);

alter table fms_branch_rules
  add column source_type text not null default 'outcome',
  add column source_key text,
  alter column condition_value drop not null,
  add constraint fms_branch_source check (source_type in ('outcome','context','form_answer')),
  add constraint fms_branch_source_key check ((source_type='outcome' and source_key is null) or (source_type in ('context','form_answer') and source_key ~ '^[a-z][a-z0-9_]{0,63}$'));
create unique index idx_fms_branch_rule_order on fms_branch_rules(fms_stage_id,sort_order);

alter table fms_instances
  add column department_id uuid references departments(id),
  add column flow_family_id uuid,
  add column flow_version integer,
  add column cancelled_by uuid references user_profiles(id),
  add column cancelled_at timestamptz,
  add column cancel_reason text,
  add column held_by uuid references user_profiles(id),
  add column held_at timestamptz,
  add column hold_reason text,
  add constraint fms_instances_reference_unique unique(tenant_id,reference_number),
  add constraint fms_instances_title_length check (length(btrim(title)) between 1 and 200),
  add constraint fms_instances_context_object check (jsonb_typeof(context)='object');
update fms_instances i set flow_family_id=f.family_id,flow_version=f.version from fms_flows f where f.id=i.fms_flow_id;
alter table fms_instances alter column flow_family_id set not null;
alter table fms_instances alter column flow_version set not null;
create index idx_fms_instances_starter on fms_instances(tenant_id,started_by,started_at desc);
create index idx_fms_instances_parent on fms_instances(parent_instance_id) where parent_instance_id is not null;

alter table fms_instance_stages
  add column previous_instance_stage_id uuid references fms_instance_stages(id),
  add column branch_rule_id uuid references fms_branch_rules(id),
  add column activated_at timestamptz,
  add column completed_by uuid references user_profiles(id),
  add column escalation_count integer not null default 0,
  add column last_escalated_at timestamptz,
  add column revision_of_id uuid references fms_instance_stages(id),
  add constraint fms_instance_stages_escalation_nonnegative check (escalation_count>=0);
create index idx_fms_instance_stages_instance_created on fms_instance_stages(fms_instance_id,created_at,id);
create index idx_fms_instance_stages_assigned_gin on fms_instance_stages using gin(assigned_to);
create unique index idx_fms_instance_stage_once on fms_instance_stages(fms_instance_id,fms_stage_id) where revision_of_id is null;

create table fms_instance_stage_assignees (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  fms_instance_stage_id uuid not null references fms_instance_stages(id) on delete cascade,
  user_profile_id uuid not null references user_profiles(id),
  status text not null default 'assigned' check(status in ('assigned','claimed','completed','reassigned','cancelled')),
  assigned_by uuid references user_profiles(id),
  assigned_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  outcome text,
  remark text,
  is_active boolean not null default true,
  unique(fms_instance_stage_id,user_profile_id,assigned_at)
);
create unique index idx_fms_actor_active on fms_instance_stage_assignees(fms_instance_stage_id,user_profile_id) where is_active;
create index idx_fms_actor_user_status on fms_instance_stage_assignees(tenant_id,user_profile_id,status,is_active);

create table fms_instance_checklist_items (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  fms_instance_stage_id uuid not null references fms_instance_stages(id) on delete cascade,
  item_key text not null,
  label text not null,
  is_required boolean not null default true,
  is_completed boolean not null default false,
  completed_by uuid references user_profiles(id),
  completed_at timestamptz,
  sort_order integer not null,
  unique(fms_instance_stage_id,item_key), unique(fms_instance_stage_id,sort_order)
);
create index idx_fms_checklist_stage on fms_instance_checklist_items(fms_instance_stage_id,sort_order);

create table fms_evidence (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  fms_instance_stage_id uuid not null references fms_instance_stages(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null check(size_bytes between 1 and 10485760),
  uploaded_by uuid not null references user_profiles(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references user_profiles(id),
  constraint fms_evidence_mime check(mime_type in ('image/jpeg','image/png','image/webp','application/pdf')),
  constraint fms_evidence_extension check(lower(original_filename) ~ '\.(jpg|jpeg|png|webp|pdf)$')
);
create index idx_fms_evidence_stage on fms_evidence(fms_instance_stage_id,created_at);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('fms-evidence','fms-evidence',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create sequence if not exists fms_reference_sequence;

create function fill_fms_legacy_insert_defaults() returns trigger language plpgsql set search_path=public as $$
begin
 if tg_table_name='fms_flows' then if new.branch_id is not null and new.scope_type='tenant' then new.scope_type=case when new.department_id is null then 'branch' else 'department' end; end if; new.family_id=coalesce(new.family_id,new.id,extensions.uuid_generate_v4());
 else select family_id,version into new.flow_family_id,new.flow_version from fms_flows where id=new.fms_flow_id; end if; return new;
end $$;
create trigger fms_flow_legacy_defaults before insert on fms_flows for each row execute function fill_fms_legacy_insert_defaults();
create trigger fms_instance_legacy_defaults before insert on fms_instances for each row execute function fill_fms_legacy_insert_defaults();

create function can_manage_fms_flow(p_flow_id uuid default null)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from user_profiles actor
    where actor.auth_user_id=auth.uid() and actor.working_status not in ('inactive','resigned') and actor.is_login_enabled
      and actor.user_role in ('super_admin','admin')
      and (p_flow_id is null or exists(select 1 from fms_flows f where f.id=p_flow_id and f.tenant_id=actor.tenant_id))
  );
$$;

create function can_read_fms_instance(p_instance_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from fms_instances i join user_profiles actor on actor.auth_user_id=auth.uid()
    where i.id=p_instance_id and i.tenant_id=actor.tenant_id and actor.working_status not in ('inactive','resigned') and actor.is_login_enabled
      and (actor.user_role in ('super_admin','admin') or (actor.user_role='manager' and i.branch_id=actor.branch_id)
        or i.started_by=actor.id or exists(select 1 from fms_instance_stages s where s.fms_instance_id=i.id and actor.id=any(s.assigned_to)))
  );
$$;

create function can_start_fms_flow(p_flow_id uuid,p_branch_id uuid,p_department_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from fms_flows f join user_profiles actor on actor.auth_user_id=auth.uid()
    where f.id=p_flow_id and f.tenant_id=actor.tenant_id and f.status='published' and f.is_active and actor.working_status not in ('inactive','resigned') and actor.is_login_enabled
      and actor.user_role in ('super_admin','admin','manager','crm','staff')
      and (f.branch_id is null or f.branch_id=p_branch_id) and (f.department_id is null or f.department_id=p_department_id)
      and (actor.user_role in ('super_admin','admin') or p_branch_id=actor.branch_id)
      and (actor.user_role not in ('crm','staff') or p_department_id=actor.department_id)
  );
$$;

create function enforce_fms_definition_immutability()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_table_name='fms_flows' then
    if tg_op='DELETE' and (old.status<>'draft' or exists(select 1 from fms_instances where fms_flow_id=old.id)) then raise exception 'Published or used flows cannot be deleted' using errcode='23514'; end if;
    if tg_op='UPDATE' and old.status in ('published','archived') and row(new.name,new.description,new.branch_id,new.department_id,new.family_id,new.version,new.trigger_type,new.scope_type) is distinct from row(old.name,old.description,old.branch_id,old.department_id,old.family_id,old.version,old.trigger_type,old.scope_type) then raise exception 'Published flow definitions are immutable' using errcode='23514'; end if;
  else
    if exists(select 1 from fms_flows where id=coalesce(new.fms_flow_id,old.fms_flow_id) and status in ('published','archived')) then raise exception 'Published stage definitions are immutable' using errcode='23514'; end if;
  end if;
  return coalesce(new,old);
end $$;

create function save_fms_flow_draft_with_audit(p_flow_id uuid,p_metadata jsonb,p_stages jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_flow fms_flows; v_old jsonb; v_stage jsonb; v_stage_id uuid; v_rule jsonb; v_assignee jsonb;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_metadata)<>'object' or jsonb_typeof(p_stages)<>'array' or pg_column_size(p_metadata)+pg_column_size(p_stages)>262144 or jsonb_array_length(p_stages)>200 then raise exception 'Invalid FMS draft payload' using errcode='22023'; end if;
  if coalesce(p_metadata->>'trigger_type','manual')<>'manual' then raise exception 'Only manual triggers are supported' using errcode='0A000'; end if;
  if p_flow_id is null then
    insert into fms_flows(tenant_id,branch_id,department_id,name,description,status,trigger_type,is_active,version,family_id,scope_type,created_by,updated_by)
    values(v_actor.tenant_id,nullif(p_metadata->>'branch_id','')::uuid,nullif(p_metadata->>'department_id','')::uuid,btrim(p_metadata->>'name'),nullif(btrim(p_metadata->>'description'),''),'draft','manual',coalesce((p_metadata->>'is_active')::boolean,true),1,extensions.uuid_generate_v4(),coalesce(p_metadata->>'scope_type','tenant'),v_actor.id,v_actor.id)
    returning * into v_flow;
  else
    select * into v_flow from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id for update;
    if v_flow.id is null or v_flow.status<>'draft' then raise exception 'Only a tenant draft can be saved' using errcode='23514'; end if;
    v_old=to_jsonb(v_flow);
    update fms_flows set name=btrim(p_metadata->>'name'),description=nullif(btrim(p_metadata->>'description'),''),branch_id=nullif(p_metadata->>'branch_id','')::uuid,department_id=nullif(p_metadata->>'department_id','')::uuid,scope_type=coalesce(p_metadata->>'scope_type','tenant'),is_active=coalesce((p_metadata->>'is_active')::boolean,true),updated_by=v_actor.id,updated_at=now() where id=v_flow.id returning * into v_flow;
    delete from fms_stages where fms_flow_id=v_flow.id;
  end if;
  if not exists(select 1 from branches b where b.id=v_flow.branch_id and b.tenant_id=v_actor.tenant_id and b.is_active) and v_flow.branch_id is not null then raise exception 'Invalid active branch scope' using errcode='23514'; end if;
  if not exists(select 1 from departments d where d.id=v_flow.department_id and d.tenant_id=v_actor.tenant_id and d.branch_id=v_flow.branch_id and d.is_active) and v_flow.department_id is not null then raise exception 'Invalid active department scope' using errcode='23514'; end if;
  for v_stage in select value from jsonb_array_elements(p_stages) loop
    insert into fms_stages(fms_flow_id,stage_key,name,method,step_type,sort_order,is_required,planned_time_rule,completion_rule,allow_multiple_doers,requires_upload,requires_remark,requires_checklist,checklist_definition,form_template_id,requires_next_doer_handoff,can_move_backward,can_reject,can_request_revision,can_escalate,join_rule,notification_config,split_to_flow_id)
    values(v_flow.id,btrim(v_stage->>'key'),btrim(v_stage->>'name'),nullif(btrim(v_stage->>'method'),''),(v_stage->>'type')::fms_step_type,(v_stage->>'order')::integer,coalesce((v_stage->>'required')::boolean,true),coalesce(v_stage->'sla','{}'),coalesce((v_stage->>'completionRule')::fms_completion_rule,'any_doer'),coalesce((v_stage->>'allowMultipleDoers')::boolean,false),coalesce((v_stage->>'requiresUpload')::boolean,false),coalesce((v_stage->>'requiresRemark')::boolean,false),jsonb_array_length(coalesce(v_stage->'checklist','[]'))>0,coalesce(v_stage->'checklist','[]'),nullif(v_stage->>'formTemplateId','')::uuid,coalesce((v_stage->>'requiresNextDoerHandoff')::boolean,false),coalesce((v_stage->>'canMoveBackward')::boolean,false),coalesce((v_stage->>'canReject')::boolean,false),coalesce((v_stage->>'canRequestRevision')::boolean,false),coalesce((v_stage->>'canEscalate')::boolean,false),nullif(v_stage->>'joinRule','')::fms_join_rule,coalesce(v_stage->'notificationConfig','{}'),nullif(v_stage->>'splitToFlowId','')::uuid)
    returning id into v_stage_id;
    for v_assignee in select value from jsonb_array_elements(coalesce(v_stage->'assigneeRules','[]')) loop
      insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,role_value,is_start_stage_entry_user,sort_order,allow_next_selection)
      values(v_stage_id,v_assignee->>'type',nullif(v_assignee->>'userProfileId','')::uuid,nullif(v_assignee->>'role','')::user_role,(v_stage->>'order')::integer=0,coalesce((v_assignee->>'order')::integer,0),coalesce((v_assignee->>'allowNextSelection')::boolean,false));
    end loop;
  end loop;
  for v_stage in select value from jsonb_array_elements(p_stages) loop
    select id into v_stage_id from fms_stages where fms_flow_id=v_flow.id and stage_key=v_stage->>'key';
    update fms_stages set
      default_next_stage_id=(select id from fms_stages where fms_flow_id=v_flow.id and stage_key=nullif(v_stage->>'defaultNextStageKey','')),
      parallel_target_stage_ids=coalesce((select array_agg(s.id order by a.ordinality) from jsonb_array_elements_text(coalesce(v_stage->'parallelTargetStageKeys','[]')) with ordinality a(stage_key,ordinality) join fms_stages s on s.fms_flow_id=v_flow.id and s.stage_key=a.stage_key),'{}'),
      join_required_stage_ids=coalesce((select array_agg(s.id order by a.ordinality) from jsonb_array_elements_text(coalesce(v_stage->'joinRequiredStageKeys','[]')) with ordinality a(stage_key,ordinality) join fms_stages s on s.fms_flow_id=v_flow.id and s.stage_key=a.stage_key),'{}')
    where id=v_stage_id;
    for v_rule in select value from jsonb_array_elements(coalesce(v_stage->'branchRules','[]')) loop
      insert into fms_branch_rules(fms_stage_id,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,next_flow_id,label,sort_order)
      values(v_stage_id,coalesce(v_rule->>'source','outcome'),nullif(v_rule->>'sourceKey',''),coalesce(nullif(v_rule->>'sourceKey',''),'outcome'),v_rule->>'operator',case when v_rule ? 'value' then v_rule->'value' #>> '{}' else null end,(select id from fms_stages where fms_flow_id=v_flow.id and stage_key=nullif(v_rule->>'nextStageKey','')),nullif(v_rule->>'nextFlowId','')::uuid,nullif(btrim(v_rule->>'label'),''),coalesce((v_rule->>'order')::integer,0));
    end loop;
  end loop;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,case when p_flow_id is null then 'fms_flow_created' else 'fms_flow_draft_saved' end,'fms_flows',v_flow.id,v_old,jsonb_build_object('name',v_flow.name,'version',v_flow.version,'stage_count',jsonb_array_length(p_stages)));
  return v_flow.id;
end $$;

create function create_fms_revision_with_audit(p_flow_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_source fms_flows; v_new_id uuid; v_stage fms_stages; v_new_stage uuid; v_old_ids uuid[]:='{}'::uuid[]; v_new_ids uuid[]:='{}'::uuid[];
begin
 select * into v_actor from current_profile(); if not can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode='42501'; end if;
 select * into v_source from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id and status in ('published','archived') for share; if v_source.id is null then raise exception 'Published flow version not found' using errcode='23514'; end if;
 if exists(select 1 from fms_flows where tenant_id=v_source.tenant_id and family_id=v_source.family_id and status='draft') then raise exception 'This flow family already has a draft revision' using errcode='23505'; end if;
 insert into fms_flows(tenant_id,branch_id,department_id,name,description,status,trigger_type,is_active,version,family_id,scope_type,created_by,updated_by)
 values(v_source.tenant_id,v_source.branch_id,v_source.department_id,v_source.name,v_source.description,'draft','manual',true,(select max(version)+1 from fms_flows where tenant_id=v_source.tenant_id and family_id=v_source.family_id),v_source.family_id,v_source.scope_type,v_actor.id,v_actor.id) returning id into v_new_id;
 for v_stage in select * from fms_stages where fms_flow_id=v_source.id order by sort_order loop
   insert into fms_stages(fms_flow_id,stage_key,name,method,step_type,sort_order,is_required,planned_time_rule,completion_rule,allow_multiple_doers,requires_upload,requires_remark,requires_checklist,checklist_definition,form_template_id,requires_next_doer_handoff,can_move_backward,can_reject,can_request_revision,can_escalate,is_parallel_group,parallel_group_key,join_rule,notification_config,split_to_flow_id)
   values(v_new_id,v_stage.stage_key,v_stage.name,v_stage.method,v_stage.step_type,v_stage.sort_order,v_stage.is_required,v_stage.planned_time_rule,v_stage.completion_rule,v_stage.allow_multiple_doers,v_stage.requires_upload,v_stage.requires_remark,v_stage.requires_checklist,v_stage.checklist_definition,v_stage.form_template_id,v_stage.requires_next_doer_handoff,v_stage.can_move_backward,v_stage.can_reject,v_stage.can_request_revision,v_stage.can_escalate,v_stage.is_parallel_group,v_stage.parallel_group_key,v_stage.join_rule,v_stage.notification_config,v_stage.split_to_flow_id) returning id into v_new_stage;
   v_old_ids=array_append(v_old_ids,v_stage.id); v_new_ids=array_append(v_new_ids,v_new_stage);
 end loop;
 update fms_stages n set
   default_next_stage_id=case when o.default_next_stage_id is null then null else v_new_ids[array_position(v_old_ids,o.default_next_stage_id)] end,
   parallel_target_stage_ids=coalesce((select array_agg(v_new_ids[array_position(v_old_ids,x.id)] order by x.ordinality) from unnest(o.parallel_target_stage_ids) with ordinality x(id,ordinality)),'{}'::uuid[]),
   join_required_stage_ids=coalesce((select array_agg(v_new_ids[array_position(v_old_ids,x.id)] order by x.ordinality) from unnest(o.join_required_stage_ids) with ordinality x(id,ordinality)),'{}'::uuid[])
 from fms_stages o where o.id=any(v_old_ids) and n.id=v_new_ids[array_position(v_old_ids,o.id)];
 insert into fms_stage_assignees(fms_stage_id,assignee_type,user_profile_id,role_value,is_start_stage_entry_user,sort_order,allow_next_selection)
 select v_new_ids[array_position(v_old_ids,a.fms_stage_id)],a.assignee_type,a.user_profile_id,a.role_value,a.is_start_stage_entry_user,a.sort_order,a.allow_next_selection from fms_stage_assignees a where a.fms_stage_id=any(v_old_ids);
 insert into fms_branch_rules(fms_stage_id,source_type,source_key,condition_field,condition_operator,condition_value,next_stage_id,next_flow_id,label,sort_order)
 select v_new_ids[array_position(v_old_ids,r.fms_stage_id)],r.source_type,r.source_key,r.condition_field,r.condition_operator,r.condition_value,case when r.next_stage_id is null then null else v_new_ids[array_position(v_old_ids,r.next_stage_id)] end,r.next_flow_id,r.label,r.sort_order from fms_branch_rules r where r.fms_stage_id=any(v_old_ids);
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'fms_flow_revision_created','fms_flows',v_new_id,jsonb_build_object('source_flow_id',v_source.id,'version',v_source.version),jsonb_build_object('version',v_source.version+1)); return v_new_id;
end $$;

create function publish_fms_flow_with_audit(p_flow_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_flow fms_flows;
begin select * into v_actor from current_profile(); if not can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode='42501'; end if; perform assert_fms_flow_publishable(p_flow_id); select * into v_flow from fms_flows where id=p_flow_id for update; update fms_flows set status='archived',is_active=false,archived_at=now(),archived_by=v_actor.id,updated_at=now() where tenant_id=v_flow.tenant_id and family_id=v_flow.family_id and status='published'; update fms_flows set status='published',is_active=true,published_by=v_actor.id,updated_by=v_actor.id,updated_at=now() where id=p_flow_id; insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'fms_flow_published','fms_flows',p_flow_id,jsonb_build_object('version',v_flow.version)); end $$;

create function archive_fms_flow_with_audit(p_flow_id uuid,p_reason text default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_flow fms_flows;
begin select * into v_actor from current_profile(); if not can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode='42501'; end if; select * into v_flow from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id for update; if v_flow.id is null or v_flow.status='archived' then raise exception 'Active flow version not found' using errcode='23514'; end if; update fms_flows set status='archived',is_active=false,archived_by=v_actor.id,archived_at=now(),updated_by=v_actor.id,updated_at=now() where id=p_flow_id; insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'fms_flow_archived','fms_flows',p_flow_id,jsonb_build_object('status',v_flow.status),jsonb_build_object('reason',left(coalesce(p_reason,''),1000))); end $$;

create function fms_rule_matches(p_operator text,p_expected text,p_actual jsonb)
returns boolean language plpgsql stable set search_path=public as $$
declare v_text text:=case when p_actual is null or p_actual='null'::jsonb then null else p_actual#>>'{}' end;
begin
 case p_operator when 'default' then return true; when 'equals' then return v_text is not distinct from p_expected; when 'not_equals' then return v_text is distinct from p_expected; when 'contains' then return coalesce(v_text,'') like '%'||coalesce(p_expected,'')||'%'; when 'greater_than' then return v_text::numeric>p_expected::numeric; when 'greater_than_or_equal' then return v_text::numeric>=p_expected::numeric; when 'less_than' then return v_text::numeric<p_expected::numeric; when 'less_than_or_equal' then return v_text::numeric<=p_expected::numeric; when 'in' then return coalesce(to_jsonb(v_text)<@p_expected::jsonb,false); when 'not_empty' then return v_text is not null and v_text<>''; else return false; end case;
exception when invalid_text_representation then return false;
end $$;

create function resolve_fms_stage_assignees(p_stage_id uuid,p_instance_id uuid,p_selected_user uuid default null)
returns uuid[] language plpgsql security definer set search_path=public as $$
declare v_stage fms_stages; v_instance fms_instances; v_rule fms_stage_assignees; v_ids uuid[]:='{}'::uuid[]; v_previous uuid[]; v_candidate uuid;
begin
 select * into v_stage from fms_stages where id=p_stage_id; select * into v_instance from fms_instances where id=p_instance_id;
 if v_stage.id is null or v_instance.id is null or v_stage.fms_flow_id<>v_instance.fms_flow_id then raise exception 'Invalid stage activation' using errcode='23514'; end if;
 select assigned_to into v_previous from fms_instance_stages where fms_instance_id=p_instance_id and status='completed' order by actual_datetime desc nulls last,created_at desc limit 1;
 for v_rule in select * from fms_stage_assignees where fms_stage_id=p_stage_id order by sort_order,id loop
   if v_rule.assignee_type='specific_user' then v_ids=array_append(v_ids,v_rule.user_profile_id);
   elsif v_rule.assignee_type='role' then select coalesce(array_agg(id order by employee_code),'{}') into v_previous from user_profiles where tenant_id=v_instance.tenant_id and user_role=v_rule.role_value and (v_instance.branch_id is null or branch_id=v_instance.branch_id) and (v_instance.department_id is null or department_id=v_instance.department_id) and working_status not in ('inactive','resigned') and is_login_enabled; v_ids=v_ids||v_previous;
   elsif v_rule.assignee_type='manager' then select manager_id into v_candidate from branches where id=v_instance.branch_id; v_ids=array_append(v_ids,v_candidate);
   elsif v_rule.assignee_type='department_head' then select head_id into v_candidate from departments where id=v_instance.department_id; v_ids=array_append(v_ids,v_candidate);
   elsif v_rule.assignee_type='previous_step_doer' then v_ids=v_ids||coalesce(v_previous,'{}');
   elsif v_rule.assignee_type='reporter' then v_ids=array_append(v_ids,v_instance.started_by); end if;
 end loop;
 select coalesce(array_agg(distinct u.id),'{}') into v_ids from unnest(array_remove(v_ids,null)) candidate(id) join user_profiles u on u.id=candidate.id where u.tenant_id=v_instance.tenant_id and (v_instance.branch_id is null or u.branch_id=v_instance.branch_id) and (v_instance.department_id is null or u.department_id=v_instance.department_id) and u.working_status not in ('inactive','resigned') and u.is_login_enabled;
 if cardinality(v_ids)=0 and v_stage.step_type not in ('notification','branch','parallel_start','parallel_join','end') then raise exception 'No eligible assignee for stage' using errcode='23514'; end if;
 if not v_stage.allow_multiple_doers and cardinality(v_ids)>1 then if p_selected_user is null or not p_selected_user=any(v_ids) then raise exception 'Explicit eligible assignee selection is required' using errcode='23514'; end if; v_ids=array[p_selected_user]; end if;
 return v_ids;
end $$;

create function activate_fms_stage_internal(p_instance_id uuid,p_stage_id uuid,p_previous_instance_stage_id uuid,p_selected_user uuid default null,p_guard integer default 0)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_instance fms_instances; v_stage fms_stages; v_instance_stage fms_instance_stages; v_ids uuid[]; v_item jsonb; v_rule fms_branch_rules; v_actual jsonb; v_target uuid; v_actor uuid; v_ready boolean; v_required integer; v_completed integer; v_revision_of uuid;
begin
 if p_guard>100 then raise exception 'Automatic FMS transition limit exceeded' using errcode='54001'; end if;
 select * into v_instance from fms_instances where id=p_instance_id for update; select * into v_stage from fms_stages where id=p_stage_id;
 if v_instance.status not in ('active','overdue') or v_stage.fms_flow_id<>v_instance.fms_flow_id then raise exception 'Instance or stage is not activatable' using errcode='23514'; end if;
 if v_stage.step_type='parallel_join' then
   if v_stage.join_rule='specific' then select cardinality(v_stage.join_required_stage_ids),count(*) into v_required,v_completed from fms_instance_stages where fms_instance_id=p_instance_id and fms_stage_id=any(v_stage.join_required_stage_ids) and status='completed';
   else select count(*),count(*) filter(where s.status='completed') into v_required,v_completed from fms_stages d join fms_instance_stages s on s.fms_stage_id=d.id and s.fms_instance_id=p_instance_id where v_stage.id=any(d.parallel_target_stage_ids) or d.default_next_stage_id=v_stage.id; end if;
   v_ready=case v_stage.join_rule when 'any' then v_completed>0 else v_required>0 and v_completed=v_required end; if not v_ready then return null; end if;
 end if;
 select * into v_instance_stage from fms_instance_stages where fms_instance_id=p_instance_id and fms_stage_id=p_stage_id order by created_at desc,id desc limit 1;
 if v_instance_stage.id is not null and v_instance_stage.status<>'blocked' then return v_instance_stage.id; end if;
 if v_instance_stage.status='blocked' then v_revision_of=v_instance_stage.id; end if;
 v_ids=resolve_fms_stage_assignees(p_stage_id,p_instance_id,p_selected_user);
 insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,assigned_to,planned_datetime,activated_at,previous_instance_stage_id,revision_of_id)
 values(p_instance_id,p_stage_id,(case when v_stage.step_type in ('notification','branch','parallel_start','parallel_join','end') then 'in_progress' else case when v_stage.step_type='approval' then 'in_review' else 'in_progress' end end)::task_status,v_ids,now()+make_interval(mins=>coalesce((v_stage.planned_time_rule->>'minutes')::integer,0)),now(),p_previous_instance_stage_id,v_revision_of) returning * into v_instance_stage;
 foreach v_actor in array v_ids loop insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by) values(v_instance.tenant_id,v_instance_stage.id,v_actor,v_instance.started_by); end loop;
 for v_item in select value from jsonb_array_elements(v_stage.checklist_definition) loop insert into fms_instance_checklist_items(tenant_id,fms_instance_stage_id,item_key,label,is_required,sort_order) values(v_instance.tenant_id,v_instance_stage.id,v_item->>'key',v_item->>'label',coalesce((v_item->>'required')::boolean,true),coalesce((v_item->>'sortOrder')::integer,0)); end loop;
 insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_instance_stage.id,v_instance.started_by,'activated',jsonb_build_object('guard',p_guard));
 if v_stage.step_type='notification' then
   foreach v_actor in array case when cardinality(v_ids)>0 then v_ids else array[v_instance.started_by] end loop insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url,channel,delivered_status) values(v_instance.tenant_id,v_actor,'fms_stage_notification',coalesce(nullif(v_stage.notification_config->>'title',''),v_stage.name),coalesce(nullif(v_stage.notification_config->>'message',''),coalesce(v_stage.method,'FMS stage notification')),'/tasks/fms?instance='||p_instance_id,'in_app','delivered'); end loop;
 elsif v_stage.step_type='branch' then
   for v_rule in select * from fms_branch_rules where fms_stage_id=v_stage.id order by sort_order loop
     if v_rule.source_type='outcome' then select to_jsonb(outcome) into v_actual from fms_instance_stages where id=p_previous_instance_stage_id; elsif v_rule.source_type='context' then v_actual=v_instance.context->v_rule.source_key; else select fs.data->v_rule.source_key into v_actual from form_submissions fs join fms_instance_stages prior on prior.form_submission_id=fs.id where prior.id=p_previous_instance_stage_id; end if;
     if fms_rule_matches(v_rule.condition_operator,v_rule.condition_value,v_actual) then v_target=v_rule.next_stage_id; update fms_instance_stages set branch_rule_id=v_rule.id where id=v_instance_stage.id; exit; end if;
   end loop;
   if v_target is null then raise exception 'No deterministic branch route matched' using errcode='23514'; end if;
 elsif v_stage.step_type='parallel_start' then foreach v_target in array v_stage.parallel_target_stage_ids loop perform activate_fms_stage_internal(p_instance_id,v_target,v_instance_stage.id,null,p_guard+1); end loop;
 elsif v_stage.step_type='end' then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=p_instance_id; end if;
 if v_stage.step_type in ('notification','branch','parallel_start','parallel_join','end') then update fms_instance_stages set status='completed',actual_datetime=now(),completed_by=v_instance.started_by where id=v_instance_stage.id; insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_instance_stage.id,v_instance.started_by,case when v_stage.step_type='branch' then 'branch_taken' else 'automatic_completed' end,'{}'); if v_stage.step_type='branch' and v_target is not null then perform activate_fms_stage_internal(p_instance_id,v_target,v_instance_stage.id,null,p_guard+1); elsif v_stage.step_type in ('notification','parallel_join') and v_stage.default_next_stage_id is not null then perform activate_fms_stage_internal(p_instance_id,v_stage.default_next_stage_id,v_instance_stage.id,null,p_guard+1); end if; end if;
 return v_instance_stage.id;
end $$;

create function start_fms_instance_with_audit(p_flow_id uuid,p_title text,p_priority task_priority default 'medium',p_context jsonb default '{}',p_branch_id uuid default null,p_department_id uuid default null,p_first_assignee_id uuid default null)
returns table(instance_id uuid,reference_number text) language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_flow fms_flows; v_instance fms_instances; v_start uuid; v_ref text;
begin
 select * into v_actor from current_profile(); if v_actor.id is null or not current_profile_is_active() then raise exception 'Active profile required' using errcode='42501'; end if;
 select * into v_flow from fms_flows where id=p_flow_id for share; p_branch_id=coalesce(p_branch_id,v_flow.branch_id,v_actor.branch_id); p_department_id=coalesce(p_department_id,v_flow.department_id,v_actor.department_id);
 if not can_start_fms_flow(p_flow_id,p_branch_id,p_department_id) then raise exception 'Flow start is outside authorized scope' using errcode='42501'; end if;
 if length(btrim(p_title)) not between 1 and 200 or jsonb_typeof(p_context)<>'object' or pg_column_size(p_context)>32768 or (select count(*) from jsonb_object_keys(p_context))>50 then raise exception 'Invalid instance title or context' using errcode='22023'; end if;
 v_ref='FMS-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||lpad(nextval('fms_reference_sequence')::text,8,'0');
 insert into fms_instances(tenant_id,branch_id,department_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,priority,context,started_by) values(v_actor.tenant_id,p_branch_id,p_department_id,v_flow.id,v_flow.family_id,v_flow.version,v_ref,btrim(p_title),'active',p_priority,p_context,v_actor.id) returning * into v_instance;
 update fms_flows set usage_count=usage_count+1 where id=v_flow.id;
 select id into v_start from fms_stages where fms_flow_id=v_flow.id order by sort_order,id limit 1; perform activate_fms_stage_internal(v_instance.id,v_start,null,p_first_assignee_id,0);
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_actor.tenant_id,v_actor.id,'fms_instance_started','fms_instances',v_instance.id,jsonb_build_object('flow_id',v_flow.id,'version',v_flow.version,'reference_number',v_ref));
 return query select v_instance.id,v_ref;
end $$;

create function claim_fms_stage_with_audit(p_instance_stage_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_stage fms_instance_stages;
begin select * into v_actor from current_profile(); select * into v_stage from fms_instance_stages where id=p_instance_stage_id for update; if v_actor.id is null or not current_profile_is_active() or not v_actor.id=any(v_stage.assigned_to) or v_stage.status not in ('pending','in_progress','in_review','overdue') then raise exception 'Stage cannot be claimed' using errcode='42501'; end if; update fms_instance_stage_assignees set status='claimed',claimed_at=coalesce(claimed_at,now()) where fms_instance_stage_id=p_instance_stage_id and user_profile_id=v_actor.id and is_active; insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_instance_stage_id,v_actor.id,'claimed','{}'); end $$;

create function complete_fms_stage_with_audit(p_instance_stage_id uuid,p_outcome text default null,p_remark text default null,p_checklist jsonb default '{}',p_next_assignee_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_instance_stage fms_instance_stages; v_instance fms_instances; v_stage fms_stages; v_item record; v_satisfied boolean; v_next uuid; v_child uuid;
begin
 select * into v_actor from current_profile(); select * into v_instance_stage from fms_instance_stages where id=p_instance_stage_id for update; select * into v_instance from fms_instances where id=v_instance_stage.fms_instance_id for update; select * into v_stage from fms_stages where id=v_instance_stage.fms_stage_id;
 if v_actor.id is null or not current_profile_is_active() or v_instance.status not in ('active','overdue') or v_instance_stage.status not in ('pending','in_progress','in_review','overdue') then raise exception 'Stage is not actionable' using errcode='23514'; end if;
 if not (v_actor.id=any(v_instance_stage.assigned_to) or (v_actor.user_role in ('super_admin','admin')) or (v_actor.user_role='manager' and v_instance.branch_id=v_actor.branch_id)) then raise exception 'Stage completion denied' using errcode='42501'; end if;
 if v_stage.step_type='approval' and v_actor.user_role not in ('super_admin','admin','manager') then raise exception 'Approval requires manager or administrator authority' using errcode='42501'; end if;
 if jsonb_typeof(p_checklist)<>'object' then raise exception 'Checklist payload must be an object' using errcode='22023'; end if;
 for v_item in select * from fms_instance_checklist_items where fms_instance_stage_id=p_instance_stage_id for update loop
   if coalesce((p_checklist->>v_item.item_key)::boolean,false) then update fms_instance_checklist_items set is_completed=true,completed_by=v_actor.id,completed_at=now() where id=v_item.id; end if;
 end loop;
 if v_stage.requires_remark and nullif(btrim(p_remark),'') is null then raise exception 'A completion remark is required' using errcode='23514'; end if;
 if v_stage.requires_upload and not exists(select 1 from fms_evidence where fms_instance_stage_id=p_instance_stage_id and removed_at is null) then raise exception 'Required evidence upload is missing' using errcode='23514'; end if;
 if exists(select 1 from fms_instance_checklist_items where fms_instance_stage_id=p_instance_stage_id and is_required and not is_completed) then raise exception 'Required checklist items are incomplete' using errcode='23514'; end if;
 if v_stage.form_template_id is not null and not exists(select 1 from form_submissions where form_template_id=v_stage.form_template_id and linked_module='fms_stage' and linked_record_id=p_instance_stage_id) then raise exception 'Exact linked form submission is required' using errcode='23514'; end if;
 if v_stage.requires_next_doer_handoff and p_next_assignee_id is null then raise exception 'Next-stage assignee selection is required' using errcode='23514'; end if;
 if not v_actor.id=any(v_instance_stage.assigned_to) then
   insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by,status,claimed_at,completed_at,outcome,remark)
   values(v_instance.tenant_id,p_instance_stage_id,v_actor.id,v_actor.id,'completed',now(),now(),left(p_outcome,500),left(p_remark,4000));
   update fms_instance_stages set assigned_to=array_append(assigned_to,v_actor.id) where id=p_instance_stage_id;
 else
   update fms_instance_stage_assignees set status='completed',completed_at=now(),outcome=left(p_outcome,500),remark=left(p_remark,4000) where fms_instance_stage_id=p_instance_stage_id and user_profile_id=v_actor.id and is_active;
 end if;
 select case v_stage.completion_rule when 'all_doers' then count(*)>0 and bool_and(status='completed') when 'any_doer' then bool_or(status='completed') else v_actor.user_role in ('super_admin','admin','manager') end into v_satisfied from fms_instance_stage_assignees where fms_instance_stage_id=p_instance_stage_id and is_active;
 insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_instance_stage_id,v_actor.id,'actor_completed',jsonb_build_object('outcome',left(coalesce(p_outcome,''),500),'remark',left(coalesce(p_remark,''),4000)));
 if not v_satisfied then return; end if;
 update fms_instance_stages set status='completed',actual_datetime=now(),completed_by=v_actor.id,remark=nullif(btrim(p_remark),''),outcome=nullif(btrim(p_outcome),'') where id=p_instance_stage_id;
 if v_stage.split_to_flow_id is not null and not exists(select 1 from fms_instances where parent_instance_id=v_instance.id and fms_flow_id=v_stage.split_to_flow_id) then
   select started.instance_id into v_child from start_fms_instance_with_audit(v_stage.split_to_flow_id,v_instance.title,v_instance.priority,v_instance.context,v_instance.branch_id,v_instance.department_id,p_next_assignee_id) started;
   update fms_instances set parent_instance_id=v_instance.id where id=v_child;
 end if;
 v_next=v_stage.default_next_stage_id; if v_next is not null then perform activate_fms_stage_internal(v_instance.id,v_next,p_instance_stage_id,p_next_assignee_id,0); end if;
 if v_next is null and v_stage.step_type<>'end' and not exists(select 1 from fms_instance_stages where fms_instance_id=v_instance.id and status in ('pending','in_progress','in_review','overdue')) then update fms_instances set status='completed',completed_at=now(),updated_at=now() where id=v_instance.id; end if;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_instance.tenant_id,v_actor.id,'fms_stage_completed','fms_instance_stages',p_instance_stage_id,jsonb_build_object('outcome',left(coalesce(p_outcome,''),500)));
end $$;

create function review_fms_stage_with_audit(p_instance_stage_id uuid,p_decision text,p_remark text default null,p_next_assignee_id uuid default null)
returns void language plpgsql security definer set search_path=public as $$
declare v_stage fms_stages; v_actor user_profiles;
begin select * into v_actor from current_profile(); select s.* into v_stage from fms_stages s join fms_instance_stages i on i.fms_stage_id=s.id where i.id=p_instance_stage_id; if v_stage.step_type<>'approval' or p_decision not in ('approved','rejected','revision_requested') then raise exception 'Invalid approval decision' using errcode='22023'; end if; if p_decision='rejected' and not v_stage.can_reject then raise exception 'Rejection is not enabled' using errcode='23514'; end if; if p_decision='revision_requested' and not v_stage.can_request_revision then raise exception 'Revision is not enabled' using errcode='23514'; end if; perform complete_fms_stage_with_audit(p_instance_stage_id,p_decision,p_remark,'{}',p_next_assignee_id); insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_instance_stage_id,v_actor.id,p_decision,jsonb_build_object('remark',left(coalesce(p_remark,''),4000))); end $$;

create function reassign_fms_stage_with_audit(p_instance_stage_id uuid,p_from_user_id uuid,p_to_user_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_s fms_instance_stages; v_i fms_instances; v_target user_profiles;
begin select * into v_actor from current_profile(); select * into v_s from fms_instance_stages where id=p_instance_stage_id for update; select * into v_i from fms_instances where id=v_s.fms_instance_id for update; if v_actor.user_role not in ('super_admin','admin','manager') or (v_actor.user_role='manager' and v_i.branch_id<>v_actor.branch_id) then raise exception 'Reassignment denied' using errcode='42501'; end if; if v_i.status not in ('active','overdue') or v_s.status not in ('pending','in_progress','in_review','overdue') or not p_from_user_id=any(v_s.assigned_to) or p_from_user_id=p_to_user_id or nullif(btrim(p_reason),'') is null then raise exception 'Invalid reassignment' using errcode='23514'; end if; select * into v_target from user_profiles where id=p_to_user_id and tenant_id=v_i.tenant_id and (v_i.branch_id is null or branch_id=v_i.branch_id) and (v_i.department_id is null or department_id=v_i.department_id) and working_status not in ('inactive','resigned') and is_login_enabled; if v_target.id is null then raise exception 'Target is not eligible' using errcode='23514'; end if; update fms_instance_stage_assignees set is_active=false,status='reassigned' where fms_instance_stage_id=p_instance_stage_id and user_profile_id=p_from_user_id and is_active; insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by) values(v_i.tenant_id,p_instance_stage_id,p_to_user_id,v_actor.id); update fms_instance_stages set assigned_to=array_replace(assigned_to,p_from_user_id,p_to_user_id),updated_at=now() where id=p_instance_stage_id; insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_instance_stage_id,v_actor.id,'reassigned',jsonb_build_object('from',p_from_user_id,'to',p_to_user_id,'reason',left(p_reason,1000))); insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_i.tenant_id,v_actor.id,'fms_stage_reassigned','fms_instance_stages',p_instance_stage_id,jsonb_build_object('from',p_from_user_id,'to',p_to_user_id,'reason',left(p_reason,1000))); end $$;

create function move_fms_stage_backward_with_audit(p_instance_stage_id uuid,p_target_stage_id uuid,p_reason text,p_assignee_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_s fms_instance_stages; v_i fms_instances; v_definition fms_stages; v_new uuid;
begin select * into v_actor from current_profile(); select * into v_s from fms_instance_stages where id=p_instance_stage_id for update; select * into v_i from fms_instances where id=v_s.fms_instance_id for update; select * into v_definition from fms_stages where id=p_target_stage_id; if v_actor.user_role not in ('super_admin','admin','manager') or (v_actor.user_role='manager' and v_i.branch_id<>v_actor.branch_id) or not exists(select 1 from fms_stages current where current.id=v_s.fms_stage_id and current.can_move_backward) then raise exception 'Move backward denied' using errcode='42501'; end if; if v_definition.fms_flow_id<>v_i.fms_flow_id or v_definition.sort_order>=(select sort_order from fms_stages where id=v_s.fms_stage_id) or nullif(btrim(p_reason),'') is null then raise exception 'Invalid backward target' using errcode='23514'; end if; update fms_instance_stages set status='blocked',updated_at=now() where fms_instance_id=v_i.id and status in ('pending','in_progress','in_review','overdue'); insert into fms_instance_stages(fms_instance_id,fms_stage_id,status,revision_of_id,previous_instance_stage_id,activated_at) values(v_i.id,p_target_stage_id,'pending',p_instance_stage_id,p_instance_stage_id,now()) returning id into v_new; update fms_instance_stages set assigned_to=resolve_fms_stage_assignees(p_target_stage_id,v_i.id,p_assignee_id),status='in_progress' where id=v_new; insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_new,v_actor.id,'moved_backward',jsonb_build_object('from_stage',v_s.fms_stage_id,'reason',left(p_reason,1000))); insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_i.tenant_id,v_actor.id,'fms_stage_moved_backward','fms_instance_stages',v_new,jsonb_build_object('reason',left(p_reason,1000))); return v_new; end $$;

create function request_fms_revision_with_audit(p_instance_stage_id uuid,p_target_stage_id uuid,p_reason text,p_assignee_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$ begin if not exists(select 1 from fms_instance_stages i join fms_stages s on s.id=i.fms_stage_id where i.id=p_instance_stage_id and s.can_request_revision) then raise exception 'Revision is not enabled' using errcode='23514'; end if; return move_fms_stage_backward_with_audit(p_instance_stage_id,p_target_stage_id,p_reason,p_assignee_id); end $$;

create function escalate_fms_stage_with_audit(p_instance_stage_id uuid,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_s fms_instance_stages; v_i fms_instances; v_manager uuid;
begin select * into v_actor from current_profile(); select * into v_s from fms_instance_stages where id=p_instance_stage_id for update; select * into v_i from fms_instances where id=v_s.fms_instance_id for update; if not (v_actor.id=any(v_s.assigned_to) or v_actor.user_role in ('super_admin','admin') or v_actor.user_role='manager' and v_i.branch_id=v_actor.branch_id) or not exists(select 1 from fms_stages where id=v_s.fms_stage_id and can_escalate) or nullif(btrim(p_reason),'') is null then raise exception 'Escalation denied' using errcode='42501'; end if; select manager_id into v_manager from branches where id=v_i.branch_id; if v_manager is null then select id into v_manager from user_profiles where tenant_id=v_i.tenant_id and user_role in ('admin','super_admin') and working_status not in ('inactive','resigned') and is_login_enabled order by user_role limit 1; end if; if v_manager is null then raise exception 'No escalation recipient is available' using errcode='23514'; end if; update fms_instance_stages set escalation_count=escalation_count+1,last_escalated_at=now() where id=p_instance_stage_id; insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url,channel,delivered_status) values(v_i.tenant_id,v_manager,'fms_stage_escalated','FMS stage escalated',left(p_reason,1000),'/tasks/fms?instance='||v_i.id,'in_app','delivered'); insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_instance_stage_id,v_actor.id,'escalated',jsonb_build_object('recipient',v_manager,'reason',left(p_reason,1000))); insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_i.tenant_id,v_actor.id,'fms_stage_escalated','fms_instance_stages',p_instance_stage_id,jsonb_build_object('recipient',v_manager,'reason',left(p_reason,1000))); end $$;

create function set_fms_instance_status_with_audit(p_instance_id uuid,p_action text,p_reason text)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_i fms_instances; v_next fms_instance_status;
begin select * into v_actor from current_profile(); select * into v_i from fms_instances where id=p_instance_id for update; if v_actor.user_role not in ('super_admin','admin','manager') or (v_actor.user_role='manager' and v_i.branch_id<>v_actor.branch_id) then raise exception 'Instance management denied' using errcode='42501'; end if; if nullif(btrim(p_reason),'') is null or length(p_reason)>1000 then raise exception 'A concise reason is required' using errcode='22023'; end if;
 if p_action='hold' and v_i.status in ('active','overdue') then v_next='on_hold'; update fms_instances set status=v_next,held_by=v_actor.id,held_at=now(),hold_reason=btrim(p_reason),updated_at=now() where id=p_instance_id;
 elsif p_action='resume' and v_i.status='on_hold' then v_next='active'; update fms_instances set status=v_next,held_by=null,held_at=null,hold_reason=null,updated_at=now() where id=p_instance_id;
 elsif p_action='cancel' and v_i.status not in ('completed','cancelled') then v_next='cancelled'; update fms_instances set status=v_next,cancelled_by=v_actor.id,cancelled_at=now(),cancel_reason=btrim(p_reason),updated_at=now() where id=p_instance_id; update fms_instance_stages set status='blocked',updated_at=now() where fms_instance_id=p_instance_id and status in ('pending','in_progress','in_review','overdue'); update fms_instance_stage_assignees set status='cancelled',is_active=false where fms_instance_stage_id in(select id from fms_instance_stages where fms_instance_id=p_instance_id) and is_active;
 else raise exception 'Invalid instance state transition' using errcode='23514'; end if;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_i.tenant_id,v_actor.id,'fms_instance_'||p_action,'fms_instances',p_instance_id,jsonb_build_object('status',v_i.status),jsonb_build_object('status',v_next,'reason',btrim(p_reason)));
end $$;
create function hold_fms_instance_with_audit(p_instance_id uuid,p_reason text) returns void language sql security definer set search_path=public as $$select set_fms_instance_status_with_audit(p_instance_id,'hold',p_reason)$$;
create function resume_fms_instance_with_audit(p_instance_id uuid,p_reason text) returns void language sql security definer set search_path=public as $$select set_fms_instance_status_with_audit(p_instance_id,'resume',p_reason)$$;
create function cancel_fms_instance_with_audit(p_instance_id uuid,p_reason text) returns void language sql security definer set search_path=public as $$select set_fms_instance_status_with_audit(p_instance_id,'cancel',p_reason)$$;

create function update_fms_checklist_item_with_audit(p_item_id uuid,p_completed boolean)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_item fms_instance_checklist_items; v_s fms_instance_stages; v_i fms_instances;
begin select * into v_actor from current_profile(); select * into v_item from fms_instance_checklist_items where id=p_item_id for update; select * into v_s from fms_instance_stages where id=v_item.fms_instance_stage_id for update; select * into v_i from fms_instances where id=v_s.fms_instance_id; if v_i.status not in ('active','overdue') or v_s.status not in ('pending','in_progress','in_review','overdue') or not (v_actor.id=any(v_s.assigned_to) or v_actor.user_role in ('super_admin','admin') or v_actor.user_role='manager' and v_i.branch_id=v_actor.branch_id) then raise exception 'Checklist update denied' using errcode='42501'; end if; update fms_instance_checklist_items set is_completed=p_completed,completed_by=case when p_completed then v_actor.id else null end,completed_at=case when p_completed then now() else null end where id=p_item_id; insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(v_s.id,v_actor.id,'checklist_updated',jsonb_build_object('item_id',p_item_id,'completed',p_completed)); end $$;

create function register_fms_evidence_with_audit(p_instance_stage_id uuid,p_storage_path text,p_original_filename text,p_mime_type text,p_size_bytes bigint)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_s fms_instance_stages; v_i fms_instances; v_id uuid; v_expected_prefix text;
begin select * into v_actor from current_profile(); select * into v_s from fms_instance_stages where id=p_instance_stage_id for update; select * into v_i from fms_instances where id=v_s.fms_instance_id; if v_i.status not in ('active','overdue') or v_s.status not in ('pending','in_progress','in_review','overdue') or not (v_actor.id=any(v_s.assigned_to) or v_actor.user_role in ('super_admin','admin') or v_actor.user_role='manager' and v_i.branch_id=v_actor.branch_id) then raise exception 'Evidence upload denied' using errcode='42501'; end if; v_expected_prefix=v_i.tenant_id::text||'/'||p_instance_stage_id::text||'/'; if p_storage_path not like v_expected_prefix||'%' or p_storage_path like '%..%' or p_mime_type not in ('image/jpeg','image/png','image/webp','application/pdf') or p_size_bytes not between 1 and 10485760 or lower(p_original_filename)!~'\.(jpg|jpeg|png|webp|pdf)$' then raise exception 'Invalid evidence metadata' using errcode='22023'; end if; if not exists(select 1 from storage.objects where bucket_id='fms-evidence' and name=p_storage_path and owner_id=auth.uid()::text) then raise exception 'Uploaded object is not owned by the caller' using errcode='42501'; end if; insert into fms_evidence(tenant_id,fms_instance_stage_id,storage_path,original_filename,mime_type,size_bytes,uploaded_by) values(v_i.tenant_id,p_instance_stage_id,p_storage_path,btrim(p_original_filename),p_mime_type,p_size_bytes,v_actor.id) returning id into v_id; insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_instance_stage_id,v_actor.id,'evidence_registered',jsonb_build_object('evidence_id',v_id,'mime_type',p_mime_type,'size_bytes',p_size_bytes)); insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(v_i.tenant_id,v_actor.id,'fms_evidence_registered','fms_evidence',v_id,jsonb_build_object('stage_id',p_instance_stage_id,'mime_type',p_mime_type,'size_bytes',p_size_bytes)); return v_id; end $$;

alter function submit_form_with_audit(uuid,jsonb,text,uuid) rename to submit_form_base_with_audit;
revoke all on function submit_form_base_with_audit(uuid,jsonb,text,uuid) from public,anon,authenticated,service_role;
create function submit_form_with_audit(p_form_template_id uuid,p_answers jsonb,p_linked_module text default null,p_linked_record_id uuid default null)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_s fms_instance_stages; v_i fms_instances; v_stage fms_stages; v_submission uuid;
begin
 if p_linked_module is distinct from 'fms_stage' then return submit_form_base_with_audit(p_form_template_id,p_answers,p_linked_module,p_linked_record_id); end if;
 select * into v_actor from current_profile(); select * into v_s from fms_instance_stages where id=p_linked_record_id for update; select * into v_i from fms_instances where id=v_s.fms_instance_id; select * into v_stage from fms_stages where id=v_s.fms_stage_id;
 if v_actor.id is null or not current_profile_is_active() or v_i.status not in ('active','overdue') or v_s.status not in ('pending','in_progress','in_review','overdue') or v_stage.form_template_id<>p_form_template_id or not (v_actor.id=any(v_s.assigned_to) or v_actor.user_role in ('super_admin','admin') or v_actor.user_role='manager' and v_i.branch_id=v_actor.branch_id) then raise exception 'FMS stage does not require this exact form version for this caller' using errcode='42501'; end if;
 if exists(select 1 from form_submissions where linked_module='fms_stage' and linked_record_id=p_linked_record_id) then raise exception 'This stage already has its immutable form submission' using errcode='23505'; end if;
 v_submission=submit_form_base_with_audit(p_form_template_id,p_answers,null,null); update form_submissions set linked_module='fms_stage',linked_record_id=p_linked_record_id,branch_id=v_i.branch_id,department_id=v_i.department_id where id=v_submission; update fms_instance_stages set form_submission_id=v_submission where id=p_linked_record_id; insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details) values(p_linked_record_id,v_actor.id,'form_submitted',jsonb_build_object('submission_id',v_submission,'template_id',p_form_template_id)); return v_submission;
end $$;
create unique index idx_form_submission_one_fms_stage on form_submissions(linked_record_id) where linked_module='fms_stage';

create function prevent_active_fms_form_archive() returns trigger language plpgsql set search_path=public as $$ begin if old.lifecycle='published' and new.lifecycle='archived' and exists(select 1 from fms_stages d join fms_instance_stages s on s.fms_stage_id=d.id join fms_instances i on i.id=s.fms_instance_id where d.form_template_id=old.id and i.status in ('active','overdue','on_hold') and s.status in ('pending','in_progress','in_review','overdue')) then raise exception 'Form version is pinned by an active FMS stage' using errcode='23514'; end if; return new; end $$;
create trigger form_archive_active_fms_guard before update on form_templates for each row execute function prevent_active_fms_form_archive();

create unique index idx_fms_child_once on fms_instances(parent_instance_id,fms_flow_id) where parent_instance_id is not null;

alter table fms_instance_stage_assignees enable row level security;
alter table fms_instance_checklist_items enable row level security;
alter table fms_evidence enable row level security;
alter table notifications enable row level security;

drop policy if exists flow_select on fms_flows;
create policy flow_select on fms_flows for select to authenticated using ((select current_profile_is_active()) and tenant_id=(select current_tenant_id()) and ((select current_role_level()) in ('super_admin','admin') or status='published' and is_active and ((branch_id is null) or branch_id=(select current_branch_id()))));
drop policy if exists flow_insert on fms_flows; drop policy if exists flow_update on fms_flows; drop policy if exists flow_delete on fms_flows;
drop policy if exists fms_stages_task_feed_select on fms_stages;
create policy fms_stages_select on fms_stages for select to authenticated using(exists(select 1 from fms_flows f where f.id=fms_stages.fms_flow_id));
drop policy if exists fms_instances_task_feed_select on fms_instances;
create policy fms_instances_select on fms_instances for select to authenticated using(can_read_fms_instance(id));
drop policy if exists fms_instance_stages_task_feed_select on fms_instance_stages;
create policy fms_instance_stages_select on fms_instance_stages for select to authenticated using(can_read_fms_instance(fms_instance_id));
create policy fms_actor_select on fms_instance_stage_assignees for select to authenticated using(exists(select 1 from fms_instance_stages s where s.id=fms_instance_stage_id and can_read_fms_instance(s.fms_instance_id)));
create policy fms_checklist_select on fms_instance_checklist_items for select to authenticated using(exists(select 1 from fms_instance_stages s where s.id=fms_instance_stage_id and can_read_fms_instance(s.fms_instance_id)));
create policy fms_evidence_select on fms_evidence for select to authenticated using(exists(select 1 from fms_instance_stages s where s.id=fms_instance_stage_id and can_read_fms_instance(s.fms_instance_id)));
drop policy if exists fms_stage_logs_select on fms_stage_logs;
create policy fms_stage_logs_select on fms_stage_logs for select to authenticated using(
  (select current_profile_is_active()) and exists(
    select 1
    from fms_instance_stages s
    join fms_instances i on i.id=s.fms_instance_id
    where s.id=fms_instance_stage_id
      and i.tenant_id=(select current_tenant_id())
      and (
        (select current_role_level()) in ('super_admin','admin')
        or ((select current_role_level())='manager' and i.branch_id=(select current_branch_id()))
        or i.started_by=(select (current_profile()).id)
        or (
          (select current_role_level()) in ('crm','staff','doer')
          and (select (current_profile()).id)=any(s.assigned_to)
        )
      )
  )
);
drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications for select to authenticated using((select current_profile_is_active()) and tenant_id=(select current_tenant_id()) and user_profile_id=(select (current_profile()).id));

create function can_write_fms_evidence_object(p_name text) returns boolean language sql stable security definer set search_path=public,storage as $$
 select exists(select 1 from user_profiles actor join fms_instance_stages s on split_part(p_name,'/',2)=s.id::text join fms_instances i on i.id=s.fms_instance_id where actor.auth_user_id=auth.uid() and split_part(p_name,'/',1)=actor.tenant_id::text and i.tenant_id=actor.tenant_id and i.status in ('active','overdue') and s.status in ('pending','in_progress','in_review','overdue') and (actor.id=any(s.assigned_to) or actor.user_role in ('super_admin','admin') or actor.user_role='manager' and i.branch_id=actor.branch_id));
$$;
create function can_read_fms_evidence_object(p_name text) returns boolean language sql stable security definer set search_path=public,storage as $$ select exists(select 1 from fms_evidence e join fms_instance_stages s on s.id=e.fms_instance_stage_id where e.storage_path=p_name and e.removed_at is null and can_read_fms_instance(s.fms_instance_id)); $$;
create policy fms_evidence_objects_insert on storage.objects for insert to authenticated with check(bucket_id='fms-evidence' and owner_id=auth.uid()::text and can_write_fms_evidence_object(name));
create policy fms_evidence_objects_select on storage.objects for select to authenticated using(bucket_id='fms-evidence' and can_read_fms_evidence_object(name));

revoke all privileges on table fms_flows,fms_stages,fms_stage_assignees,fms_branch_rules,fms_instances,fms_instance_stages,fms_stage_logs,fms_instance_stage_assignees,fms_instance_checklist_items,fms_evidence from public,anon,authenticated,service_role;
grant select on table fms_flows,fms_stages,fms_stage_assignees,fms_branch_rules,fms_instances,fms_instance_stages,fms_stage_logs,fms_instance_stage_assignees,fms_instance_checklist_items,fms_evidence to authenticated;

do $$ declare f record; begin for f in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like '%fms%' or p.proname='submit_form_base_with_audit') loop execute format('alter function %s owner to postgres',f.identity); execute format('revoke all on function %s from public,anon,authenticated,service_role',f.identity); end loop; end $$;
grant execute on function can_manage_fms_flow(uuid),can_read_fms_instance(uuid),can_start_fms_flow(uuid,uuid,uuid),save_fms_flow_draft_with_audit(uuid,jsonb,jsonb),create_fms_revision_with_audit(uuid),publish_fms_flow_with_audit(uuid),archive_fms_flow_with_audit(uuid,text),start_fms_instance_with_audit(uuid,text,task_priority,jsonb,uuid,uuid,uuid),claim_fms_stage_with_audit(uuid),complete_fms_stage_with_audit(uuid,text,text,jsonb,uuid),review_fms_stage_with_audit(uuid,text,text,uuid),reassign_fms_stage_with_audit(uuid,uuid,uuid,text),move_fms_stage_backward_with_audit(uuid,uuid,text,uuid),request_fms_revision_with_audit(uuid,uuid,text,uuid),escalate_fms_stage_with_audit(uuid,text),hold_fms_instance_with_audit(uuid,text),resume_fms_instance_with_audit(uuid,text),cancel_fms_instance_with_audit(uuid,text),update_fms_checklist_item_with_audit(uuid,boolean),register_fms_evidence_with_audit(uuid,text,text,text,bigint),can_write_fms_evidence_object(text),can_read_fms_evidence_object(text) to authenticated;
grant execute on function submit_form_with_audit(uuid,jsonb,text,uuid) to authenticated;
grant execute on function is_fms_instance_participant(uuid) to authenticated;

notify pgrst,'reload schema';
create trigger fms_flows_immutable before update or delete on fms_flows for each row execute function enforce_fms_definition_immutability();
create trigger fms_stages_immutable before insert or update or delete on fms_stages for each row execute function enforce_fms_definition_immutability();

create function assert_fms_flow_publishable(p_flow_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_flow fms_flows; v_count integer; v_reached integer;
begin
  select * into v_flow from fms_flows where id=p_flow_id for update;
  if v_flow.id is null or v_flow.status<>'draft' then raise exception 'Draft flow not found' using errcode='23514'; end if;
  select count(*) into v_count from fms_stages where fms_flow_id=p_flow_id;
  if v_count=0 then raise exception 'Flow cannot be empty' using errcode='23514'; end if;
  if not exists(select 1 from fms_stages where fms_flow_id=p_flow_id and sort_order=0) or not exists(select 1 from fms_stages where fms_flow_id=p_flow_id and step_type='end') then raise exception 'Flow requires a start and end path' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and ((s.step_type='form' and s.form_template_id is null) or (s.step_type='parallel_start' and cardinality(s.parallel_target_stage_ids)=0) or (s.step_type='parallel_join' and (s.join_rule is null or s.join_rule='specific' and cardinality(s.join_required_stage_ids)=0)) or (s.step_type='approval' and s.completion_rule<>'manager_approval') or (s.completion_rule='all_doers' and not s.allow_multiple_doers))) then raise exception 'Stage configuration is incomplete or incompatible' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join form_templates f on f.id=s.form_template_id where s.fms_flow_id=p_flow_id and (f.tenant_id<>v_flow.tenant_id or f.lifecycle<>'published' or not f.is_active)) then raise exception 'Linked forms must be exact active published tenant versions' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s join fms_flows target on target.id=s.split_to_flow_id where s.fms_flow_id=p_flow_id and (target.tenant_id<>v_flow.tenant_id or target.status<>'published' or not target.is_active)) then raise exception 'Split flows must be active published tenant versions' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.default_next_stage_id is not null and not exists(select 1 from fms_stages n where n.id=s.default_next_stage_id and n.fms_flow_id=p_flow_id)) then raise exception 'Dangling next stage reference' using errcode='23514'; end if;
  if exists(select 1 from fms_stages s where s.fms_flow_id=p_flow_id and s.step_type='branch' and (select count(*) from fms_branch_rules r where r.fms_stage_id=s.id and r.condition_operator='default')<>1) then raise exception 'Branch stages require exactly one default route' using errcode='23514'; end if;
  with recursive walk(id,path,cycle) as (
    select id,array[id],false from fms_stages where fms_flow_id=p_flow_id and sort_order=0
    union all
    select edge.next_id,w.path||edge.next_id,edge.next_id=any(w.path)
    from walk w join fms_stages s on s.id=w.id
    cross join lateral (select s.default_next_stage_id next_id where s.default_next_stage_id is not null union select unnest(s.parallel_target_stage_ids) union select r.next_stage_id from fms_branch_rules r where r.fms_stage_id=s.id and r.next_stage_id is not null) edge
    where not w.cycle
  ) select count(distinct id),coalesce(bool_or(cycle),false)::integer into v_reached,v_count from walk;
  if v_reached<>(select count(*) from fms_stages where fms_flow_id=p_flow_id) then raise exception 'Flow contains unreachable stages' using errcode='23514'; end if;
  if v_count=1 then raise exception 'Flow contains an unsupported cycle' using errcode='23514'; end if;
end $$;
