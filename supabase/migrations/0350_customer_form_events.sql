-- Optional reviewed customer mappings and immutable events around existing transactions.
-- No HTTP call, routing override, historic rewrite or customer master is introduced.
set search_path=public,extensions;

create table form_customer_mapping_versions (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id),
 template_id uuid not null, version integer not null check(version>0), descriptor jsonb not null,
 digest text not null, enabled boolean not null, created_by uuid not null references user_profiles(id),
 created_at timestamptz not null default clock_timestamp(), unique(template_id,version)
);
alter table form_customer_mapping_versions enable row level security;
create policy module_accessible on form_customer_mapping_versions as restrictive for select to authenticated using(module_accessible('forms_library'));
revoke all on form_customer_mapping_versions from public,anon,authenticated,service_role;
create index form_customer_mapping_template on form_customer_mapping_versions(template_id,version desc);

create table crm_sync.customer_events (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 source_type text not null check(source_type in ('form.submitted','stage.completed','workflow.changed')),
 source_id uuid not null,mapping_id uuid not null references public.form_customer_mapping_versions(id),
 payload jsonb not null check(jsonb_typeof(payload)='object'),payload_digest text not null,
 created_at timestamptz not null default clock_timestamp(),attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),lease_token uuid,lease_until timestamptz,
 delivered_at timestamptz,review_at timestamptz,dead_at timestamptz,rejected_at timestamptz,last_error text,
 result jsonb, unique(source_type,source_id),check(attempts>=0),check(length(last_error)<=80)
);
create index customer_events_due on crm_sync.customer_events(next_attempt_at,id) where delivered_at is null and dead_at is null and review_at is null and rejected_at is null;
create index customer_events_tenant on crm_sync.customer_events(tenant_id,created_at desc);
create table crm_sync.submission_mappings (
 submission_id uuid primary key references public.form_submissions(id),mapping_id uuid not null references public.form_customer_mapping_versions(id)
);
create table crm_sync.customer_workflow_links (
 tenant_id uuid not null,instance_id uuid primary key references public.fms_instances(id),client_id uuid not null,
 acknowledgement_version bigint not null default 1,acknowledged_at timestamptz not null default clock_timestamp()
);
alter table crm_sync.customer_events enable row level security;
alter table crm_sync.submission_mappings enable row level security;
alter table crm_sync.customer_workflow_links enable row level security;
revoke all on crm_sync.customer_events,crm_sync.submission_mappings,crm_sync.customer_workflow_links from public,anon,authenticated,service_role;

create function crm_sync.customer_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'Customer integration evidence is immutable' using errcode='23514'; end if;
 if tg_table_name='form_customer_mapping_versions' or
   (new.id,new.tenant_id,new.source_type,new.source_id,new.mapping_id,new.payload,new.payload_digest,new.created_at)
   is distinct from (old.id,old.tenant_id,old.source_type,old.source_id,old.mapping_id,old.payload,old.payload_digest,old.created_at) then
   raise exception 'Customer integration evidence is immutable' using errcode='23514';
 end if;
 return new;
end $$;
-- Separate mapping trigger avoids accessing event-specific record columns.
create function crm_sync.mapping_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Published customer mappings are immutable' using errcode='23514'; end $$;
create trigger customer_mapping_immutable before update or delete on form_customer_mapping_versions for each row execute function crm_sync.mapping_immutable();
create trigger customer_event_immutable before update or delete on crm_sync.customer_events for each row execute function crm_sync.customer_immutable();

-- Hash only form interpretation, excluding mutable timestamps/title/permissions.
create function crm_sync.customer_definition_digest(p_snapshot jsonb) returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(jsonb_build_object('id',p_snapshot#>'{template,id}','version',p_snapshot#>'{template,version}','sections',p_snapshot#>'{template,sections}',
 'fields',(select coalesce(jsonb_agg(jsonb_build_object('key',f->'field_key','label',f->'field_name','type',f->'field_type','options',f->'options','shown',f->'is_shown','condition',f->'conditional_logic','section',f->'group_name','branches',f->'branch_logic','order',f->'sort_order') order by f->>'field_key'),'[]') from jsonb_array_elements(p_snapshot->'fields') f))::text,'sha256'),'hex');
$$;
revoke all on function crm_sync.customer_definition_digest(jsonb) from public,anon,authenticated,service_role;

-- Preserve the existing reachability algorithm once, parameterized by the saved
-- definition. The live form engine calls the same implementation with current rows.
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.form_reachable_sections(uuid,jsonb)'::regprocedure);
 if position('from form_templates where id = p_template_id' in definition)=0 or position('ff.form_template_id = p_template_id' in definition)=0 then raise exception 'Review form reachability source markers';end if;
 definition:=replace(definition,'public.form_reachable_sections(p_template_id uuid, p_answers jsonb)','crm_sync.snapshot_reachable_sections(p_snapshot jsonb, p_answers jsonb)');
 definition:=replace(definition,'select coalesce(sections,''[]''::jsonb) into v_sections from form_templates where id = p_template_id;', 'v_sections:=coalesce(p_snapshot#>''{template,sections}'',''[]''::jsonb);');
 definition:=replace(definition,'select * from form_fields ff','select * from jsonb_populate_recordset(null::form_fields,p_snapshot->''fields'') ff');
 definition:=replace(definition,'where ff.form_template_id = p_template_id','where true');
 execute definition;
end $$;
revoke all on function crm_sync.snapshot_reachable_sections(jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function crm_sync.snapshot_reachable_sections(jsonb,jsonb) to postgres;
create or replace function public.form_reachable_sections(p_template_id uuid,p_answers jsonb) returns text[] language sql stable set search_path=public as $$
 select crm_sync.snapshot_reachable_sections(jsonb_build_object('template',to_jsonb(t),'fields',coalesce((select jsonb_agg(to_jsonb(f) order by f.sort_order,f.id) from form_fields f where f.form_template_id=t.id),'[]')),p_answers) from form_templates t where t.id=p_template_id;
$$;

create function crm_sync.save_customer_mapping(p_template_id uuid,p_config jsonb,p_source_submission uuid) returns jsonb
language plpgsql security definer set search_path=public,extensions as $$
declare a user_profiles:=current_profile();t form_templates;m form_customer_mapping_versions;item jsonb;f form_fields;
 fields jsonb:='[]'; descriptor jsonb;checksum text;key text;mode text;destination text;seen text[]:='{}';n integer;snapshot jsonb;
begin
 perform assert_module_access('forms_library');
 if a.id is null or not current_profile_is_active() or not has_permission('forms.manage') then raise exception 'Form author access required' using errcode='42501';end if;
 if p_source_submission is not null then
  perform customer_integration_health();
  select template_snapshot into snapshot from form_submissions where id=p_source_submission and tenant_id=a.tenant_id and status='submitted' for share;
  if snapshot is null then raise exception 'Original submitted definition required' using errcode='42501';end if;
  t:=jsonb_populate_record(null::form_templates,snapshot->'template');
 else
  select * into t from form_templates where id=p_template_id and tenant_id=a.tenant_id for update;
  select jsonb_build_object('template',to_jsonb(t),'fields',coalesce(jsonb_agg(to_jsonb(ff) order by ff.sort_order,ff.id),'[]')) into snapshot from form_fields ff where ff.form_template_id=t.id;
 end if;
 if t.id is null or t.tenant_id is distinct from a.tenant_id then raise exception 'Form unavailable' using errcode='42501';end if;
 if jsonb_typeof(p_config) is distinct from 'object' or pg_column_size(p_config)>65536
   or p_config->>'schemaVersion' is distinct from '1' or jsonb_typeof(p_config->'enabled') is distinct from 'boolean'
   or coalesce(p_config->>'channel','') !~ '^[A-Z][A-Z0-9_]{0,39}$'
   or length(btrim(coalesce(p_config->>'identityScope',''))) not between 1 and 120
   or jsonb_typeof(p_config->'fields') is distinct from 'array' then raise exception 'Invalid customer mapping' using errcode='22023';end if;
 if jsonb_array_length(p_config->'fields')>250 then raise exception 'Too many mapped questions' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(p_config->'fields') loop
   key:=item->>'fieldKey';mode:=item->>'mode';destination:=item->>'destination';
   select * into f from jsonb_populate_recordset(null::form_fields,snapshot->'fields') original where original.field_key=key;
   if f.id is null or key=any(seen) or mode is null or mode not in ('operational','profile','history','both') or destination is null
    or destination not in ('primary_name','primary_phone','secondary_phone','billing_phone','crm_client_id','instagram','whatsapp','email','website_chat','external_reference','city','dob','anniversary','communication_preference','budget','product_interest','occasion','requirement','next_follow_up','outcome','contact_outcome','note','source')
    or (mode<>'operational' and f.field_type in ('user_dropdown','branch_dropdown','department_dropdown','section_header','divider','file'))
    or (mode<>'operational' and destination in ('dob','anniversary','next_follow_up') and f.field_type<>'date')
    or (mode<>'operational' and destination='budget' and f.field_type not in ('number','currency'))
    or (mode<>'operational' and destination in ('primary_phone','secondary_phone','billing_phone') and f.field_type not in ('phone','text')) then
     raise exception 'Invalid mapped question or destination' using errcode='22023';end if;
   seen:=array_append(seen,key);
   if item ? 'contactConfirmedValues' then
    if destination<>'contact_outcome' or jsonb_typeof(item->'contactConfirmedValues') is distinct from 'array' then raise exception 'Invalid contact outcome mapping' using errcode='22023';end if;
    if jsonb_array_length(item->'contactConfirmedValues')>0 and (coalesce(item->>'contactKind','') not in ('CALL','MESSAGE','THANK_YOU','NOTE') or coalesce(item->>'contactChannel','') not in ('PHONE','WHATSAPP','INSTAGRAM','EMAIL','IN_PERSON','OTHER')) then raise exception 'Specify the actual contact kind and channel' using errcode='22023';end if;
    if exists(select 1 from jsonb_array_elements(item->'contactConfirmedValues') selected where jsonb_typeof(selected)<>'string' or not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(f.options)='array' then f.options else '[]'::jsonb end) option where option->'value'=selected)) then raise exception 'Unknown confirmed contact option' using errcode='22023';end if;
   end if;
   fields:=fields||jsonb_build_array(jsonb_build_object('fieldKey',key,'mode',mode,'destination',destination,
     'label',f.field_name,'type',f.field_type,'options',coalesce(f.options,'[]'),'sectionKey',form_field_section_key(f.group_name,t.sections))||case when item ? 'contactConfirmedValues' then jsonb_build_object('contactConfirmedValues',item->'contactConfirmedValues','contactKind',item->'contactKind','contactChannel',item->'contactChannel') else '{}'::jsonb end);
 end loop;
 descriptor:=jsonb_build_object('schemaVersion',1,'sourceProject','jewelos','tenantId',t.tenant_id,'templateId',t.id,
  'templateVersion',t.version,'familyId',t.family_id,'enabled',p_config->'enabled','channel',p_config->>'channel',
  'identityScope',btrim(p_config->>'identityScope'),'fields',fields,'definitionDigest',crm_sync.customer_definition_digest(snapshot))
  ||case when p_source_submission is null then '{}'::jsonb else jsonb_build_object('historicalSnapshotDigest',encode(digest(snapshot::text,'sha256'),'hex')) end;
 perform pg_advisory_xact_lock(hashtextextended('customer.mapping.'||t.id,0));
 select * into m from form_customer_mapping_versions where template_id=t.id order by version desc limit 1;
 if m.descriptor-'mappingVersion'=descriptor then return to_jsonb(m);end if;
 n:=coalesce(m.version,0)+1;
 descriptor:=descriptor||jsonb_build_object('mappingVersion',n);
 checksum:=encode(digest(descriptor::text,'sha256'),'hex');
 insert into form_customer_mapping_versions(tenant_id,template_id,version,descriptor,digest,enabled,created_by)
 values(t.tenant_id,t.id,n,descriptor,checksum,(p_config->>'enabled')::boolean,a.id) returning * into m;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
 values(a.tenant_id,a.id,'form_customer_mapping_saved','forms',t.id,jsonb_build_object('mapping_id',m.id,'version',n,'enabled',m.enabled));
 return to_jsonb(m);
end $$;

revoke all on function crm_sync.save_customer_mapping(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
create function save_form_customer_mapping(p_template_id uuid,p_config jsonb) returns jsonb language sql security definer set search_path='' as $$
 select crm_sync.save_customer_mapping(p_template_id,p_config,null);
$$;
create function save_historical_customer_mapping(p_submission_id uuid,p_config jsonb) returns jsonb language sql security definer set search_path='' as $$
 select crm_sync.save_customer_mapping(null,p_config,p_submission_id);
$$;
revoke all on function save_historical_customer_mapping(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function save_historical_customer_mapping(uuid,jsonb) to authenticated;

create function get_form_customer_mapping(p_template_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();begin
 perform assert_module_access('forms_library');
 if a.id is null or not current_profile_is_active() or not has_permission('forms.manage') then raise exception 'Form author access required' using errcode='42501';end if;
 return (select to_jsonb(m) from form_customer_mapping_versions m where template_id=p_template_id and tenant_id=a.tenant_id and not(m.descriptor ? 'historicalSnapshotDigest') order by version desc limit 1);
end $$;

create function crm_sync.pin_customer_mapping() returns trigger language plpgsql security definer set search_path=public as $$
declare m form_customer_mapping_versions;
begin
 select * into m from form_customer_mapping_versions where template_id=new.form_template_id and tenant_id=new.tenant_id and not(descriptor ? 'historicalSnapshotDigest') order by version desc limit 1;
 if m.enabled and new.status='submitted' then insert into crm_sync.submission_mappings values(new.id,m.id);end if;
 return null;
end $$;
create trigger customer_mapping_pin after insert on form_submissions for each row execute function crm_sync.pin_customer_mapping();

create function crm_sync.capture_customer_submission(p_id uuid) returns void language plpgsql security definer set search_path=public,extensions as $$
declare s form_submissions;m form_customer_mapping_versions;w fms_instance_stages;i fms_instances;d fms_stages;
 item jsonb;original jsonb;field jsonb;answers jsonb:='[]';payload jsonb;reached text[];section_key text;labels jsonb;
begin
 select * into s from form_submissions where id=p_id and status='submitted';
 select v.* into m from crm_sync.submission_mappings pin join form_customer_mapping_versions v on v.id=pin.mapping_id where pin.submission_id=s.id;
 if s.id is null or m.id is null then return;end if;
 select * into w from fms_instance_stages where form_submission_id=s.id order by created_at,id limit 1;
 if w.id is not null then select * into i from fms_instances where id=w.fms_instance_id;select * into d from fms_stages where id=w.fms_stage_id;
   section_key:=nullif(d.planned_time_rule->>'formSectionKey','');
 end if;
 reached:=case when section_key is not null then array[section_key] else crm_sync.snapshot_reachable_sections(s.template_snapshot,s.data) end;
 for item in select value from jsonb_array_elements(m.descriptor->'fields') loop
   if item->>'mode'='operational' or not(s.data ? (item->>'fieldKey')) then continue;end if;
   original:=s.data->(item->>'fieldKey');
   if original='null' or original='[]' or (jsonb_typeof(original)='string' and btrim(original#>>'{}')='') then continue;end if;
   select value into field from jsonb_array_elements(s.template_snapshot->'fields') where value->>'field_key'=item->>'fieldKey';
   -- The saved submission snapshot, not today's editable form, determines labels/options/visibility.
   if field is null or field->>'is_shown'='false' or not form_condition_matches(field->'conditional_logic',s.data)
     or (reached is not null and not form_field_section_key(field->>'group_name',s.template_snapshot#>'{template,sections}')=any(reached)) then continue;end if;
   if field->'rule_definition' is not null and field->'rule_definition'<>'null'::jsonb and not form_condition_matches(field->'rule_definition',s.data) then continue;end if;
   select coalesce(jsonb_agg(option->'label'),'[]') into labels from jsonb_array_elements(case when jsonb_typeof(field->'options')='array' then field->'options' else '[]'::jsonb end) option
    where option->'value'=original or (jsonb_typeof(original)='array' and original @> jsonb_build_array(option->'value'));
   answers:=answers||jsonb_build_array(jsonb_build_object('fieldKey',item->>'fieldKey','label',field->>'field_name',
    'type',field->>'field_type','mode',item->>'mode','destination',item->>'destination','original',original,
    'normalized',case when jsonb_typeof(original)='string' then to_jsonb(btrim(original#>>'{}')) else original end,'optionLabels',labels));
 end loop;
 if jsonb_array_length(answers)=0 then return;end if;
 payload:=jsonb_build_object('schemaVersion',1,'sourceProject','jewelos','tenantId',s.tenant_id,'branchId',s.branch_id,'departmentId',s.department_id,
   'eventId','jewelos.form.'||s.id,'eventType','form.submitted','submissionId',s.id,'actorId',s.submitted_by,'occurredAt',s.submitted_at,
   'mappingId',m.id,'mappingVersion',m.version,'mappingDigest',m.digest,'formTemplateId',s.template_snapshot#>'{template,id}','formVersion',s.template_snapshot#>'{template,version}','formFamilyId',s.template_snapshot#>'{template,family_id}','channel',m.descriptor->>'channel','identityScope',m.descriptor->>'identityScope',
   'journeyKey',coalesce(i.id,s.id),'isStartingForm',case when i.id is null then true else d.id=(select id from fms_stages where fms_flow_id=i.fms_flow_id order by sort_order,id limit 1) end,
   'actorName',(select employee_name from user_profiles where id=s.submitted_by and tenant_id=s.tenant_id),'workflow',case when i.id is null then null else jsonb_build_object('instanceId',i.id,'parentInstanceId',i.parent_instance_id,'flowId',i.fms_flow_id,
    'referenceNumber',i.reference_number,'instanceStageId',w.id,'stageId',d.id,'stageKey',d.stage_key,'stageName',d.name,
    'assignedUserIds',w.assigned_to,'assignedEmployees',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',employee_name)),'[]') from user_profiles where tenant_id=s.tenant_id and id=any(w.assigned_to)),'status',w.status) end,'answers',answers);
 insert into crm_sync.customer_events(tenant_id,source_type,source_id,mapping_id,payload,payload_digest)
 values(s.tenant_id,'form.submitted',s.id,m.id,payload,encode(digest(payload::text,'sha256'),'hex')) on conflict(source_type,source_id) do nothing;
end $$;
create function crm_sync.capture_customer_submission_trigger() returns trigger language plpgsql security definer set search_path='' as $$
begin perform crm_sync.capture_customer_submission(new.id);return null;end $$;
create constraint trigger customer_submission_capture after insert on form_submissions deferrable initially deferred for each row execute function crm_sync.capture_customer_submission_trigger();

create function crm_sync.capture_customer_stage() returns trigger language plpgsql security definer set search_path=public,extensions as $$
 declare w fms_instance_stages;i fms_instances;d fms_stages;m uuid;p jsonb;kind text;
begin
 if new.action not in ('actor_completed','approved','rejected','revision_requested','reassigned','moved_backward','cancelled') then return null;end if;
 select * into w from fms_instance_stages where id=new.fms_instance_stage_id;
 select * into i from fms_instances where id=w.fms_instance_id;select * into d from fms_stages where id=w.fms_stage_id;
 select pin.mapping_id into m from crm_sync.submission_mappings pin join form_submissions s on s.id=pin.submission_id
  where s.id=w.form_submission_id or exists(select 1 from fms_instance_stages first_work where first_work.fms_instance_id=i.id and first_work.form_submission_id=s.id)
  order by (s.id=w.form_submission_id) desc,s.submitted_at limit 1;
 if m is null and i.parent_instance_id is not null then
  select pin.mapping_id into m from crm_sync.submission_mappings pin join fms_instance_stages parent_work on parent_work.form_submission_id=pin.submission_id
   where parent_work.fms_instance_id=i.parent_instance_id order by parent_work.created_at limit 1;
 end if;
 if m is null then return null;end if;
 kind:=case when new.action='actor_completed' and w.status='completed' then 'stage.completed' else 'workflow.changed' end;
 p:=jsonb_build_object('schemaVersion',1,'sourceProject','jewelos','eventId','jewelos.stage.'||new.id,'eventType',kind,
  'tenantId',i.tenant_id,'branchId',i.branch_id,'departmentId',i.department_id,'actorId',new.actor_id,'actorName',(select employee_name from user_profiles where id=new.actor_id and tenant_id=i.tenant_id),'occurredAt',new.created_at,
  'journeyKey',i.id,'mappingId',m,'mappingVersion',(select version from form_customer_mapping_versions where id=m),'mappingDigest',(select digest from form_customer_mapping_versions where id=m),
  'workflow',jsonb_build_object('instanceId',i.id,'parentInstanceId',i.parent_instance_id,'flowId',i.fms_flow_id,'referenceNumber',i.reference_number,'instanceStageId',w.id,
   'stageId',d.id,'stageKey',d.stage_key,'stageName',d.name,'visitNumber',w.visit_number,'completedAt',w.actual_datetime,'instanceStatus',i.status,
   'flowVersion',(select version from fms_flows where id=i.fms_flow_id),'flowFamilyId',(select family_id from fms_flows where id=i.fms_flow_id),'executionVersion',to_jsonb(i)->'execution_version',
   'assignedUserIds',w.assigned_to,'assignedEmployees',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',employee_name)),'[]') from user_profiles where tenant_id=i.tenant_id and id=any(w.assigned_to)),'status',w.status,'action',new.action,
   'nextAssignees',(select coalesce(jsonb_agg(jsonb_build_object('visitId',next.id,'assignedUserIds',next.assigned_to)),'[]') from fms_instance_stages next where next.fms_instance_id=i.id and w.id=any(next.execution_path) and next.id<>w.id)),
  'answers','[]'::jsonb);
 insert into crm_sync.customer_events(tenant_id,source_type,source_id,mapping_id,payload,payload_digest)
 values(i.tenant_id,kind,new.id,m,p,encode(digest(p::text,'sha256'),'hex')) on conflict(source_type,source_id) do nothing;
 return null;
end $$;
create constraint trigger customer_stage_capture after insert on fms_stage_logs deferrable initially deferred for each row execute function crm_sync.capture_customer_stage();

create function crm_sync_claim_customer_events(p_limit integer default 50)
returns table(id uuid,lease_token uuid,payload jsonb,descriptor jsonb,mapping_id uuid,mapping_digest text)
language plpgsql security definer set search_path=public as $$
begin
 return query with due as (select e.id from crm_sync.customer_events e where e.delivered_at is null and e.dead_at is null and e.review_at is null and e.rejected_at is null
  and e.next_attempt_at<=now() and (e.lease_until is null or e.lease_until<now()) order by e.next_attempt_at,e.created_at,e.id for update skip locked limit greatest(1,least(coalesce(p_limit,50),50))),
 claimed as (update crm_sync.customer_events e set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',attempts=e.attempts+1 from due where e.id=due.id returning e.*)
 select e.id,e.lease_token,e.payload,m.descriptor,e.mapping_id,m.digest from claimed e join form_customer_mapping_versions m on m.id=e.mapping_id;
end $$;

create function crm_sync_finish_customer_event(p_id uuid,p_lease uuid,p_result jsonb,p_error text default null) returns text
language plpgsql security definer set search_path=public as $$
declare e crm_sync.customer_events;outcome text;v_instance_id uuid;v_client_id uuid;
begin
 select * into e from crm_sync.customer_events where id=p_id for update;
 if e.id is null or e.lease_token is distinct from p_lease or e.lease_until<now() then raise exception 'Delivery lease changed' using errcode='40001';end if;
 outcome:=p_result->>'outcome';
 if p_error is null and outcome in ('accepted','duplicate') then
  v_client_id:=nullif(p_result->>'client_id','')::uuid;v_instance_id:=nullif(e.payload#>>'{workflow,instanceId}','')::uuid;
  if v_client_id is null then raise exception 'Customer acknowledgement required' using errcode='22023';end if;
  if v_instance_id is not null and v_client_id is not null then
   insert into crm_sync.customer_workflow_links(tenant_id,instance_id,client_id) values(e.tenant_id,v_instance_id,v_client_id)
   on conflict(instance_id) do update set acknowledged_at=clock_timestamp() where crm_sync.customer_workflow_links.client_id=excluded.client_id;
   if not found then raise exception 'Conflicting customer acknowledgement' using errcode='23514';end if;
  end if;
  update crm_sync.customer_events set delivered_at=clock_timestamp(),result=p_result,lease_until=null,lease_token=null,last_error=null where id=p_id;return 'delivered';
 elsif p_error is null and outcome='rejected' then
  update crm_sync.customer_events set rejected_at=clock_timestamp(),result=p_result,lease_until=null,lease_token=null,last_error='reviewer_rejected' where id=p_id;return 'rejected';
 elsif p_error is null and outcome in ('review','mapping_unapproved','source_unapproved') then
  update crm_sync.customer_events set review_at=clock_timestamp(),result=p_result,lease_until=null,lease_token=null,last_error=outcome where id=p_id;return 'review';
 end if;
 update crm_sync.customer_events set lease_until=null,lease_token=null,last_error=left(coalesce(p_error,'invalid_result'),80),
  next_attempt_at=now()+make_interval(secs=>least(3600,15*power(2,least(attempts,8)))::integer),dead_at=case when attempts>=10 then clock_timestamp() else null end where id=p_id;
 return case when e.attempts>=10 then 'dead' else 'retry' end;
end $$;

create function customer_integration_health() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();r jsonb;begin
 perform assert_module_access('settings');if a.id is null or not current_profile_is_active() or not has_permission('settings.manage_organization') then raise exception 'Integration administration required' using errcode='42501';end if;
 select jsonb_build_object('pending',count(*) filter(where delivered_at is null and dead_at is null and review_at is null and rejected_at is null),'delivered',count(*) filter(where delivered_at is not null),'rejected',count(*) filter(where rejected_at is not null),
 'review',count(*) filter(where review_at is not null),'failed',count(*) filter(where dead_at is not null),'lastSuccess',max(delivered_at),'oldestPending',min(created_at) filter(where delivered_at is null)) into r from crm_sync.customer_events where tenant_id=a.tenant_id;
 return r||jsonb_build_object('mappingStatus',(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from(
 select t.id,t.name,m.version,coalesce(m.enabled,false) as enabled,
 (select count(*) from form_fields f where f.form_template_id=t.id and f.field_type not in ('section_header','divider','user_dropdown','branch_dropdown','department_dropdown','file_upload') and not exists(select 1 from jsonb_array_elements(coalesce(m.descriptor->'fields','[]')) v where v->>'fieldKey'=f.field_key)) as unreviewed_questions
 from form_templates t join lateral(select * from form_customer_mapping_versions v where v.template_id=t.id and not(v.descriptor ? 'historicalSnapshotDigest') order by v.version desc limit 1)m on true where t.tenant_id=a.tenant_id order by t.name limit 100)q),
 'eventTableBytes',pg_total_relation_size('crm_sync.customer_events'::regclass),'mappingTableBytes',pg_total_relation_size('form_customer_mapping_versions'::regclass),'events',(select coalesce(jsonb_agg(to_jsonb(row)),'[]') from(select id,created_at,last_error,case when dead_at is not null then 'failed' when review_at is not null then 'review' else 'pending' end as status from crm_sync.customer_events where tenant_id=a.tenant_id and delivered_at is null and rejected_at is null order by created_at,id limit 100)row));end $$;
create function retry_customer_events(p_ids uuid[]) returns integer language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile();n integer;begin
 perform customer_integration_health();if cardinality(p_ids)>200 then raise exception 'Select at most 200 events' using errcode='22023';end if;
 update crm_sync.customer_events set dead_at=null,review_at=null,attempts=0,next_attempt_at=now(),last_error=null where id=any(p_ids) and tenant_id=a.tenant_id and delivered_at is null and rejected_at is null and (lease_until is null or lease_until<now());get diagnostics n=row_count;
 insert into audit_logs(tenant_id,actor_user_id,action,module,new_value) values(a.tenant_id,a.id,'customer_events_retried','forms',jsonb_build_object('count',n));return n;end $$;

create function get_fms_customer_link(p_instance_id uuid) returns uuid language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();begin
 perform assert_module_enabled('fms_builder');perform assert_module_access('crm');
 if a.id is null or not current_profile_is_active() or not exists(select 1 from fms_instances i where i.id=p_instance_id and i.tenant_id=a.tenant_id and
  (i.started_by=a.id or exists(select 1 from fms_instance_stages w where w.fms_instance_id=i.id and can_read_fms_work_context(w.id)))) then raise exception 'Workflow access required' using errcode='42501';end if;
 return(select client_id from crm_sync.customer_workflow_links where instance_id=p_instance_id and tenant_id=a.tenant_id);
end $$;

create function reconcile_customer_submissions(p_mapping_id uuid,p_ids uuid[],p_apply boolean default false,p_expected_digest text default null) returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile();m form_customer_mapping_versions;s form_submissions;selected integer:=0;eligible integer:=0;existing integer:=0;invalid integer:=0;emitted integer:=0;source_digest text;
begin
 perform customer_integration_health();
 if p_ids is null or cardinality(p_ids)>200 or cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids) id) then raise exception 'Select at most 200 distinct source submissions' using errcode='22023';end if;
 select * into m from form_customer_mapping_versions where id=p_mapping_id and tenant_id=a.tenant_id;
 if m.id is null or not m.enabled then raise exception 'Reviewed historical mapping required' using errcode='42501';end if;
 perform 1 from form_submissions where id=any(p_ids) and tenant_id=a.tenant_id order by id for share;
 select encode(extensions.digest(jsonb_build_object('mapping',m.digest,'ids',to_jsonb(p_ids),'sources',coalesce(jsonb_agg(jsonb_build_object('id',id,'data',data,'snapshot',template_snapshot,'time',submitted_at) order by id),'[]'))::text,'sha256'),'hex') into source_digest from form_submissions where id=any(p_ids) and tenant_id=a.tenant_id;
 if p_apply and p_expected_digest is distinct from source_digest then raise exception 'Review the current source preview before applying' using errcode='40001';end if;
 foreach s.id in array p_ids loop
  selected:=selected+1;select * into s from form_submissions where id=s.id and tenant_id=a.tenant_id for share;
  if s.id is null or s.status<>'submitted' or s.template_snapshot#>>'{template,id}' is distinct from m.template_id::text
    or s.template_snapshot#>>'{template,version}' is distinct from m.descriptor->>'templateVersion'
    or crm_sync.customer_definition_digest(s.template_snapshot) is distinct from m.descriptor->>'definitionDigest'
    or (m.descriptor ? 'historicalSnapshotDigest' and encode(extensions.digest(s.template_snapshot::text,'sha256'),'hex') is distinct from m.descriptor->>'historicalSnapshotDigest') then invalid:=invalid+1;continue;end if;
  if exists(select 1 from crm_sync.customer_events where source_type='form.submitted' and source_id=s.id) then existing:=existing+1;continue;end if;
  eligible:=eligible+1;
  if p_apply then
   insert into crm_sync.submission_mappings(submission_id,mapping_id) values(s.id,m.id) on conflict(submission_id) do nothing;
   if not exists(select 1 from crm_sync.submission_mappings where submission_id=s.id and mapping_id=m.id) then raise exception 'Source mapping changed' using errcode='40001';end if;
   perform crm_sync.capture_customer_submission(s.id);
   if exists(select 1 from crm_sync.customer_events where source_type='form.submitted' and source_id=s.id) then emitted:=emitted+1;end if;
  end if;
 end loop;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,case when p_apply then 'customer_backfill_applied' else 'customer_backfill_previewed' end,'forms',m.template_id,jsonb_build_object('mapping_id',m.id,'selected',selected,'eligible',eligible,'existing',existing,'invalid',invalid,'emitted',emitted));
 return jsonb_build_object('selected',selected,'eligible',eligible,'existing',existing,'invalid',invalid,'emitted',emitted,'unmapped',case when p_apply then eligible-emitted else null end,'dryRun',not p_apply,'sourceDigest',source_digest);
end $$;

create function export_customer_stage_answers(p_filters jsonb default '{}',p_before timestamptz default null,p_before_id uuid default null,p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile();rows jsonb;begin
 perform assert_module_access('reports');perform assert_module_enabled('fms_builder');
 if a.id is null or not current_profile_is_active() or not has_permission('reports.export') then raise exception 'Report export access required' using errcode='42501';end if;
 if jsonb_typeof(p_filters) is distinct from 'object' or pg_column_size(p_filters)>4096 then raise exception 'Invalid export filters' using errcode='22023';end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.submitted_at desc,r.submission_id desc),'[]') into rows from(
  select s.id as submission_id,s.submitted_at,s.submitted_by as actor_id,w.assigned_to as assigned_user_ids,
   i.id as instance_id,i.reference_number,d.stage_key,d.name as stage_name,w.id as instance_stage_id,s.template_snapshot as form_snapshot,s.data as original_answers
  from form_submissions s join fms_instance_stages w on w.form_submission_id=s.id join fms_instances i on i.id=w.fms_instance_id join fms_stages d on d.id=w.fms_stage_id
  where s.tenant_id=a.tenant_id and s.status='submitted' and can_read_fms_work_context(w.id)
   and (nullif(p_filters->>'instanceId','') is null or i.id=(p_filters->>'instanceId')::uuid)
   and (nullif(p_filters->>'flowId','') is null or i.fms_flow_id=(p_filters->>'flowId')::uuid)
   and (nullif(p_filters->>'branchId','') is null or i.branch_id=(p_filters->>'branchId')::uuid)
   and (nullif(p_filters->>'actorId','') is null or s.submitted_by=(p_filters->>'actorId')::uuid)
   and (nullif(p_filters->>'from','') is null or s.submitted_at>=(p_filters->>'from')::timestamptz)
   and (nullif(p_filters->>'until','') is null or s.submitted_at<(p_filters->>'until')::timestamptz)
   and (p_before is null or (s.submitted_at,s.id)<(p_before,coalesce(p_before_id,'00000000-0000-0000-0000-000000000000'::uuid)))
  order by s.submitted_at desc,s.id desc limit greatest(1,least(coalesce(p_limit,50),100))
 )r;
 insert into audit_logs(tenant_id,actor_user_id,action,module,new_value) values(a.tenant_id,a.id,'customer_stage_answers_exported','reports',jsonb_build_object('row_count',jsonb_array_length(rows),'scope','authorized_fms_work'));
 return rows;
end $$;

revoke all on function save_form_customer_mapping(uuid,jsonb),get_form_customer_mapping(uuid),customer_integration_health(),retry_customer_events(uuid[]) from public,anon,authenticated,service_role;
grant execute on function save_form_customer_mapping(uuid,jsonb),get_form_customer_mapping(uuid),customer_integration_health(),retry_customer_events(uuid[]) to authenticated;
revoke all on function get_fms_customer_link(uuid),reconcile_customer_submissions(uuid,uuid[],boolean,text),export_customer_stage_answers(jsonb,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function get_fms_customer_link(uuid),reconcile_customer_submissions(uuid,uuid[],boolean,text),export_customer_stage_answers(jsonb,timestamptz,uuid,integer) to authenticated;
revoke all on function crm_sync_claim_customer_events(integer),crm_sync_finish_customer_event(uuid,uuid,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function crm_sync_claim_customer_events(integer),crm_sync_finish_customer_event(uuid,uuid,jsonb,text) to service_role;
revoke all on function crm_sync.customer_immutable(),crm_sync.mapping_immutable(),crm_sync.pin_customer_mapping(),crm_sync.capture_customer_submission(uuid),crm_sync.capture_customer_submission_trigger(),crm_sync.capture_customer_stage() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
-- Instance lifecycle evidence uses the existing audited transition, including cancellation.
create function crm_sync.capture_customer_lifecycle() returns trigger language plpgsql security definer set search_path=public,extensions as $$
declare i fms_instances;m uuid;p jsonb;begin
 if new.module<>'fms_instances' or new.action not in ('fms_instance_cancel','fms_instance_hold','fms_instance_resume') then return null;end if;
 select * into i from fms_instances where id=new.record_id and tenant_id=new.tenant_id;
 if i.id is null then return null;end if;
 select pin.mapping_id into m from crm_sync.submission_mappings pin join fms_instance_stages w on w.form_submission_id=pin.submission_id
 where w.fms_instance_id in(i.id,i.parent_instance_id) order by (w.fms_instance_id=i.id) desc,w.created_at,w.id limit 1;
 if m is null then return null;end if;
 p:=jsonb_build_object('schemaVersion',1,'sourceProject','jewelos','eventId','jewelos.lifecycle.'||new.id,'eventType','workflow.changed','tenantId',i.tenant_id,'branchId',i.branch_id,'departmentId',i.department_id,
 'actorId',new.actor_user_id,'actorName',(select employee_name from user_profiles where id=new.actor_user_id and tenant_id=i.tenant_id),'occurredAt',new.created_at,'journeyKey',i.id,'mappingId',m,'mappingDigest',(select digest from form_customer_mapping_versions where id=m),
 'workflow',jsonb_build_object('instanceId',i.id,'parentInstanceId',i.parent_instance_id,'flowId',i.fms_flow_id,'referenceNumber',i.reference_number,'instanceStatus',new.new_value->>'status','action',new.action),'answers','[]'::jsonb);
 insert into crm_sync.customer_events(tenant_id,source_type,source_id,mapping_id,payload,payload_digest) values(i.tenant_id,'workflow.changed',new.id,m,p,encode(digest(p::text,'sha256'),'hex')) on conflict(source_type,source_id) do nothing;
 return null;
end $$;
create constraint trigger customer_lifecycle_capture after insert on audit_logs deferrable initially deferred for each row execute function crm_sync.capture_customer_lifecycle();
revoke all on function crm_sync.capture_customer_lifecycle() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';

create index customer_capture_submission_visit on public.fms_instance_stages(form_submission_id) where form_submission_id is not null;

create index customer_events_tenant_pending_metadata on crm_sync.customer_events(tenant_id,created_at,id) where delivered_at is null;
