-- Customer exports extend the existing private export lifecycle; no second job/storage system.
set search_path=public,extensions;
create table customer_export_layouts(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),name text not null,
 version integer not null,configuration jsonb not null,created_by uuid not null references user_profiles(id),created_at timestamptz not null default now()
);
alter table customer_export_layouts enable row level security;
create policy layout_tenant on customer_export_layouts for select to authenticated using(tenant_id=current_tenant_id() and has_permission('settings.manage_organization'));
create policy layout_module on customer_export_layouts as restrictive for select to authenticated using(module_accessible('reports'));
revoke all on customer_export_layouts from public,anon,authenticated,service_role;
create function save_customer_export_layout(p_name text,p_configuration jsonb) returns uuid language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile();entry jsonb;v_layout_id uuid;n integer;begin
 perform customer_integration_health();perform assert_module_access('reports');
 if length(btrim(p_name)) not between 1 and 100 or jsonb_typeof(p_configuration) is distinct from 'object' or pg_column_size(p_configuration)>16384
 or jsonb_typeof(p_configuration->'questions') is distinct from 'array' or jsonb_array_length(p_configuration->'questions') not between 1 and 50 then raise exception 'Invalid export layout' using errcode='22023';end if;
 if not exists(select 1 from fms_flows where id=(p_configuration->>'flowId')::uuid and tenant_id=a.tenant_id) then raise exception 'Workflow access required' using errcode='42501';end if;
 if nullif(p_configuration->>'stageId','') is not null and not exists(select 1 from fms_stages where id=(p_configuration->>'stageId')::uuid and fms_flow_id=(p_configuration->>'flowId')::uuid) then raise exception 'Invalid layout stage' using errcode='22023';end if;
 for entry in select value from jsonb_array_elements(p_configuration->'questions') loop
  if coalesce(entry->>'fieldKey','') !~ '^[A-Za-z0-9_:-]{1,100}$' or length(btrim(coalesce(entry->>'header',''))) not between 1 and 100 then raise exception 'Each column needs a stable question key and header' using errcode='22023';end if;
 end loop;
 if (select count(distinct value->>'fieldKey') from jsonb_array_elements(p_configuration->'questions'))<>jsonb_array_length(p_configuration->'questions') then raise exception 'Duplicate export question' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(a.tenant_id||'.layout.'||btrim(p_name),0));
 select coalesce(max(version),0)+1 into n from customer_export_layouts where tenant_id=a.tenant_id and name=btrim(p_name);
 insert into customer_export_layouts(tenant_id,name,version,configuration,created_by) values(a.tenant_id,btrim(p_name),n,p_configuration,a.id) returning customer_export_layouts.id into v_layout_id;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'customer_export_layout_saved','reports',v_layout_id,jsonb_build_object('version',n));return v_layout_id;
end $$;
create function get_customer_export_layouts() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();begin perform assert_module_access('reports');if not current_profile_is_active() or not has_permission('reports.export') then raise exception 'Export access required' using errcode='42501';end if;
 return(select coalesce(jsonb_agg(to_jsonb(q)),'[]') from(select distinct on(name) id,name,version,configuration from customer_export_layouts where tenant_id=a.tenant_id order by name,version desc limit 100)q);end $$;
-- Retain all existing allowed report keys.
do $$declare old text;begin select pg_get_expr(conbin,conrelid) into old from pg_constraint where conrelid='export_logs'::regclass and conname='export_logs_report_key';
 alter table export_logs drop constraint export_logs_report_key;
 execute 'alter table export_logs add constraint export_logs_report_key check(('||old||') or report_key in (''customer_master'',''customer_enquiries'',''customer_stages'',''customer_answers'',''customer_activity'',''customer_followups'',''customer_commercial'',''customer_exceptions''))';end $$;
create function request_customer_export(p_key text,p_filters jsonb,p_request_key uuid) returns export_logs language plpgsql security definer set search_path=public as $$
declare a user_profiles:=assert_reporting_actor();f jsonb:=coalesce(p_filters,'{}')-'layout'-'layoutVersion';x export_logs;l customer_export_layouts;begin
 if p_key not in ('customer_master','customer_enquiries','customer_stages','customer_answers','customer_activity','customer_followups','customer_commercial','customer_exceptions') or p_request_key is null or jsonb_typeof(f)<>'object' or pg_column_size(f)>8192 then raise exception 'Invalid customer export' using errcode='22023';end if;
 if not has_permission('reports.export') then raise exception 'Export permission required' using errcode='42501';end if;
 if p_key='customer_answers' then perform assert_module_enabled('fms_builder');else perform assert_module_access('crm');end if;
 if p_key='customer_exceptions' and not has_permission('settings.manage_organization') then raise exception 'Integration administration required' using errcode='42501';end if;
 if nullif(f->>'layoutId','') is not null then
  select * into l from customer_export_layouts where id=(f->>'layoutId')::uuid and tenant_id=a.tenant_id;
  if l.id is null or p_key<>'customer_answers' then raise exception 'Invalid export layout' using errcode='22023';end if;
  f:=f||jsonb_build_object('layout',l.configuration,'layoutVersion',l.version,'flowId',l.configuration->'flowId','stageId',l.configuration->'stageId');
 end if;
 if nullif(f->>'from','') is not null then perform (f->>'from')::timestamptz;end if;
 if nullif(f->>'until','') is not null then perform (f->>'until')::timestamptz;end if;
 perform pg_advisory_xact_lock(hashtextextended(a.tenant_id||'.'||a.id||'.'||p_request_key,0));
 select * into x from export_logs where tenant_id=a.tenant_id and user_profile_id=a.id and request_key=p_request_key;
 if x.id is not null then if x.report_key<>p_key or x.filter_snapshot<>f then raise exception 'Request key changed' using errcode='23505';end if;return x;end if;
 insert into export_logs(tenant_id,user_profile_id,report_key,filter_snapshot,requester_role,scope_snapshot,request_key,requested_at)
 values(a.tenant_id,a.id,p_key,f,a.user_role,jsonb_build_object('tenant_id',a.tenant_id,'customer_export',true),p_request_key,clock_timestamp()) returning * into x;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value) values(a.tenant_id,a.id,'customer_export_requested','reports',x.id,jsonb_build_object('report_key',p_key));return x;
end $$;
alter function get_report_export_batch(uuid,integer,integer) rename to get_report_export_batch_before_customers;
create function get_report_export_batch(p_export_id uuid,p_offset integer,p_limit integer) returns jsonb language plpgsql security definer set search_path=public as $$
declare x export_logs;a user_profiles;rows jsonb;total bigint;f jsonb;saved_sub text:=current_setting('request.jwt.claim.sub',true);cols jsonb;item jsonb;root_rows jsonb:='[]';root_total bigint:=0;remaining integer;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Worker required' using errcode='42501';end if;
 select * into x from export_logs where id=p_export_id;
 if x.report_key not like 'customer_%' then return get_report_export_batch_before_customers(p_export_id,p_offset,p_limit);end if;
 if p_offset<0 or p_limit not between 1 and 1000 or x.status not in ('processing','cancelled') then raise exception 'Invalid export batch' using errcode='22023';end if;
 if x.status='cancelled' then return '{"cancelled":true,"rows":[],"total":0}';end if;
 select * into a from user_profiles where id=x.user_profile_id and tenant_id=x.tenant_id;
 if a.id is null or a.working_status in ('inactive','resigned') or not a.is_login_enabled or not permission_effective_for(a.id,'reports.export') then raise exception 'Requester no longer authorized' using errcode='42501';end if;
 -- Reuse the current source-work authorization as the persisted requester, never as the worker.
 perform set_config('request.jwt.claim.sub',a.auth_user_id::text,true);
 perform assert_module_access('reports');f:=x.filter_snapshot;
 if x.report_key<>'customer_answers' then
  perform assert_module_access('crm');if x.report_key='customer_exceptions' and not has_permission('settings.manage_organization') then raise exception 'Administration required' using errcode='42501';end if;
  if x.report_key='customer_exceptions' then
   with selected as materialized(select 'jewelos:'||e.id as source_id,e.created_at as occurred_at,e.payload->>'branchId' as branch_id,m.descriptor->>'channel' as channel,e.payload#>>'{workflow,instanceId}' as workflow_id,e.payload#>>'{workflow,instanceStageId}' as stage_id,e.payload->>'actorId' as actor_id,
    case when e.rejected_at is not null then 'rejected' when e.dead_at is not null then 'failed' when e.review_at is not null then 'review' else 'pending' end as status,
    jsonb_build_object('origin','JewelOS outbox','attempts',e.attempts,'errorCode',e.last_error,'sourceTime',e.payload->'occurredAt') as details
    from crm_sync.customer_events e join form_customer_mapping_versions m on m.id=e.mapping_id where e.tenant_id=a.tenant_id and e.delivered_at is null and e.created_at<=x.requested_at
    and (nullif(f->>'branchId','') is null or e.payload->>'branchId'=f->>'branchId')
    and (nullif(f->>'channel','') is null or m.descriptor->>'channel'=f->>'channel')
    and (nullif(f->>'flowId','') is null or e.payload#>>'{workflow,flowId}'=f->>'flowId')
    and (nullif(f->>'from','') is null or e.created_at>=(f->>'from')::timestamptz)
    and (nullif(f->>'until','') is null or e.created_at<(f->>'until')::timestamptz)),
   filtered as(select * from selected where nullif(f->>'status','') is null or status=f->>'status'),
   page as(select * from filtered order by occurred_at,source_id offset p_offset limit p_limit)
   select (select count(*) from filtered),coalesce(jsonb_agg(to_jsonb(page)),'[]') into root_total,root_rows from page;
  end if;
  remaining:=p_limit-jsonb_array_length(root_rows);
  perform set_config('request.jwt.claim.sub',coalesce(saved_sub,''),true);
  return jsonb_build_object('localRows',root_rows,'localTotal',root_total,'remaining',remaining,'remote',jsonb_build_object('tenantId',a.tenant_id,'actorId',a.id,'exportId',x.id,'key',x.report_key,'filters',f,'before',x.requested_at,'offset',greatest(p_offset-root_total,0),'limit',greatest(1,least(remaining,500))));
 end if;
 perform assert_module_enabled('fms_builder');
 with selected as materialized (
 select s.id as source_id,s.submitted_at as occurred_at,i.branch_id,i.id as workflow_id,w.id as stage_id,s.submitted_by as actor_id,w.assigned_to,w.status::text
 from form_submissions s join fms_instance_stages w on w.form_submission_id=s.id join fms_instances i on i.id=w.fms_instance_id
 where s.tenant_id=a.tenant_id and s.status='submitted' and s.submitted_at<=x.requested_at and can_read_fms_work_context(w.id)
 and (nullif(f->>'flowId','') is null or i.fms_flow_id=(f->>'flowId')::uuid)
 and (nullif(f->>'stageId','') is null or w.fms_stage_id=(f->>'stageId')::uuid)
 and (nullif(f->>'instanceId','') is null or i.id=(f->>'instanceId')::uuid)
 and (nullif(f->>'branchId','') is null or i.branch_id=(f->>'branchId')::uuid)
 and (nullif(f->>'assignedId','') is null or (f->>'assignedId')::uuid=any(w.assigned_to))
 and (nullif(f->>'status','') is null or w.status::text=f->>'status')
 and (nullif(f->>'from','') is null or s.submitted_at>=(f->>'from')::timestamptz)
 and (nullif(f->>'until','') is null or s.submitted_at<(f->>'until')::timestamptz)
 ), page_ids as materialized(select * from selected order by occurred_at,source_id offset p_offset limit p_limit),
 page as(select page_ids.*,s.data,s.template_snapshot,jsonb_build_object('submissionId',s.id,'formSnapshot',s.template_snapshot,'originalAnswers',s.data,'layoutVersion',f->'layoutVersion') as details
 from page_ids join form_submissions s on s.id=page_ids.source_id)
 select (select count(*) from selected),coalesce(jsonb_agg(to_jsonb(page)-'data'-'template_snapshot'||coalesce((select jsonb_object_agg('q:'||(question->>'fieldKey'),page.data->(question->>'fieldKey')) from jsonb_array_elements(coalesce(f#>'{layout,questions}','[]'))question),'{}')),'[]') into total,rows from page;
 if f ? 'layout' then
  cols:='[{"key":"source_id","label":"Submission ID"},{"key":"workflow_id","label":"Workflow ID"},{"key":"stage_id","label":"Stage visit ID"},{"key":"actor_id","label":"Performed by ID"},{"key":"assigned_to","label":"Assigned employees"},{"key":"occurred_at","label":"Submitted (Asia/Kolkata)","instant":true}]';
  for item in select value from jsonb_array_elements(f#>'{layout,questions}') loop
   cols:=cols||jsonb_build_array(jsonb_build_object('key','q:'||(item->>'fieldKey'),'label',item->>'header','phone',coalesce((item->>'phone')::boolean,false)));
  end loop;
 end if;
 perform set_config('request.jwt.claim.sub',coalesce(saved_sub,''),true);
 return jsonb_build_object('rows',rows,'total',total)||case when cols is null then '{}' else jsonb_build_object('columns',cols) end;
exception when others then perform set_config('request.jwt.claim.sub',coalesce(saved_sub,''),true);raise;
end $$;
revoke all on function save_customer_export_layout(text,jsonb),get_customer_export_layouts(),request_customer_export(text,jsonb,uuid) from public,anon,authenticated,service_role;
grant execute on function save_customer_export_layout(text,jsonb),get_customer_export_layouts(),request_customer_export(text,jsonb,uuid) to authenticated;
revoke all on function get_report_export_batch(uuid,integer,integer),get_report_export_batch_before_customers(uuid,integer,integer) from public,anon,authenticated,service_role;
grant execute on function get_report_export_batch(uuid,integer,integer) to service_role;
notify pgrst,'reload schema';
create function customer_export_options(p_flow uuid default null) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();begin
 perform assert_module_access('reports');if not current_profile_is_active() or not has_permission('reports.export') then raise exception 'Export access required' using errcode='42501';end if;
 return jsonb_build_object('flows',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select id,name||' · v'||version as name,version from fms_flows where tenant_id=a.tenant_id order by name,version desc limit 100)r),
 'stages',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select s.id,s.name,s.stage_key,s.form_template_id,
  (select coalesce(jsonb_agg(jsonb_build_object('key',f.field_key,'label',f.field_name,'type',f.field_type) order by f.sort_order),'[]') from form_fields f join form_templates template on template.id=f.form_template_id where f.form_template_id=s.form_template_id and template.tenant_id=a.tenant_id) fields
 from fms_stages s join fms_flows flow on flow.id=s.fms_flow_id where s.fms_flow_id=p_flow and flow.tenant_id=a.tenant_id order by s.sort_order limit 100)r),
 'employees',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select id,employee_name as name from user_profiles where tenant_id=a.tenant_id and working_status not in ('inactive','resigned') order by employee_name limit 200)r));
end $$;
revoke all on function customer_export_options(uuid) from public,anon,authenticated,service_role;
grant execute on function customer_export_options(uuid) to authenticated;
notify pgrst,'reload schema';
create function crm_sync.export_layout_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Export layouts are immutable; save a new version' using errcode='23514';end $$;
create trigger customer_export_layout_immutable before update or delete on customer_export_layouts for each row execute function crm_sync.export_layout_immutable();
revoke all on function crm_sync.export_layout_immutable() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
