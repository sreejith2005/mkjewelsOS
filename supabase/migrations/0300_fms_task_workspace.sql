-- Read-time employee hierarchy over existing durable assignments. No runtime writes.
set search_path=public,extensions;
alter table form_templates add column record_name_field_key text;

create function fms_normalize_record_name(p_value text) returns text
language sql immutable set search_path=public as $$
 select case when btrim(coalesce(p_value,''))='' or btrim(p_value) ~* '^(null|undefined|not provided)$'
  or p_value ~ '[{}]' or p_value ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then null
  else left(btrim(regexp_replace(p_value,'\s+',' ','g')),120) end
$$;
create function fms_record_field_eligible(p_field jsonb) returns boolean
language sql immutable set search_path=public as $$
 select coalesce((p_field->>'is_shown')::boolean,true)
  and p_field->>'field_type' in ('text','number','select','radio','date','datetime','user_dropdown')
  and concat_ws(' ',p_field->>'field_key',p_field->>'field_name') !~* '(password|secret|token|credential|private|remarks?|notes?|email|phone|mobile)'
$$;
create function fms_record_field_value(p_field jsonb) returns text
language sql immutable set search_path=public as $$
 select fms_normalize_record_name(coalesce(nullif(p_field->>'valueLabel',''),
  case when p_field#>>'{field,type}' in ('select','radio') then
   (select coalesce(option->>'label',option#>>'{}') from jsonb_array_elements(coalesce(p_field#>'{field,options}','[]')) option
    where coalesce(option->>'value',option#>>'{}')=p_field->>'value' limit 1)
  when jsonb_typeof(p_field->'value') in ('number','string') then p_field->>'value' end))
$$;

-- Keep the existing projection available privately so advanced templates can be
-- rendered without recursion after the public context gains its record name.
alter function get_fms_assigned_work_context(uuid,uuid,text,integer) rename to fms_work_context_before_record_name;
revoke all on function fms_work_context_before_record_name(uuid,uuid,text,integer) from public,anon,authenticated,service_role;
create function fms_work_record_name(p_work_id uuid) returns text
language plpgsql stable security definer set search_path=public as $$
declare w fms_instance_stages; i fms_instances; d fms_stages; initial fms_stages; naming jsonb;
 source record; fields jsonb; field jsonb; selected text; value text; fallback text; snapshot jsonb; template text; context jsonb; item jsonb;
begin
 if not can_read_fms_work_context(p_work_id) then return null; end if;
 select * into w from fms_instance_stages where id=p_work_id;
 select * into i from fms_instances where id=w.fms_instance_id;
 select * into d from fms_stages where id=w.fms_stage_id;
 select * into initial from fms_stages where fms_flow_id=i.fms_flow_id order by sort_order,id limit 1;
 naming:=coalesce(d.planned_time_rule#>'{taskDisplay,recordNaming}',initial.planned_time_rule#>'{taskDisplay,recordNaming}','{}');
 -- Only the causal source visits of this exact assignment can supply names.
 for source in select causal.*,stage.stage_key from fms_context_form_visits(w.id) causal
  join fms_instance_stages visit on visit.id=causal.visit_id join fms_stages stage on stage.id=visit.fms_stage_id
  where case when naming->>'mode'='field' then stage.stage_key=naming#>>'{source,sourceStageKey}'
    and stage.form_template_id::text=naming#>>'{source,formTemplateId}' else causal.is_initial end
  order by causal.is_initial desc,visit.visit_number,visit.id loop
   select template_snapshot into snapshot from form_submissions where id=source.submission_id;
   fields:=fms_context_form_fields(source.visit_id);
   selected:=case when naming->>'mode'='field' then naming#>>'{source,fieldKey}' else snapshot#>>'{template,record_name_field_key}' end;
   if nullif(selected,'') is not null then
    select fms_record_field_value(item) into value from jsonb_array_elements(fields) item
     where item#>>'{field,key}'=selected limit 1;
    if value is not null then return value; end if;
   end if;
   -- Automatic selection never falls through to arbitrary free text.
   select fms_record_field_value(item) into fallback from jsonb_array_elements(fields) item
    where item#>>'{field,type}' in ('text','number') and fms_record_field_value(item) is not null
      and concat_ws(' ',item#>>'{field,key}',item#>>'{field,label}') !~* '(password|secret|token|credential|private|remarks?|notes?|email|phone|mobile)'
      and replace(lower(concat_ws(' ',item#>>'{field,key}',item#>>'{field,label}')),'_',' ') ~ '\m(customer|client|lead|enquiry|inquiry|record|order) (name|number|no|reference|ref|id)\M'
    order by case when replace(lower(concat_ws(' ',item#>>'{field,key}',item#>>'{field,label}')),'_',' ') ~ '\m(customer|client) name\M' then 0
     when replace(lower(concat_ws(' ',item#>>'{field,key}',item#>>'{field,label}')),'_',' ') ~ '\m(lead|enquiry|inquiry|record) name\M' then 1 else 2 end,
     (item#>>'{field,sortOrder}')::integer,item#>>'{field,key}' limit 1;
   exit when fallback is not null;
 end loop;
 template:=nullif(d.planned_time_rule#>>'{taskDisplay,titleTemplate}','');
 if template is not null then
  context:=fms_work_context_before_record_name(i.id,w.id,null,1);
  template:=replace(replace(replace(left(template,500),'{workflow}',context->>'workflowName'),'{stage}',d.name),'{reference}',i.reference_number);
  for item in select * from jsonb_array_elements(context->'receivedFields') loop
   value:=fms_record_field_value(item);
   if value is not null then template:=replace(template,'{'||(item->>'sourceStageKey')||'.'||(item#>>'{field,key}')||'}',value); end if;
  end loop;
  value:=fms_normalize_record_name(template); if value is not null then return value; end if;
 end if;
 return coalesce(fallback,i.reference_number,'Assigned work');
end $$;
create function get_fms_assigned_work_context(p_instance_id uuid,p_instance_stage_id uuid,p_cursor text default null,p_limit integer default 20)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 result:=fms_work_context_before_record_name(p_instance_id,p_instance_stage_id,p_cursor,p_limit);
 return result||jsonb_build_object('recordName',fms_work_record_name(p_instance_stage_id));
end $$;

-- Reuse audited form writers and their original access checks, preserving keys
-- omitted by old clients. Naming metadata is written/audited in that transaction.
create function set_form_record_name_internal(p_id uuid,p_payload jsonb) returns void
language plpgsql security definer set search_path=public as $$
declare previous text; chosen text; t form_templates;
begin
 if not (p_payload ? 'record_name_field_key') then return; end if;
 select * into t from form_templates where id=p_id for update; previous:=t.record_name_field_key;
 if jsonb_typeof(p_payload->'record_name_field_key') not in ('string','null') then raise exception 'Invalid record name question' using errcode='22023'; end if;
 chosen:=nullif(btrim(p_payload->>'record_name_field_key'),'');
 if chosen is not null and not exists(select 1 from form_fields field where form_template_id=p_id and field_key=chosen and fms_record_field_eligible(to_jsonb(field))) then
  raise exception 'Choose a visible identifying question as the record name' using errcode='23514'; end if;
 if chosen is distinct from previous and t.lifecycle<>'draft' and
  (exists(select 1 from form_submissions where form_template_id=p_id) or exists(select 1 from fms_stages stage join fms_flows flow on flow.id=stage.fms_flow_id where stage.form_template_id=p_id and flow.status<>'draft')) then
  raise exception 'Create a form revision to change its record name question' using errcode='23514'; end if;
 if chosen is distinct from previous then
  perform set_config('jewelos.allow_record_name_write','on',true);
  perform set_config('jewelos.allow_published_form_edit','on',true);
  update form_templates set record_name_field_key=chosen where id=p_id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
   values(t.tenant_id,(current_profile()).id,'form_record_name_updated','forms',p_id,jsonb_build_object('fieldKey',previous),jsonb_build_object('fieldKey',chosen));
 end if;
end $$;
alter function save_form_draft_with_audit(uuid,jsonb,jsonb) rename to save_form_draft_before_record_name;
alter function save_published_form_with_audit(uuid,jsonb,jsonb) rename to save_published_form_before_record_name;
create function save_form_draft_with_audit(p_template_id uuid,p_payload jsonb,p_fields jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare id uuid;
begin
 id:=save_form_draft_before_record_name(p_template_id,p_payload-'record_name_field_key',p_fields);
 perform set_form_record_name_internal(id,p_payload); return id;
end $$;
create function save_published_form_with_audit(p_template_id uuid,p_payload jsonb,p_fields jsonb) returns uuid
language plpgsql security definer set search_path=public as $$
declare id uuid;
begin
 id:=save_published_form_before_record_name(p_template_id,p_payload-'record_name_field_key',p_fields);
 perform set_form_record_name_internal(id,p_payload); return id;
end $$;
-- Copy metadata inside the original revision/duplicate transaction and audit snapshot.
do $$
declare signature text; definition text; amended text;
begin
 foreach signature in array array['create_form_revision_with_audit(uuid,jsonb)','duplicate_form_with_audit(uuid,text)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  amended:=replace(definition,'returning * into v_new;', 'returning * into v_new; perform set_config(''jewelos.allow_record_name_write'',''on'',true); update form_templates set record_name_field_key=v_source.record_name_field_key where id=v_new.id returning * into v_new;');
  if amended=definition then raise exception 'Review form naming copy against current writer: %',signature; end if;
  execute amended;
 end loop;
end $$;

create function guard_form_record_name_write() returns trigger
language plpgsql security definer set search_path=public as $$
begin
 if new.record_name_field_key is distinct from old.record_name_field_key and coalesce(current_setting('jewelos.allow_record_name_write',true),'')<>'on' then
  raise exception 'Use the audited form writer to configure record naming' using errcode='42501'; end if;
 return new;
end $$;
create trigger form_record_name_write before update of record_name_field_key on form_templates for each row execute function guard_form_record_name_write();

create function guard_fms_record_naming_publish() returns trigger
language plpgsql security definer set search_path=public as $$
declare stage fms_stages; source fms_stages; naming jsonb;
begin
 if new.status<>'published' or old.status='published' then return new; end if;
 for stage in select * from fms_stages where fms_flow_id=new.id loop
  naming:=stage.planned_time_rule#>'{taskDisplay,recordNaming}'; if naming is null then continue; end if;
  if jsonb_typeof(naming)<>'object' or coalesce(naming->>'mode','') not in ('automatic','form_default','field') then raise exception 'Invalid FMS task naming configuration' using errcode='23514'; end if;
  if naming->>'mode'='field' then
   select * into source from fms_stages where fms_flow_id=new.id and stage_key=naming#>>'{source,sourceStageKey}' and form_template_id::text=naming#>>'{source,formTemplateId}';
   if source.id is null or not exists(select 1 from form_fields field where form_template_id=source.form_template_id and field_key=naming#>>'{source,fieldKey}' and fms_record_field_eligible(to_jsonb(field))) then
    raise exception 'Task naming must use an eligible question from the exact linked form' using errcode='23514'; end if;
  end if;
 end loop;
 return new;
end $$;
create trigger fms_record_naming_publish before update of status on fms_flows for each row execute function guard_fms_record_naming_publish();

create function fms_workspace_validate(p_filter jsonb,p_offset integer,p_limit integer) returns void
language plpgsql stable security definer set search_path=public as $$
declare date_from date; date_to date; selector text;
begin
 perform assert_module_access('tasks');
 if not current_profile_is_active() or (current_profile()).id is null then raise exception 'Task page access denied' using errcode='42501'; end if;
 if p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 50 or p_filter is null or jsonb_typeof(p_filter)<>'object'
  or exists(select 1 from jsonb_each(p_filter) e where e.key not in ('query','status','from','to','familyId','stageId') or jsonb_typeof(e.value)<>'string')
  or length(coalesce(p_filter->>'query',''))>200 or coalesce(p_filter->>'status','active') not in ('active','pending','overdue','waiting','completed') then
  raise exception 'Invalid FMS filters' using errcode='22023'; end if;
 foreach selector in array array[nullif(p_filter->>'familyId',''),nullif(p_filter->>'stageId','')] loop
  if selector is not null and selector !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'Invalid FMS selector' using errcode='22023'; end if;
 end loop;
 begin
  date_from:=nullif(p_filter->>'from','')::date; date_to:=nullif(p_filter->>'to','')::date;
  if date_from>date_to then raise exception 'Invalid range'; end if;
 exception when others then raise exception 'Invalid FMS date range' using errcode='22023'; end;
end $$;

-- Private narrow relation: no form histories are loaded for unsearched summaries.
create function fms_workspace_rows(p_filter jsonb default '{}')
returns table(id uuid,family_id uuid,flow_id uuid,stage_id uuid,instance_id uuid,form_id uuid,starting boolean,workflow_name text,stage_name text,
 version integer,pipeline text,sort_order integer,visit_number integer,due_at timestamptz,status text,bucket text,reference text,description text)
language sql stable security definer set search_path=public as $$
 with actor as (select (current_profile()).*), work as (
  select w.id,coalesce(f.family_id,f.id) family_id,f.id flow_id,d.id stage_id,i.id instance_id,d.form_template_id form_id,false starting,
   f.name workflow_name,d.name stage_name,f.version,coalesce(d.planned_time_rule->>'pipelineName','') pipeline,d.sort_order,w.visit_number,w.planned_datetime due_at,w.status::text,
   case when w.status='completed' then 'completed'
    when exists(select 1 from fms_instance_stage_assignees contributor where contributor.fms_instance_stage_id=w.id and contributor.user_profile_id=a.id and contributor.is_active and contributor.status='completed')
      or i.status='on_hold' or w.status in ('blocked','rejected')
      or w.status='in_review' and d.step_type<>'approval' then 'waiting'
    when w.status='overdue' or w.planned_datetime<now() then 'overdue' else 'pending' end bucket,
   i.reference_number reference,coalesce(d.planned_time_rule#>>'{taskDisplay,shortDescription}',d.method,'') description
  from actor a join fms_instances i on i.tenant_id=a.tenant_id join fms_instance_stages w on w.fms_instance_id=i.id
   join fms_stages d on d.id=w.fms_stage_id join fms_flows f on f.id=i.fms_flow_id
  where current_profile_is_active() and module_accessible('fms',false) and a.id=any(w.assigned_to)
   and can_read_fms_work_context(w.id) and i.status<>'cancelled' and w.outcome is distinct from 'condition_skipped'
  union all
  select s.id,coalesce(f.family_id,f.id),f.id,d.id,null,s.form_template_id,true,f.name,'Starting Form',f.version,'',-1,0,s.created_at,s.status,
   case when s.status='completed' then 'completed' else 'pending' end,'',coalesce(d.method,'')
  from actor a join fms_starter_assignments s on s.tenant_id=a.tenant_id and s.user_profile_id=a.id
   join fms_flows f on f.id=s.fms_flow_id join fms_stages d on d.id=s.fms_stage_id
  where current_profile_is_active() and module_accessible('fms',false) and s.status in ('pending','completed')
 )
 select * from work where (nullif(p_filter->>'familyId','') is null or family_id=nullif(p_filter->>'familyId','')::uuid)
  and (nullif(p_filter->>'stageId','') is null or stage_id=nullif(p_filter->>'stageId','')::uuid)
  and (nullif(p_filter->>'from','') is null or due_at>=nullif(p_filter->>'from','')::date::timestamp at time zone 'Asia/Kolkata')
  and (nullif(p_filter->>'to','') is null or due_at<(nullif(p_filter->>'to','')::date+1)::timestamp at time zone 'Asia/Kolkata')
  and case when btrim(coalesce(p_filter->>'query',''))='' then true else
   strpos(lower(concat_ws(' ',workflow_name,stage_name,reference,case when not starting then fms_work_record_name(id) end)),lower(btrim(p_filter->>'query')))>0 end
$$;
create function fms_workspace_status_matches(p_bucket text,p_status text) returns boolean
language sql immutable set search_path=public as $$ select case when coalesce(p_status,'active')='active' then p_bucket in ('pending','overdue') else p_bucket=p_status end $$;

create function get_fms_task_workspace(p_filter jsonb default '{}',p_offset integer default 0,p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform fms_workspace_validate(p_filter,p_offset,p_limit);
 with rows as materialized (select * from fms_workspace_rows(p_filter)), families as (
  select family_id id,(array_agg(workflow_name order by version desc,flow_id))[1] name,count(*) count
  from rows where fms_workspace_status_matches(bucket,p_filter->>'status') group by family_id
 ), page as(select * from families order by name,id limit p_limit offset p_offset)
 select jsonb_build_object('families',coalesce((select jsonb_agg(to_jsonb(page) order by name,id) from page),'[]'),
  'familyTotal',(select count(*) from families),'total',count(*) filter(where fms_workspace_status_matches(bucket,p_filter->>'status')),
  'activeTotal',(select count(*) from fms_workspace_rows('{}') where bucket in ('pending','overdue')),
  'counts',jsonb_build_object('active',count(*) filter(where bucket in ('pending','overdue')),'pending',count(*) filter(where bucket='pending'),
   'overdue',count(*) filter(where bucket='overdue'),'waiting',count(*) filter(where bucket='waiting'),'completed',count(*) filter(where bucket='completed'))) into result from rows;
 return result;
end $$;
create function get_fms_task_stages(p_family_id uuid,p_filter jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform fms_workspace_validate(p_filter,0,50);
 with work as materialized (select * from fms_workspace_rows(p_filter||jsonb_build_object('familyId',p_family_id)) where fms_workspace_status_matches(bucket,p_filter->>'status')),
 eligible_versions as (select distinct flow_id from work), definitions as (
  select d.id,d.fms_flow_id flow_id,d.name,d.sort_order,d.default_next_stage_id,d.parallel_target_stage_ids,
    coalesce(d.planned_time_rule->>'pipelineName','') pipeline,f.version
  from eligible_versions v join fms_stages d on d.fms_flow_id=v.flow_id join fms_flows f on f.id=v.flow_id
 ), groups as (
  select d.id::text||':stage' id,d.flow_id as "flowId",d.id as "stageId",d.name,d.version,
   (select count(*) from work where stage_id=d.id and not starting) count,d.pipeline,greatest(d.sort_order,0) as "order",false starting,
   coalesce((select jsonb_agg(distinct target) from unnest(array_remove(array[d.default_next_stage_id]||d.parallel_target_stage_ids,null)
      ||coalesce((select array_agg(next_stage_id order by sort_order) from fms_branch_rules where fms_stage_id=d.id and next_stage_id is not null),'{}')) target),'[]') as "nextStageIds"
  from definitions d
  union all
  select stage_id::text||':starter',flow_id,stage_id,'Starting Form',max(version),count(*),'',0,true,'[]'::jsonb from work where starting group by flow_id,stage_id
 ) select coalesce(jsonb_agg(to_jsonb(groups) order by version desc,"flowId",starting desc,"order",id),'[]') into result from groups;
 return result;
end $$;
create function get_fms_task_stage_page(p_family_id uuid,p_flow_id uuid,p_stage_id uuid,p_starting boolean default false,p_filter jsonb default '{}',p_offset integer default 0,p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
 perform fms_workspace_validate(p_filter,p_offset,p_limit);
 if p_starting is null then raise exception 'Invalid stage group' using errcode='22023'; end if;
 with eligible as materialized(select * from fms_workspace_rows(p_filter||jsonb_build_object('familyId',p_family_id,'stageId',p_stage_id))
  where flow_id=p_flow_id and starting=p_starting and fms_workspace_status_matches(bucket,p_filter->>'status')),
 page as(select * from eligible order by due_at asc nulls last,id limit p_limit offset p_offset)
 select jsonb_build_object('total',(select count(*) from eligible),'records',coalesce(jsonb_agg(jsonb_build_object('id',id,
  'name',case when starting then workflow_name||' — Starting Form' else fms_work_record_name(id) end,'reference',reference,'description',description,
  'dueAt',due_at,'status',bucket,'visitNumber',visit_number,'target',case when starting then jsonb_build_object('kind','starter_form','starterAssignmentId',id,'formTemplateId',form_id)
   when form_id is not null then jsonb_build_object('kind','stage_form','instanceId',instance_id,'instanceStageId',id,'formTemplateId',form_id)
   else jsonb_build_object('kind','stage','instanceId',instance_id,'instanceStageId',id) end) order by due_at asc nulls last,id),'[]')) into result from page;
 return result;
end $$;

-- Extend the single effective task workspace implementation. Fail closed if the
-- expected baseline changed instead of silently leaving duplicate membership.
do $$
declare definition text; amended text;
begin
 definition:=replace(pg_get_functiondef('task_workspace_page(jsonb,integer,integer)'::regprocedure),E'\r','');
 amended:=replace(definition,'''any'',''mine'',''delegated'',''inLoop'',''all''','''any'',''mine'',''delegated'',''inLoop'',''fms'',''all''');
 amended:=replace(amended,'''mine'',''delegated'',''inLoop'',''all''','''mine'',''delegated'',''inLoop'',''fms'',''all''');
 amended:=replace(amended,'and (admin_view or task_template_id is not null or task_type=''fms'') mine','and task_type<>''fms'' and (admin_view or task_template_id is not null) mine');
 amended:=replace(amended,'not (watched and not assigned) and case when admin_view then created_by=a.id','task_type<>''fms'' and not (watched and not assigned) and case when admin_view then created_by=a.id');
 amended:=replace(amended,'when in_loop then ''inLoop'' when mine','when in_loop then ''inLoop'' when kind=''fms'' and assigned then ''fms'' when mine');
 amended:=replace(amended,'when ''inLoop'' then in_loop else mine or delegated or in_loop or admin_view end','when ''inLoop'' then in_loop when ''fms'' then kind=''fms'' and assigned else mine or delegated or in_loop or kind=''fms'' and assigned or admin_view end');
 amended:=replace(amended,'concat_ws('' '',f.name,d.name,d.method,i.title,i.reference_number) searchable','concat_ws('' '',f.name,d.name,d.method,i.title,i.reference_number,case when q<>'''' then fms_work_record_name(s.id) end) searchable');
 amended:=replace(amended,'from membership where (case section_filter','from membership where (section_filter<>''fms'' or id in (select id from fms_workspace_rows(''{}'') where bucket in (''pending'',''overdue''))) and (case section_filter');
 if amended=definition or position('when ''fms'' then' in amended)=0 or position('task_type<>''fms'' and (admin_view' in amended)=0 then raise exception 'Review task workspace FMS membership patch'; end if;
 execute amended;
 definition:=pg_get_functiondef('task_feed_page(text,text,integer,integer)'::regprocedure);
 amended:=replace(definition,'''mine'',''delegated'',''inLoop'',''all''','''mine'',''delegated'',''inLoop'',''fms'',''all''');
 if amended=definition then raise exception 'Review task feed FMS section patch'; end if; execute amended;
end $$;

create index fms_workspace_actor_visits on fms_instance_stage_assignees(user_profile_id,fms_instance_stage_id,status) where is_active;
create index fms_workspace_starter_actor on fms_starter_assignments(tenant_id,user_profile_id,status,fms_flow_id,fms_stage_id);

revoke all on function fms_normalize_record_name(text),fms_record_field_eligible(jsonb),fms_record_field_value(jsonb),fms_work_record_name(uuid),
 set_form_record_name_internal(uuid,jsonb),guard_form_record_name_write(),guard_fms_record_naming_publish(),save_form_draft_before_record_name(uuid,jsonb,jsonb),save_published_form_before_record_name(uuid,jsonb,jsonb),
 fms_workspace_validate(jsonb,integer,integer),fms_workspace_rows(jsonb),fms_workspace_status_matches(text,text),
 get_fms_task_workspace(jsonb,integer,integer),get_fms_task_stages(uuid,jsonb),get_fms_task_stage_page(uuid,uuid,uuid,boolean,jsonb,integer,integer),
 get_fms_assigned_work_context(uuid,uuid,text,integer),save_form_draft_with_audit(uuid,jsonb,jsonb),save_published_form_with_audit(uuid,jsonb,jsonb)
 from public,anon,authenticated,service_role;
grant execute on function get_fms_task_workspace(jsonb,integer,integer),get_fms_task_stages(uuid,jsonb),get_fms_task_stage_page(uuid,uuid,uuid,boolean,jsonb,integer,integer),
 get_fms_assigned_work_context(uuid,uuid,text,integer),save_form_draft_with_audit(uuid,jsonb,jsonb),save_published_form_with_audit(uuid,jsonb,jsonb) to authenticated;
notify pgrst,'reload schema';
