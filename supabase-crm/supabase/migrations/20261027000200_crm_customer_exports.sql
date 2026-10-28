-- Bounded CRM export adapter, called only by the existing JewelOS private export worker.
create function public.crm_customer_export_batch(p_tenant uuid,p_actor uuid,p_export_id uuid,p_key text,p_filters jsonb,p_before timestamptz,p_offset integer,p_limit integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare query text;result jsonb;actor uuid;begin
 if auth.role() is distinct from 'service_role' then raise exception 'Export worker required' using errcode='42501';end if;
 -- Root reports.export is checked separately. CRM grants and source membership are checked again here.
 select u.id into actor from public.users u join public.crm_sso_access_grants g on g.legacy_crm_user_id=u.id
 join crm_private.master_members m on m.jewelos_user_id=g.jewelos_user_id and m.tenant_id=p_tenant and m.active
 where g.jewelos_user_id=p_actor and g.active and u.active and u.role='super_admin';
 if actor is null or not exists(select 1 from crm_private.customer_sources where tenant_id=p_tenant and enabled) then raise exception 'CRM export administrator required' using errcode='42501';end if;
 if p_offset<0 or p_limit not between 1 and 500 or p_before is null or p_export_id is null or jsonb_typeof(p_filters) is distinct from 'object' or pg_column_size(p_filters)>16384 then raise exception 'Invalid export batch' using errcode='22023';end if;
 query:=case p_key
 when 'customer_master' then $q$select c.client_id::text source_id,c.client_id,c.primary_name::text name,c.primary_phone::text phone,c.profile_updated_at occurred_at,c.last_branch_id branch_id,null::text channel,null::text workflow_id,null::text stage_id,null::uuid actor_id,null::jsonb assigned_to,c.lifecycle_stage::text status,to_jsonb(c)||crm_private.customer_commercial_summary(c.client_id) details from public.clients c$q$
 when 'customer_enquiries' then $q$select 'lead:'||l.id source_id,l.client_id,l.name::text,l.phone_number::text phone,l.created_at occurred_at,l.branch_id,l.source_channel::text channel,null::text workflow_id,null::text stage_id,l.created_by actor_id,null::jsonb assigned_to,'lead'::text status,l.field_values details from public.leads l
 union all select e.event_id,e.client_id,c.primary_name,c.primary_phone,e.occurred_at,e.branch_id,e.channel,e.workflow->>'instanceId',e.workflow->>'instanceStageId',e.actor_id,e.workflow->'assignedUserIds',e.kind,e.provenance||jsonb_build_object('answers',e.answers,'workflow',e.workflow) from public.crm_customer_workflow_events e join public.clients c using(client_id) where e.kind='form.submitted'$q$
 when 'customer_stages' then $q$select e.event_id source_id,e.client_id,c.primary_name::text name,c.primary_phone::text phone,e.occurred_at,e.branch_id,e.channel,e.workflow->>'instanceId' workflow_id,e.workflow->>'instanceStageId' stage_id,e.actor_id,e.workflow->'assignedUserIds' assigned_to,e.workflow->>'status' status,e.provenance||jsonb_build_object('workflow',e.workflow,'answers',e.answers) details from public.crm_customer_workflow_events e join public.clients c using(client_id)$q$
 when 'customer_activity' then $q$select a.activity_id source_id,a.client_id,c.primary_name::text name,c.primary_phone::text phone,a.occurred_at,a.branch_id,a.channel,a.details#>>'{workflow,instanceId}' workflow_id,a.details#>>'{workflow,instanceStageId}' stage_id,a.actor_id,a.details#>'{workflow,assignedUserIds}' assigned_to,a.kind status,a.details from public.crm_client_activity a join public.clients c using(client_id)$q$
 when 'customer_followups' then $q$select f.id::text source_id,f.client_id,c.primary_name::text name,c.primary_phone::text phone,f.created_at occurred_at,f.branch_id,'CRM'::text channel,null::text workflow_id,null::text stage_id,f.entered_by actor_id,null::jsonb assigned_to,f.status::text,to_jsonb(f) details from public.not_bought_followups f join public.clients c using(client_id)
 union all select e.event_id,e.client_id,c.primary_name,c.primary_phone,e.occurred_at,e.branch_id,e.channel,e.workflow->>'instanceId',e.workflow->>'instanceStageId',e.actor_id,e.workflow->'assignedUserIds',e.kind,jsonb_build_object('answers',e.answers,'provenance',e.provenance,'workflow',e.workflow) from public.crm_customer_workflow_events e join public.clients c using(client_id) where exists(select 1 from jsonb_array_elements(e.answers) a where a->>'destination'='next_follow_up')$q$
 when 'customer_commercial' then $q$select t.id::text source_id,t.client_id,c.primary_name::text name,c.primary_phone::text phone,t.event_date occurred_at,t.branch_id,'STORE'::text channel,null::text workflow_id,null::text stage_id,t.salesperson_id actor_id,null::jsonb assigned_to,t.buy_status::text status,to_jsonb(t)||jsonb_build_object('verifiedPurchase',crm_private.walkin_purchase_evidence(t.buy_status,t.bought_categories,f.did_buy,f.additional_fields),'savedForm',to_jsonb(f)) details from public.client_timeline t join public.clients c using(client_id) left join public.visit_forms f on f.client_timeline_id=t.id$q$
 when 'customer_exceptions' then $q$select e.event_id source_id,e.review_client_id client_id,null::text name,null::text phone,e.received_at occurred_at,nullif(e.payload->>'branchId','')::uuid branch_id,e.payload->>'channel' channel,e.payload#>>'{workflow,instanceId}' workflow_id,e.payload#>>'{workflow,instanceStageId}' stage_id,nullif(e.payload->>'actorId','')::uuid actor_id,e.payload#>'{workflow,assignedUserIds}' assigned_to,e.review_reason status,jsonb_build_object('candidateIds',e.candidates,'result',e.result,'sourceTime',e.payload->'occurredAt') details from crm_private.customer_event_inbox e where e.applied_at is null and e.tenant_id=$4$q$
 else null end;
 if query is null then raise exception 'Unknown customer export' using errcode='22023';end if;
 execute 'with records as materialized(select * from ('||query||')r where occurred_at<=$2
 and (nullif($1->>''clientId'','''') is null or client_id=($1->>''clientId'')::uuid)
 and (nullif($1->>''branchId'','''') is null or branch_id=($1->>''branchId'')::uuid)
 and (nullif($1->>''channel'','''') is null or channel=$1->>''channel'')
 and (nullif($1->>''flowId'','''') is null or details#>>''{workflow,flowId}''=$1->>''flowId'')
 and (nullif($1->>''stageId'','''') is null or details#>>''{workflow,stageId}''=$1->>''stageId'')
 and (nullif($1->>''instanceId'','''') is null or workflow_id=$1->>''instanceId'')
 and (nullif($1->>''assignedId'','''') is null or assigned_to @> jsonb_build_array($1->>''assignedId''))
 and (nullif($1->>''status'','''') is null or status=$1->>''status'')
 and (nullif($1->>''from'','''') is null or occurred_at>=($1->>''from'')::timestamptz)
 and (nullif($1->>''until'','''') is null or occurred_at<($1->>''until'')::timestamptz)),
 page as(select * from records order by occurred_at,source_id offset $3 limit $5)
 select jsonb_build_object(''rows'',coalesce((select jsonb_agg(case when $6=''customer_master'' then to_jsonb(page)||jsonb_build_object(''details'',crm_private.effective_customer_profile(page.client_id)||crm_private.customer_commercial_summary(page.client_id)) else to_jsonb(page) end) from page),''[]''),''total'',(select count(*) from records))'
 into result using p_filters,p_before,p_offset,p_tenant,p_limit,p_key;
 -- Audit only job identity and counts, never exported customer answers.
 perform crm_private.write_audit_log('crm.customer_export_batch',null,jsonb_build_object('export_id',p_export_id,'actor_id',actor,'key',p_key,'offset',p_offset,'rows',jsonb_array_length(result->'rows')));
 return result;
end $$;
revoke all on function public.crm_customer_export_batch(uuid,uuid,uuid,text,jsonb,timestamptz,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.crm_customer_export_batch(uuid,uuid,uuid,text,jsonb,timestamptz,integer,integer) to service_role;
notify pgrst,'reload schema';
