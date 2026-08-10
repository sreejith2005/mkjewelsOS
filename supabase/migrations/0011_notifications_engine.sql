-- Production Notifications engine: canonical events, audited administration,
-- server-side recipient resolution, idempotent outbox, retries, and inbox.

set search_path = public, extensions;

-- --------------------------------------------------------------------------
-- Production storage contract
-- --------------------------------------------------------------------------

alter table notification_templates
  add column name text,
  add column lifecycle text not null default 'active',
  add column link_url text,
  add column created_by uuid references user_profiles(id),
  add column updated_by uuid references user_profiles(id),
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add constraint notification_templates_channel_check
    check (channel in ('in_app','email','whatsapp','sms','push')),
  add constraint notification_templates_lifecycle_check
    check (lifecycle in ('active','archived')),
  add constraint notification_templates_lengths_check
    check (length(title_template) between 1 and 200 and length(body_template) between 1 and 4000),
  add constraint notification_templates_link_check
    check (link_url is null or (link_url like '/%' and link_url not like '//%' and position(E'\\' in link_url)=0));

update notification_templates set name=left(event_type||' '||channel,120) where name is null;
alter table notification_templates alter column name set not null;
alter table notification_templates alter column name set default 'Legacy notification template';

alter table notification_rules
  add column name text,
  add column recipient_rules jsonb not null default '[]'::jsonb,
  add column channel_templates jsonb not null default '{}'::jsonb,
  add column delay_minutes integer not null default 0,
  add column cooldown_minutes integer not null default 0,
  add column max_attempts integer not null default 3,
  add column backoff_minutes integer not null default 5,
  add column priority task_priority not null default 'medium',
  add column lifecycle text not null default 'active',
  add column created_by uuid references user_profiles(id),
  add column updated_by uuid references user_profiles(id),
  add column created_at timestamptz not null default now(),
  add column updated_at timestamptz not null default now(),
  add constraint notification_rules_lifecycle_check check (lifecycle in ('active','archived')),
  add constraint notification_rules_timing_check check (
    delay_minutes between 0 and 43200 and cooldown_minutes between 0 and 525600
    and max_attempts between 1 and 10 and backoff_minutes between 1 and 1440
  ),
  add constraint notification_rules_conditions_array_check check (jsonb_typeof(conditions)='array'),
  add constraint notification_rules_recipients_array_check check (jsonb_typeof(recipient_rules)='array'),
  add constraint notification_rules_templates_object_check check (jsonb_typeof(channel_templates)='object');

update notification_rules
set name=left(event_type||' notifications',120),
    conditions=case when jsonb_typeof(conditions)='array' then conditions else '[]'::jsonb end,
    recipient_rules=case when jsonb_typeof(recipient_rules)='array' then recipient_rules else '[]'::jsonb end;
alter table notification_rules alter column name set not null;
alter table notification_rules alter column conditions set default '[]'::jsonb;
alter table notification_rules alter column name set default 'Legacy notification rule';

create table notification_events (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid references branches(id),
  department_id uuid references departments(id),
  event_type text not null check (event_type in (
    'task_assigned','task_delegated','task_completed','task_overdue','task_coverage_required',
    'form_submitted','form_approved','form_rejected',
    'fms_stage_assigned','fms_stage_completed','fms_stage_rejected','fms_revision_requested',
    'fms_stage_escalated','fms_sla_breached','fms_completed','system_alert'
  )),
  source_module text not null check (source_module in ('tasks','forms','fms','system')),
  source_record_id uuid not null,
  actor_profile_id uuid references user_profiles(id),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload)='object'),
  idempotency_key text not null check (length(idempotency_key) between 8 and 500),
  occurred_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','processing','processed','failed')),
  processing_started_at timestamptz,
  processed_at timestamptz,
  error_category text,
  created_at timestamptz not null default now(),
  unique (tenant_id,idempotency_key)
);

create table notification_deliveries (
  id uuid primary key default uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  event_id uuid not null references notification_events(id) on delete cascade,
  rule_id uuid not null references notification_rules(id),
  template_id uuid not null references notification_templates(id),
  recipient_profile_id uuid not null references user_profiles(id),
  channel text not null check (channel in ('in_app','email','whatsapp','sms','push')),
  state text not null default 'pending' check (state in (
    'pending','scheduled','processing','delivered','retry_wait',
    'failed_terminal','blocked_configuration','cancelled'
  )),
  priority task_priority not null default 'medium',
  resolved_title text not null check (length(resolved_title) between 1 and 200),
  resolved_body text not null check (length(resolved_body) between 1 and 4000),
  resolved_link_url text,
  scheduled_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  max_attempts integer not null default 3 check (max_attempts between 1 and 100),
  backoff_minutes integer not null default 5 check (backoff_minutes between 1 and 1440),
  processing_started_at timestamptz,
  lease_expires_at timestamptz,
  worker_id uuid,
  provider_identifier text,
  error_category text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id,rule_id,recipient_profile_id,channel),
  check (resolved_link_url is null or (resolved_link_url like '/%' and resolved_link_url not like '//%' and position(E'\\' in resolved_link_url)=0))
);

alter table notifications
  add column branch_id uuid references branches(id),
  add column department_id uuid references departments(id),
  add column priority task_priority not null default 'medium',
  add column source_module text,
  add column source_record_id uuid,
  add column delivery_id uuid unique references notification_deliveries(id) on delete set null,
  add column delivered_at timestamptz,
  add constraint notifications_channel_check check (channel in ('in_app','email','whatsapp','sms','push')),
  add constraint notifications_delivery_status_check check (delivered_status in (
    'pending','scheduled','processing','delivered','retry_wait','failed_terminal',
    'blocked_configuration','cancelled'
  )),
  add constraint notifications_link_check check (
    link_url is null or (link_url like '/%' and link_url not like '//%' and position(E'\\' in link_url)=0)
  );

alter table notification_logs
  add column tenant_id uuid references tenants(id) on delete cascade,
  add column delivery_id uuid references notification_deliveries(id) on delete cascade,
  add column attempt_number integer,
  add column provider_identifier text,
  add column error_category text,
  add column finished_at timestamptz,
  add constraint notification_logs_status_check check (status in (
    'processing','delivered','retry_wait','failed_terminal','blocked_configuration'
  )),
  add constraint notification_logs_attempt_check check (attempt_number is null or attempt_number between 1 and 100);

-- Provider metadata contains no credential or destination fields. External
-- channels remain unavailable until a reviewed server-side provider is added.
create table notification_provider_configuration (
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel text not null check (channel in ('email','whatsapp','sms','push')),
  is_available boolean not null default false,
  provider_identifier text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id,channel),
  check (provider_identifier is null or provider_identifier ~ '^[a-z][a-z0-9_-]{1,63}$')
);

create index idx_notifications_tenant_recipient_unread
  on notifications(tenant_id,user_profile_id,created_at desc) where not is_read;
create index idx_notification_events_tenant_pending
  on notification_events(tenant_id,status,occurred_at,id) where status in ('pending','processing');
create index idx_notification_events_tenant_source
  on notification_events(tenant_id,source_module,source_record_id,occurred_at desc);
create index idx_notification_deliveries_tenant_claim
  on notification_deliveries(tenant_id,state,next_attempt_at,scheduled_at,id)
  where state in ('pending','scheduled','retry_wait','processing');
create index idx_notification_deliveries_tenant_admin
  on notification_deliveries(tenant_id,state,channel,created_at desc);
create index idx_notification_deliveries_recipient_channel
  on notification_deliveries(tenant_id,recipient_profile_id,channel,delivered_at desc);
create index idx_notification_logs_tenant_delivery
  on notification_logs(tenant_id,delivery_id,created_at desc);

-- --------------------------------------------------------------------------
-- Validation, rendering, conditions, recipients
-- --------------------------------------------------------------------------

create function notification_event_variables(p_event_type text)
returns text[] language sql immutable set search_path=public as $$
 select case p_event_type
  when 'task_assigned' then array['actor_name','assignee_name','task_title','planned_datetime','priority']
  when 'task_delegated' then array['actor_name','assignee_name','task_title','planned_datetime','priority','reason']
  when 'task_completed' then array['actor_name','task_title','completed_at','priority']
  when 'task_overdue' then array['assignee_name','task_title','planned_datetime','priority']
  when 'task_coverage_required' then array['task_title','planned_datetime','priority','reason']
  when 'form_submitted' then array['actor_name','form_name','submitted_at']
  when 'form_approved' then array['actor_name','form_name','reviewed_at','review_notes']
  when 'form_rejected' then array['actor_name','form_name','reviewed_at','review_notes']
  when 'fms_stage_assigned' then array['actor_name','assignee_name','flow_name','stage_name','reference','planned_datetime','priority']
  when 'fms_stage_completed' then array['actor_name','flow_name','stage_name','reference','completed_at','priority']
  when 'fms_stage_rejected' then array['actor_name','flow_name','stage_name','reference','reason','priority']
  when 'fms_revision_requested' then array['actor_name','flow_name','stage_name','reference','reason','priority']
  when 'fms_stage_escalated' then array['actor_name','flow_name','stage_name','reference','reason','priority']
  when 'fms_sla_breached' then array['flow_name','stage_name','reference','planned_datetime','priority']
  when 'fms_completed' then array['actor_name','flow_name','reference','completed_at','priority']
  when 'system_alert' then array['alert_title','alert_message','priority']
  else array[]::text[] end;
$$;

create function notification_link_is_safe(p_link text)
returns boolean language sql immutable set search_path=public as $$
 select p_link is null or (
   p_link like '/%' and p_link not like '//%' and position(E'\\' in p_link)=0
   and p_link !~ '[[:cntrl:]]'
 );
$$;

create function validate_notification_template_text(p_event_type text,p_title text,p_body text)
returns void language plpgsql set search_path=public as $$
declare v_match text[]; v_allowed text[]:=notification_event_variables(p_event_type); v_remainder text;
begin
 if cardinality(v_allowed)=0 then raise exception 'Unsupported notification event type' using errcode='22023'; end if;
 if nullif(btrim(p_title),'') is null or nullif(btrim(p_body),'') is null
    or length(p_title)>200 or length(p_body)>4000 then
   raise exception 'Notification title or body length is invalid' using errcode='22023';
 end if;
 for v_match in select regexp_matches(p_title||E'\n'||p_body,'\{\{([a-z][a-z0-9_]*)\}\}','g') loop
   if not v_match[1]=any(v_allowed) then raise exception 'Template variable is not allowed for this event' using errcode='22023'; end if;
 end loop;
 v_remainder:=regexp_replace(p_title||E'\n'||p_body,'\{\{[a-z][a-z0-9_]*\}\}','','g');
 if v_remainder like '%{{%' or v_remainder like '%}}%' then
   raise exception 'Template contains a malformed placeholder' using errcode='22023';
 end if;
end $$;

create function render_notification_template(p_template text,p_payload jsonb)
returns text language plpgsql immutable set search_path=public as $$
declare v_result text:=p_template; v_match text[]; v_value text;
begin
 for v_match in select regexp_matches(p_template,'\{\{([a-z][a-z0-9_]*)\}\}','g') loop
   v_value:=p_payload->>v_match[1];
   if nullif(v_value,'') is null then raise exception 'Required notification variable is missing' using errcode='22023'; end if;
   v_result:=replace(v_result,'{{'||v_match[1]||'}}',v_value);
 end loop;
 if v_result like '%{{%' or v_result like '%}}%' then raise exception 'Notification template was not fully resolved' using errcode='22023'; end if;
 return v_result;
end $$;

create function notification_condition_matches(p_condition jsonb,p_payload jsonb,p_now timestamptz default now())
returns boolean language plpgsql stable set search_path=public as $$
declare v_field text:=p_condition->>'field'; v_operator text:=p_condition->>'operator'; v_actual jsonb:=p_payload->v_field; v_expected jsonb:=p_condition->'value'; v_a numeric; v_b numeric; v_text text;
begin
 if v_field is null or v_operator is null then return false; end if;
 v_text:=p_payload->>v_field;
 case v_operator
  when 'equals' then return v_actual is not null and (v_actual=v_expected or v_text=trim(both '"' from coalesce(v_expected::text,'')));
  when 'not_equals' then return not notification_condition_matches(jsonb_set(p_condition,'{operator}','"equals"'),p_payload,p_now);
  when 'contains' then return lower(coalesce(v_text,'')) like '%'||lower(trim(both '"' from coalesce(v_expected::text,'')))||'%';
  when 'is_empty' then return v_actual is null or v_actual='null'::jsonb or v_text='' or v_actual='[]'::jsonb;
  when 'is_not_empty' then return not notification_condition_matches(jsonb_set(p_condition,'{operator}','"is_empty"'),p_payload,p_now);
  when 'is_today' then return left(coalesce(v_text,''),10)=(p_now at time zone 'Asia/Kolkata')::date::text;
  when 'is_past' then begin return v_text::timestamptz<p_now; exception when others then return false; end;
  when 'is_future' then begin return v_text::timestamptz>p_now; exception when others then return false; end;
  else
   begin v_a:=v_text::numeric; v_b:=trim(both '"' from v_expected::text)::numeric; exception when others then return false; end;
   return case v_operator when 'greater_than' then v_a>v_b when 'greater_than_or_equal' then v_a>=v_b when 'less_than' then v_a<v_b when 'less_than_or_equal' then v_a<=v_b else false end;
 end case;
end $$;

create function notification_rule_matches(p_conditions jsonb,p_payload jsonb)
returns boolean language sql stable set search_path=public as $$
 select jsonb_typeof(p_conditions)='array' and not exists(
   select 1 from jsonb_array_elements(p_conditions) c where not notification_condition_matches(c,p_payload)
 );
$$;

create function resolve_notification_recipients(p_event notification_events,p_rules jsonb)
returns table(user_profile_id uuid) language plpgsql stable security definer set search_path=public as $$
declare v_rule jsonb; v_type text; v_id_text text; v_candidate uuid; v_candidates uuid[]:=array[]::uuid[];
begin
 for v_rule in select value from jsonb_array_elements(p_rules) loop
  v_type:=v_rule->>'type';
  if v_type='assigned_users' then
   for v_id_text in select jsonb_array_elements_text(coalesce(p_event.payload->'_assigned_user_ids','[]'::jsonb)) loop v_candidates:=array_append(v_candidates,v_id_text::uuid); end loop;
  elsif v_type='task_creator' then v_candidates:=array_append(v_candidates,nullif(p_event.payload->>'_task_creator_id','')::uuid);
  elsif v_type='instance_starter' then v_candidates:=array_append(v_candidates,nullif(p_event.payload->>'_instance_starter_id','')::uuid);
  elsif v_type='form_submitter' then v_candidates:=array_append(v_candidates,nullif(p_event.payload->>'_form_submitter_id','')::uuid);
  elsif v_type='reviewer' then v_candidates:=array_append(v_candidates,nullif(p_event.payload->>'_reviewer_id','')::uuid);
  elsif v_type='actor' then v_candidates:=array_append(v_candidates,p_event.actor_profile_id);
  elsif v_type='branch_manager' and p_event.branch_id is not null then select manager_id into v_candidate from branches where id=p_event.branch_id and tenant_id=p_event.tenant_id; v_candidates:=array_append(v_candidates,v_candidate);
  elsif v_type='department_head' and p_event.department_id is not null then select head_id into v_candidate from departments where id=p_event.department_id and tenant_id=p_event.tenant_id; v_candidates:=array_append(v_candidates,v_candidate);
  elsif v_type='manager' then for v_candidate in select id from user_profiles where tenant_id=p_event.tenant_id and user_role='manager' and (p_event.branch_id is null or branch_id=p_event.branch_id) loop v_candidates:=array_append(v_candidates,v_candidate); end loop;
  elsif v_type='specified_users' then for v_id_text in select jsonb_array_elements_text(coalesce(v_rule->'user_ids','[]'::jsonb)) loop v_candidates:=array_append(v_candidates,v_id_text::uuid); end loop;
  elsif v_type='specified_role' then for v_candidate in select id from user_profiles where tenant_id=p_event.tenant_id and user_role::text=v_rule->>'role' and (p_event.branch_id is null or branch_id=p_event.branch_id) loop v_candidates:=array_append(v_candidates,v_candidate); end loop;
  end if;
 end loop;
 return query select distinct up.id from user_profiles up where up.id=any(v_candidates) and up.tenant_id=p_event.tenant_id and up.working_status not in ('inactive','resigned') and up.is_login_enabled and (p_event.branch_id is null or up.branch_id=p_event.branch_id or up.user_role in ('super_admin','admin')) and (p_event.department_id is null or up.department_id=p_event.department_id or up.user_role in ('super_admin','admin','manager'));
end $$;

-- --------------------------------------------------------------------------
-- Canonical event ingestion and outbox processing
-- --------------------------------------------------------------------------

create function enqueue_notification_event(
 p_tenant_id uuid,p_branch_id uuid,p_department_id uuid,p_event_type text,
 p_source_module text,p_source_record_id uuid,p_actor_profile_id uuid,
 p_payload jsonb,p_idempotency_key text,p_occurred_at timestamptz default now()
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_occurred timestamptz:=coalesce(p_occurred_at,now()); v_key text;
begin
 if p_tenant_id is null or p_source_record_id is null or jsonb_typeof(coalesce(p_payload,'{}'))<>'object' then raise exception 'Notification event is invalid' using errcode='22023'; end if;
 v_key:=lower(coalesce(nullif(p_idempotency_key,''),p_event_type||':'||p_source_module||':'||p_source_record_id||':'||v_occurred::text));
 insert into notification_events(tenant_id,branch_id,department_id,event_type,source_module,source_record_id,actor_profile_id,payload,idempotency_key,occurred_at)
 values(p_tenant_id,p_branch_id,p_department_id,p_event_type,p_source_module,p_source_record_id,p_actor_profile_id,coalesce(p_payload,'{}'),v_key,v_occurred)
 on conflict(tenant_id,idempotency_key) do update set idempotency_key=excluded.idempotency_key returning id into v_id;
 return v_id;
end $$;

create function process_notification_events(p_limit integer default 50)
returns table(events_processed integer,deliveries_created integer,events_failed integer)
language plpgsql security definer set search_path=public as $$
declare v_event notification_events; v_rule notification_rules; v_channel text; v_template notification_templates; v_recipient uuid; v_title text; v_body text; v_link text; v_created integer:=0; v_processed integer:=0; v_failed integer:=0; v_row_count integer;
begin
 if current_user not in ('postgres','service_role') or p_limit not between 1 and 200 then raise exception 'Event processing is not authorized' using errcode='42501'; end if;
 for v_event in
  select * from notification_events where status in ('pending','processing') and (status='pending' or processing_started_at<now()-interval '10 minutes') order by occurred_at,id for update skip locked limit p_limit
 loop
  update notification_events set status='processing',processing_started_at=now(),error_category=null where id=v_event.id;
  begin
   for v_rule in select * from notification_rules where tenant_id=v_event.tenant_id and event_type=v_event.event_type and lifecycle='active' and is_active and notification_rule_matches(conditions,v_event.payload) order by id loop
    for v_channel in select jsonb_object_keys(v_rule.channel_templates) loop
     select * into v_template from notification_templates where id=(v_rule.channel_templates->>v_channel)::uuid and tenant_id=v_event.tenant_id and event_type=v_event.event_type and channel=v_channel and lifecycle='active' and is_active;
     if v_template.id is null then continue; end if;
     begin
      v_title:=render_notification_template(v_template.title_template,v_event.payload);
      v_body:=render_notification_template(v_template.body_template,v_event.payload);
      v_link:=coalesce(v_event.payload->>'_link_url',v_template.link_url);
      if not notification_link_is_safe(v_link) then raise exception 'Unsafe notification link' using errcode='22023'; end if;
      for v_recipient in select user_profile_id from resolve_notification_recipients(v_event,v_rule.recipient_rules) loop
       if v_rule.cooldown_minutes>0 and exists(select 1 from notification_deliveries where tenant_id=v_event.tenant_id and rule_id=v_rule.id and recipient_profile_id=v_recipient and channel=v_channel and state='delivered' and delivered_at>=now()-make_interval(mins=>v_rule.cooldown_minutes)) then continue; end if;
       insert into notification_deliveries(tenant_id,event_id,rule_id,template_id,recipient_profile_id,channel,state,priority,resolved_title,resolved_body,resolved_link_url,scheduled_at,next_attempt_at,max_attempts,backoff_minutes)
       values(v_event.tenant_id,v_event.id,v_rule.id,v_template.id,v_recipient,v_channel,case when v_event.occurred_at+make_interval(mins=>v_rule.delay_minutes)>now() then 'scheduled' else 'pending' end,v_rule.priority,v_title,v_body,v_link,v_event.occurred_at+make_interval(mins=>v_rule.delay_minutes),v_event.occurred_at+make_interval(mins=>v_rule.delay_minutes),v_rule.max_attempts,v_rule.backoff_minutes)
       on conflict(event_id,rule_id,recipient_profile_id,channel) do nothing;
       get diagnostics v_row_count=row_count;
       v_created:=v_created+v_row_count;
      end loop;
     exception when others then
      update notification_events set error_category='template_rendering_failed' where id=v_event.id;
     end;
    end loop;
   end loop;
   update notification_events set status='processed',processed_at=now(),processing_started_at=null where id=v_event.id;
   v_processed:=v_processed+1;
  exception when others then
   update notification_events set status='failed',processed_at=now(),processing_started_at=null,error_category='event_processing_failed' where id=v_event.id;
   v_failed:=v_failed+1;
  end;
 end loop;
 return query select v_processed,v_created,v_failed;
end $$;

create function claim_notification_deliveries(p_limit integer default 25,p_worker_id uuid default uuid_generate_v4(),p_lease_minutes integer default 5)
returns table(id uuid,channel text,attempt_number integer,max_attempts integer)
language plpgsql security definer set search_path=public as $$
begin
 if current_user not in ('postgres','service_role') or p_limit not between 1 and 100 or p_lease_minutes not between 1 and 30 then raise exception 'Delivery claiming is not authorized' using errcode='42501'; end if;
 return query with candidates as (
  select d.id from notification_deliveries d
  where ((d.state in ('pending','scheduled','retry_wait') and d.scheduled_at<=now() and d.next_attempt_at<=now()) or (d.state='processing' and d.lease_expires_at<now()))
    and d.attempt_count<d.max_attempts
  order by d.next_attempt_at,d.id for update skip locked limit p_limit
 ), claimed as (
  update notification_deliveries d set state='processing',attempt_count=d.attempt_count+1,processing_started_at=now(),lease_expires_at=now()+make_interval(mins=>p_lease_minutes),worker_id=p_worker_id,updated_at=now()
  from candidates c where d.id=c.id returning d.id,d.channel,d.attempt_count,d.max_attempts
 ) select claimed.id,claimed.channel,claimed.attempt_count,claimed.max_attempts from claimed;
end $$;

create function finish_notification_delivery(p_delivery_id uuid,p_outcome text,p_provider_identifier text default null,p_error_category text default null,p_retryable boolean default false)
returns text language plpgsql security definer set search_path=public as $$
declare v_delivery notification_deliveries; v_event notification_events; v_state text; v_next timestamptz; v_notification uuid;
begin
 if current_user not in ('postgres','service_role') then raise exception 'Delivery completion is not authorized' using errcode='42501'; end if;
 select * into v_delivery from notification_deliveries where id=p_delivery_id for update;
 if v_delivery.id is null or v_delivery.state<>'processing' then raise exception 'Delivery is not processing' using errcode='23514'; end if;
 select * into v_event from notification_events where id=v_delivery.event_id;
 if p_outcome='delivered' and v_delivery.channel='in_app' then
  insert into notifications(tenant_id,branch_id,department_id,user_profile_id,event_type,title,message,link_url,channel,delivered_status,priority,source_module,source_record_id,delivery_id,delivered_at)
  values(v_delivery.tenant_id,v_event.branch_id,v_event.department_id,v_delivery.recipient_profile_id,v_event.event_type,v_delivery.resolved_title,v_delivery.resolved_body,v_delivery.resolved_link_url,'in_app','delivered',v_delivery.priority,v_event.source_module,v_event.source_record_id,v_delivery.id,now())
  on conflict(delivery_id) do update set delivery_id=excluded.delivery_id returning id into v_notification;
  v_state:='delivered';
 elsif p_outcome='blocked_configuration' then v_state:='blocked_configuration';
 elsif p_retryable and v_delivery.attempt_count<v_delivery.max_attempts then v_state:='retry_wait'; v_next:=now()+make_interval(mins=>least(1440,v_delivery.backoff_minutes*power(2,v_delivery.attempt_count-1)::integer));
 else v_state:='failed_terminal'; end if;
 update notification_deliveries set state=v_state,next_attempt_at=coalesce(v_next,next_attempt_at),processing_started_at=null,lease_expires_at=null,worker_id=null,provider_identifier=left(p_provider_identifier,64),error_category=left(p_error_category,100),delivered_at=case when v_state='delivered' then now() else delivered_at end,updated_at=now() where id=p_delivery_id;
 insert into notification_logs(tenant_id,delivery_id,notification_id,channel,status,attempt_number,provider_identifier,error_category,finished_at)
 values(v_delivery.tenant_id,p_delivery_id,v_notification,v_delivery.channel,v_state,v_delivery.attempt_count,left(p_provider_identifier,64),left(p_error_category,100),now());
 return v_state;
end $$;

create function detect_scheduled_notification_events(p_limit integer default 100,p_now timestamptz default now())
returns table(task_overdue_events integer,fms_sla_events integer)
language plpgsql security definer set search_path=public as $$
declare v_task task_instances; v_stage record; v_count_task integer:=0; v_count_fms integer:=0; v_ids jsonb;
begin
 if current_user not in ('postgres','service_role') or p_limit not between 1 and 500 then raise exception 'Scheduled detection is not authorized' using errcode='42501'; end if;
 for v_task in select * from task_instances where status not in ('completed','blocked') and coalesce(revised_datetime,planned_datetime)<p_now order by coalesce(revised_datetime,planned_datetime) limit p_limit loop
  select coalesce(jsonb_agg(user_profile_id),'[]') into v_ids from task_assignees where task_instance_id=v_task.id and is_active and role_at_task='doer';
  perform enqueue_notification_event(v_task.tenant_id,v_task.branch_id,v_task.department_id,'task_overdue','tasks',v_task.id,null,jsonb_build_object('task_title',v_task.title,'planned_datetime',coalesce(v_task.revised_datetime,v_task.planned_datetime),'priority',v_task.priority,'_assigned_user_ids',v_ids,'_task_creator_id',v_task.created_by,'_link_url','/tasks/'||v_task.task_type), 'task_overdue:'||v_task.id||':'||coalesce(v_task.revised_datetime,v_task.planned_datetime)::text,p_now);
  v_count_task:=v_count_task+1;
 end loop;
 for v_stage in select s.*,i.tenant_id,i.branch_id,i.department_id,i.started_by,i.reference_number,i.priority,f.name flow_name,d.name stage_name from fms_instance_stages s join fms_instances i on i.id=s.fms_instance_id join fms_stages d on d.id=s.fms_stage_id join fms_flows f on f.id=i.fms_flow_id where i.status in ('active','overdue') and s.status in ('pending','in_progress','in_review','overdue') and s.planned_datetime<p_now order by s.planned_datetime limit p_limit loop
  update fms_instance_stages set sla_breached=true,status=case when status='pending' then 'overdue'::task_status else status end where id=v_stage.id;
  perform enqueue_notification_event(v_stage.tenant_id,v_stage.branch_id,v_stage.department_id,'fms_sla_breached','fms',v_stage.id,null,jsonb_build_object('flow_name',v_stage.flow_name,'stage_name',v_stage.stage_name,'reference',v_stage.reference_number,'planned_datetime',v_stage.planned_datetime,'priority',v_stage.priority,'_assigned_user_ids',to_jsonb(v_stage.assigned_to),'_instance_starter_id',v_stage.started_by,'_link_url','/tasks/fms?instance='||v_stage.fms_instance_id),'fms_sla_breached:'||v_stage.id||':'||v_stage.planned_datetime::text,p_now);
  v_count_fms:=v_count_fms+1;
 end loop;
 return query select v_count_task,v_count_fms;
end $$;

-- --------------------------------------------------------------------------
-- Audited authenticated RPCs
-- --------------------------------------------------------------------------

create function assert_notification_admin()
returns user_profiles language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles;
begin select * into v_actor from current_profile(); if v_actor.id is null or not current_profile_is_active() or v_actor.user_role not in ('super_admin','admin') then raise exception 'Notification administration requires an active administrator' using errcode='42501'; end if; return v_actor; end $$;

create function save_notification_template(p_template_id uuid,p_name text,p_event_type text,p_channel text,p_title_template text,p_body_template text,p_link_url text default null,p_is_active boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles:=assert_notification_admin(); v_old notification_templates; v_id uuid;
begin
 if p_channel not in ('in_app','email','whatsapp','sms','push') or nullif(btrim(p_name),'') is null or length(p_name)>120 or not notification_link_is_safe(p_link_url) then raise exception 'Notification template input is invalid' using errcode='22023'; end if;
 perform validate_notification_template_text(p_event_type,p_title_template,p_body_template);
 if p_template_id is null then insert into notification_templates(tenant_id,event_type,channel,title_template,body_template,is_active,name,lifecycle,link_url,created_by,updated_by) values(v_actor.tenant_id,p_event_type,p_channel,btrim(p_title_template),btrim(p_body_template),p_is_active,btrim(p_name),'active',nullif(btrim(p_link_url),''),v_actor.id,v_actor.id) returning id into v_id;
 else select * into v_old from notification_templates where id=p_template_id for update; if v_old.tenant_id<>v_actor.tenant_id or v_old.lifecycle='archived' then raise exception 'Template cannot be edited' using errcode='42501'; end if; update notification_templates set event_type=p_event_type,channel=p_channel,title_template=btrim(p_title_template),body_template=btrim(p_body_template),is_active=p_is_active,name=btrim(p_name),link_url=nullif(btrim(p_link_url),''),updated_by=v_actor.id,updated_at=now() where id=p_template_id returning id into v_id; end if;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,case when p_template_id is null then 'notification_template_created' else 'notification_template_updated' end,'notification_templates',v_id,to_jsonb(v_old),(select to_jsonb(t) from notification_templates t where t.id=v_id)); return v_id;
end $$;

create function archive_notification_template(p_template_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles:=assert_notification_admin(); v_old notification_templates;
begin select * into v_old from notification_templates where id=p_template_id and tenant_id=v_actor.tenant_id for update; if v_old.id is null then raise exception 'Template is not available' using errcode='42501'; end if; if exists(select 1 from notification_rules r cross join lateral jsonb_each_text(r.channel_templates) ct where r.tenant_id=v_actor.tenant_id and r.lifecycle='active' and r.is_active and ct.value=p_template_id::text) then raise exception 'Active notification rules depend on this template' using errcode='23514'; end if; update notification_templates set lifecycle='archived',is_active=false,updated_by=v_actor.id,updated_at=now() where id=p_template_id; insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'notification_template_archived','notification_templates',p_template_id,to_jsonb(v_old),jsonb_build_object('lifecycle','archived')); end $$;

create function save_notification_rule(p_rule_id uuid,p_name text,p_event_type text,p_conditions jsonb,p_recipient_rules jsonb,p_channel_templates jsonb,p_delay_minutes integer default 0,p_cooldown_minutes integer default 0,p_max_attempts integer default 3,p_backoff_minutes integer default 5,p_priority task_priority default 'medium',p_is_enabled boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles:=assert_notification_admin(); v_old notification_rules; v_id uuid; v_item jsonb; v_channel text; v_template_id uuid; v_allowed text[]:=notification_event_variables(p_event_type); v_recipient_type text;
begin
 if nullif(btrim(p_name),'') is null or length(p_name)>120 or jsonb_typeof(p_conditions)<>'array' or jsonb_typeof(p_recipient_rules)<>'array' or jsonb_array_length(p_recipient_rules)=0 or jsonb_typeof(p_channel_templates)<>'object' or p_channel_templates='{}'::jsonb or p_delay_minutes not between 0 and 43200 or p_cooldown_minutes not between 0 and 525600 or p_max_attempts not between 1 and 10 or p_backoff_minutes not between 1 and 1440 then raise exception 'Notification rule input is invalid' using errcode='22023'; end if;
 for v_item in select value from jsonb_array_elements(p_conditions) loop if not (v_item->>'field')=any(v_allowed) or (v_item->>'operator') not in ('equals','not_equals','contains','greater_than','greater_than_or_equal','less_than','less_than_or_equal','is_empty','is_not_empty','is_today','is_past','is_future') then raise exception 'Notification condition is invalid' using errcode='22023'; end if; end loop;
 for v_item in select value from jsonb_array_elements(p_recipient_rules) loop v_recipient_type:=v_item->>'type'; if v_recipient_type not in ('assigned_users','task_creator','instance_starter','form_submitter','reviewer','actor','branch_manager','department_head','manager','specified_users','specified_role') then raise exception 'Recipient rule is invalid' using errcode='22023'; end if; if v_recipient_type='specified_users' and (jsonb_typeof(v_item->'user_ids')<>'array' or exists(select 1 from jsonb_array_elements_text(v_item->'user_ids') uid left join user_profiles up on up.id=uid::uuid and up.tenant_id=v_actor.tenant_id and up.working_status not in ('inactive','resigned') and up.is_login_enabled where up.id is null)) then raise exception 'Specified recipients are outside the active tenant scope' using errcode='22023'; end if; if v_recipient_type='specified_role' and (v_item->>'role') not in ('super_admin','admin','manager','hr','crm','staff','doer','housekeeping') then raise exception 'Specified role is invalid' using errcode='22023'; end if; end loop;
 for v_channel in select jsonb_object_keys(p_channel_templates) loop if v_channel not in ('in_app','email','whatsapp','sms','push') then raise exception 'Notification channel is invalid' using errcode='22023'; end if; begin v_template_id:=(p_channel_templates->>v_channel)::uuid; exception when others then raise exception 'Template mapping is invalid' using errcode='22023'; end; if not exists(select 1 from notification_templates where id=v_template_id and tenant_id=v_actor.tenant_id and lifecycle='active' and is_active and event_type=p_event_type and channel=v_channel) then raise exception 'Template mapping does not match event and channel' using errcode='23514'; end if; end loop;
 if p_rule_id is null then insert into notification_rules(tenant_id,event_type,conditions,channels,template_id,is_active,name,recipient_rules,channel_templates,delay_minutes,cooldown_minutes,max_attempts,backoff_minutes,priority,lifecycle,created_by,updated_by) values(v_actor.tenant_id,p_event_type,p_conditions,array(select jsonb_object_keys(p_channel_templates)),null,p_is_enabled,btrim(p_name),p_recipient_rules,p_channel_templates,p_delay_minutes,p_cooldown_minutes,p_max_attempts,p_backoff_minutes,p_priority,'active',v_actor.id,v_actor.id) returning id into v_id;
 else select * into v_old from notification_rules where id=p_rule_id for update; if v_old.tenant_id<>v_actor.tenant_id or v_old.lifecycle='archived' then raise exception 'Rule cannot be edited' using errcode='42501'; end if; update notification_rules set event_type=p_event_type,conditions=p_conditions,channels=array(select jsonb_object_keys(p_channel_templates)),template_id=null,is_active=p_is_enabled,name=btrim(p_name),recipient_rules=p_recipient_rules,channel_templates=p_channel_templates,delay_minutes=p_delay_minutes,cooldown_minutes=p_cooldown_minutes,max_attempts=p_max_attempts,backoff_minutes=p_backoff_minutes,priority=p_priority,updated_by=v_actor.id,updated_at=now() where id=p_rule_id returning id into v_id; end if;
 insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,case when p_rule_id is null then 'notification_rule_created' else 'notification_rule_updated' end,'notification_rules',v_id,to_jsonb(v_old),(select to_jsonb(r) from notification_rules r where r.id=v_id)); return v_id;
end $$;

create function set_notification_rule_enabled(p_rule_id uuid,p_enabled boolean)
returns void language plpgsql security definer set search_path=public as $$ declare v_actor user_profiles:=assert_notification_admin(); v_old notification_rules; begin select * into v_old from notification_rules where id=p_rule_id and tenant_id=v_actor.tenant_id for update; if v_old.id is null or v_old.lifecycle='archived' then raise exception 'Rule is not available' using errcode='42501'; end if; update notification_rules set is_active=p_enabled,updated_by=v_actor.id,updated_at=now() where id=p_rule_id; insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'notification_rule_enabled_changed','notification_rules',p_rule_id,to_jsonb(v_old),jsonb_build_object('is_active',p_enabled)); end $$;

create function archive_notification_rule(p_rule_id uuid)
returns void language plpgsql security definer set search_path=public as $$ declare v_actor user_profiles:=assert_notification_admin(); v_old notification_rules; begin select * into v_old from notification_rules where id=p_rule_id and tenant_id=v_actor.tenant_id for update; if v_old.id is null then raise exception 'Rule is not available' using errcode='42501'; end if; update notification_rules set lifecycle='archived',is_active=false,updated_by=v_actor.id,updated_at=now() where id=p_rule_id; insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'notification_rule_archived','notification_rules',p_rule_id,to_jsonb(v_old),jsonb_build_object('lifecycle','archived')); end $$;

create function mark_notification_read(p_notification_id uuid,p_is_read boolean default true)
returns void language plpgsql security definer set search_path=public as $$ declare v_actor user_profiles; begin select * into v_actor from current_profile(); if v_actor.id is null or not current_profile_is_active() then raise exception 'Notification update denied' using errcode='42501'; end if; update notifications set is_read=p_is_read,read_at=case when p_is_read then now() else null end where id=p_notification_id and tenant_id=v_actor.tenant_id and user_profile_id=v_actor.id; if not found then raise exception 'Notification is not owned by the current user' using errcode='42501'; end if; end $$;

create function mark_all_notifications_read()
returns integer language plpgsql security definer set search_path=public as $$ declare v_actor user_profiles; v_count integer; begin select * into v_actor from current_profile(); if v_actor.id is null or not current_profile_is_active() then raise exception 'Notification update denied' using errcode='42501'; end if; update notifications set is_read=true,read_at=now() where tenant_id=v_actor.tenant_id and user_profile_id=v_actor.id and not is_read; get diagnostics v_count=row_count; return v_count; end $$;

create function retry_notification_delivery(p_delivery_id uuid)
returns void language plpgsql security definer set search_path=public as $$ declare v_actor user_profiles:=assert_notification_admin(); v_old notification_deliveries; begin select * into v_old from notification_deliveries where id=p_delivery_id and tenant_id=v_actor.tenant_id for update; if v_old.id is null or v_old.state not in ('failed_terminal','blocked_configuration') then raise exception 'Delivery is not eligible for manual retry' using errcode='23514'; end if; update notification_deliveries set state='pending',next_attempt_at=now(),max_attempts=greatest(max_attempts,attempt_count+1),processing_started_at=null,lease_expires_at=null,worker_id=null,error_category=null,updated_at=now() where id=p_delivery_id; insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value) values(v_actor.tenant_id,v_actor.id,'notification_delivery_manual_retry','notification_deliveries',p_delivery_id,jsonb_build_object('state',v_old.state,'attempt_count',v_old.attempt_count),jsonb_build_object('state','pending')); end $$;

create function get_notification_provider_availability()
returns table(channel text,is_available boolean,provider_identifier text,status_reason text)
language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles:=assert_notification_admin();
begin return query
 select 'in_app'::text,true,'jewelos_in_app'::text,'Available'::text
 union all
 select c.channel,coalesce(cfg.is_available,false),cfg.provider_identifier,case when coalesce(cfg.is_available,false) then 'Available' else 'Provider not configured' end
 from (values('email'),('whatsapp'),('sms'),('push')) c(channel)
 left join notification_provider_configuration cfg on cfg.tenant_id=v_actor.tenant_id and cfg.channel=c.channel;
end $$;

create function list_notification_delivery_logs(p_state text default null,p_channel text default null,p_event_type text default null,p_search text default null,p_from timestamptz default null,p_to timestamptz default null,p_limit integer default 100,p_offset integer default 0)
returns table(delivery_id uuid,state text,channel text,event_type text,recipient_label text,attempt_count integer,max_attempts integer,error_category text,scheduled_at timestamptz,delivered_at timestamptz,created_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles:=assert_notification_admin();
begin if p_limit not between 1 and 200 or p_offset<0 then raise exception 'Delivery log page is invalid' using errcode='22023'; end if; return query
 select d.id,d.state,d.channel,e.event_type,'Employee ••••'||right(d.recipient_profile_id::text,4),d.attempt_count,d.max_attempts,d.error_category,d.scheduled_at,d.delivered_at,d.created_at
 from notification_deliveries d join notification_events e on e.id=d.event_id
 where d.tenant_id=v_actor.tenant_id and (p_state is null or d.state=p_state) and (p_channel is null or d.channel=p_channel) and (p_event_type is null or e.event_type=p_event_type) and (p_from is null or d.created_at>=p_from) and (p_to is null or d.created_at<=p_to) and (nullif(btrim(p_search),'') is null or d.id::text ilike '%'||btrim(p_search)||'%' or e.event_type ilike '%'||btrim(p_search)||'%')
 order by d.created_at desc limit p_limit offset p_offset;
end $$;

-- --------------------------------------------------------------------------
-- Transactional integrations and legacy convergence
-- --------------------------------------------------------------------------

create function emit_task_notification_event() returns trigger language plpgsql security definer set search_path=public as $$
declare v_task task_instances; v_actor user_profiles; v_assignee user_profiles; v_type text;
begin select * into v_task from task_instances where id=new.task_instance_id; select * into v_actor from current_profile(); select * into v_assignee from user_profiles where id=new.user_profile_id; v_type:=case when new.is_original then 'task_assigned' else 'task_delegated' end; perform enqueue_notification_event(v_task.tenant_id,v_task.branch_id,v_task.department_id,v_type,'tasks',v_task.id,v_actor.id,jsonb_build_object('actor_name',coalesce(v_actor.employee_name,'System'),'assignee_name',v_assignee.employee_name,'task_title',v_task.title,'planned_datetime',coalesce(v_task.revised_datetime,v_task.planned_datetime),'priority',v_task.priority,'reason',case when new.is_original then null else 'Task reassigned' end,'_assigned_user_ids',jsonb_build_array(new.user_profile_id),'_task_creator_id',v_task.created_by,'_link_url',case when v_task.task_type='delegation' then '/tasks/delegation' else '/tasks/checklist' end),v_type||':assignment:'||new.id,now()); return new; end $$;
create trigger task_assignment_notification_event after insert on task_assignees for each row when (new.is_active and new.role_at_task='doer') execute function emit_task_notification_event();

create function emit_task_completion_notification_event() returns trigger language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles;
begin if old.status is distinct from new.status and new.status='completed' then select * into v_actor from current_profile(); perform enqueue_notification_event(new.tenant_id,new.branch_id,new.department_id,'task_completed','tasks',new.id,coalesce(new.updated_by,v_actor.id),jsonb_build_object('actor_name',coalesce(v_actor.employee_name,'System'),'task_title',new.title,'completed_at',coalesce(new.actual_datetime,now()),'priority',new.priority,'_task_creator_id',new.created_by,'_link_url',case when new.task_type='delegation' then '/tasks/delegation' else '/tasks/checklist' end),'task_completed:'||new.id||':'||coalesce(new.actual_datetime,now())::text,coalesce(new.actual_datetime,now())); end if; return new; end $$;
create trigger task_completion_notification_event after update on task_instances for each row execute function emit_task_completion_notification_event();

create function emit_form_notification_event() returns trigger language plpgsql security definer set search_path=public as $$
declare v_template form_templates; v_actor user_profiles; v_type text;
begin select * into v_template from form_templates where id=new.form_template_id; select * into v_actor from user_profiles where id=coalesce(new.reviewed_by,new.submitted_by); if tg_op='INSERT' then v_type:='form_submitted'; elsif old.status is not distinct from new.status then return new; elsif new.status='approved' then v_type:='form_approved'; elsif new.status='rejected' then v_type:='form_rejected'; else return new; end if; perform enqueue_notification_event(new.tenant_id,new.branch_id,new.department_id,v_type,'forms',new.id,coalesce(new.reviewed_by,new.submitted_by),jsonb_build_object('actor_name',coalesce(v_actor.employee_name,'System'),'form_name',v_template.name,'submitted_at',new.submitted_at,'reviewed_at',new.reviewed_at,'review_notes',coalesce(new.review_notes,''),'_form_submitter_id',new.submitted_by,'_reviewer_id',new.reviewed_by,'_link_url','/forms'),v_type||':'||new.id||':'||coalesce(new.reviewed_at,new.submitted_at)::text,coalesce(new.reviewed_at,new.submitted_at)); return new; end $$;
create trigger form_submission_notification_event after insert or update of status on form_submissions for each row execute function emit_form_notification_event();

create function emit_fms_stage_assignment_event() returns trigger language plpgsql security definer set search_path=public as $$
declare v_i fms_instances; v_d fms_stages; v_f fms_flows; v_actor user_profiles; v_names text;
begin if cardinality(new.assigned_to)=0 then return new; end if; select * into v_i from fms_instances where id=new.fms_instance_id; select * into v_d from fms_stages where id=new.fms_stage_id; select * into v_f from fms_flows where id=v_i.fms_flow_id; select * into v_actor from user_profiles where id=v_i.started_by; select string_agg(employee_name,', ' order by employee_name) into v_names from user_profiles where id=any(new.assigned_to); perform enqueue_notification_event(v_i.tenant_id,v_i.branch_id,v_i.department_id,'fms_stage_assigned','fms',new.id,v_i.started_by,jsonb_build_object('actor_name',coalesce(v_actor.employee_name,'System'),'assignee_name',v_names,'flow_name',v_f.name,'stage_name',v_d.name,'reference',v_i.reference_number,'planned_datetime',coalesce(new.planned_datetime,now()),'priority',v_i.priority,'_assigned_user_ids',to_jsonb(new.assigned_to),'_instance_starter_id',v_i.started_by,'_link_url','/tasks/fms?instance='||v_i.id),'fms_stage_assigned:'||new.id,coalesce(new.activated_at,now())); return new; end $$;
create trigger fms_stage_assignment_notification_event after insert on fms_instance_stages for each row execute function emit_fms_stage_assignment_event();

create function emit_fms_stage_completion_event() returns trigger language plpgsql security definer set search_path=public as $$
declare v_i fms_instances; v_d fms_stages; v_f fms_flows; v_actor user_profiles; v_type text;
begin if old.status is distinct from new.status and new.status='completed' then select * into v_i from fms_instances where id=new.fms_instance_id; select * into v_d from fms_stages where id=new.fms_stage_id; select * into v_f from fms_flows where id=v_i.fms_flow_id; select * into v_actor from user_profiles where id=new.completed_by; v_type:=case when new.outcome='rejected' then 'fms_stage_rejected' when new.outcome='revision_requested' then 'fms_revision_requested' else 'fms_stage_completed' end; perform enqueue_notification_event(v_i.tenant_id,v_i.branch_id,v_i.department_id,v_type,'fms',new.id,new.completed_by,jsonb_build_object('actor_name',coalesce(v_actor.employee_name,'System'),'flow_name',v_f.name,'stage_name',v_d.name,'reference',v_i.reference_number,'completed_at',coalesce(new.actual_datetime,now()),'reason',coalesce(new.remark,''),'priority',v_i.priority,'_assigned_user_ids',to_jsonb(new.assigned_to),'_instance_starter_id',v_i.started_by,'_link_url','/tasks/fms?instance='||v_i.id),v_type||':'||new.id||':'||coalesce(new.actual_datetime,now())::text,coalesce(new.actual_datetime,now())); end if; return new; end $$;
create trigger fms_stage_completion_notification_event after update of status on fms_instance_stages for each row execute function emit_fms_stage_completion_event();

create function emit_fms_completion_event() returns trigger language plpgsql security definer set search_path=public as $$
declare v_f fms_flows; v_actor user_profiles;
begin if old.status is distinct from new.status and new.status='completed' then select * into v_f from fms_flows where id=new.fms_flow_id; select * into v_actor from current_profile(); perform enqueue_notification_event(new.tenant_id,new.branch_id,new.department_id,'fms_completed','fms',new.id,v_actor.id,jsonb_build_object('actor_name',coalesce(v_actor.employee_name,'System'),'flow_name',v_f.name,'reference',new.reference_number,'completed_at',coalesce(new.completed_at,now()),'priority',new.priority,'_instance_starter_id',new.started_by,'_link_url','/tasks/fms?instance='||new.id),'fms_completed:'||new.id||':'||coalesce(new.completed_at,now())::text,coalesce(new.completed_at,now())); end if; return new; end $$;
create trigger fms_completion_notification_event after update of status on fms_instances for each row execute function emit_fms_completion_event();

create function emit_operational_audit_notification_event() returns trigger language plpgsql security definer set search_path=public as $$
declare v_task task_instances; v_i fms_instances; v_s fms_instance_stages; v_d fms_stages; v_f fms_flows; v_ids jsonb;
begin
 if new.action='task_coverage_escalated' and new.module='tasks' then select * into v_task from task_instances where id=new.record_id; v_ids:=coalesce(new.new_value->'notified_user_ids','[]'); perform enqueue_notification_event(new.tenant_id,v_task.branch_id,v_task.department_id,'task_coverage_required','tasks',v_task.id,new.actor_user_id,jsonb_build_object('task_title',v_task.title,'planned_datetime',v_task.planned_datetime,'priority',v_task.priority,'reason','No active doer or buddy was available','_assigned_user_ids',v_ids,'_link_url','/tasks/checklist'),'task_coverage_required:'||v_task.id,new.created_at);
 elsif new.action='fms_stage_escalated' and new.module='fms_instance_stages' then select * into v_s from fms_instance_stages where id=new.record_id; select * into v_i from fms_instances where id=v_s.fms_instance_id; select * into v_d from fms_stages where id=v_s.fms_stage_id; select * into v_f from fms_flows where id=v_i.fms_flow_id; perform enqueue_notification_event(new.tenant_id,v_i.branch_id,v_i.department_id,'fms_stage_escalated','fms',v_s.id,new.actor_user_id,jsonb_build_object('actor_name','JewelOS user','flow_name',v_f.name,'stage_name',v_d.name,'reference',v_i.reference_number,'reason',coalesce(new.new_value->>'reason','Escalated'),'priority',v_i.priority,'_assigned_user_ids',jsonb_build_array(new.new_value->>'recipient'),'_instance_starter_id',v_i.started_by,'_link_url','/tasks/fms?instance='||v_i.id),'fms_stage_escalated:'||v_s.id||':'||new.id,new.created_at);
 end if; return new;
end $$;
create trigger operational_audit_notification_event after insert on audit_logs for each row when (new.action in ('task_coverage_escalated','fms_stage_escalated')) execute function emit_operational_audit_notification_event();

create function converge_legacy_notification_insert() returns trigger language plpgsql security definer set search_path=public as $$
declare v_source uuid;
begin
 if new.event_type in ('manager_approval_required','task_coverage_required','fms_stage_escalated') then return null; end if;
 if new.event_type='fms_stage_notification' then begin v_source:=substring(new.link_url from 'instance=([0-9a-f-]{36})')::uuid; exception when others then v_source:=new.id; end; perform enqueue_notification_event(new.tenant_id,new.branch_id,new.department_id,'system_alert','fms',v_source,null,jsonb_build_object('alert_title',new.title,'alert_message',new.message,'priority',coalesce(new.priority,'medium'),'_assigned_user_ids',jsonb_build_array(new.user_profile_id),'_link_url',new.link_url),'system_alert:legacy:'||v_source||':'||new.user_profile_id,coalesce(new.created_at,now())); return null; end if;
 return new;
end $$;
create trigger converge_legacy_notification_before_insert before insert on notifications for each row execute function converge_legacy_notification_insert();

-- --------------------------------------------------------------------------
-- Default in-app behavior for every current and future tenant
-- --------------------------------------------------------------------------

create function seed_default_notification_rules(p_tenant_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_event text; v_title text; v_body text; v_recipients jsonb; v_template uuid;
begin
 for v_event,v_title,v_body,v_recipients in values
 ('task_assigned','New task: {{task_title}}','{{assignee_name}}, a {{priority}} task is planned for {{planned_datetime}}.','[{"type":"assigned_users"}]'::jsonb),
 ('task_delegated','Task delegated: {{task_title}}','{{assignee_name}}, {{actor_name}} delegated this task to you. Reason: {{reason}}.','[{"type":"assigned_users"}]'::jsonb),
 ('task_completed','Task completed: {{task_title}}','{{actor_name}} completed this {{priority}} task at {{completed_at}}.','[{"type":"task_creator"}]'::jsonb),
 ('task_overdue','Overdue task: {{task_title}}','{{assignee_name}}, this {{priority}} task was due at {{planned_datetime}}.','[{"type":"assigned_users"}]'::jsonb),
 ('task_coverage_required','Task blocked for coverage: {{task_title}}','{{reason}} Planned time: {{planned_datetime}}.','[{"type":"assigned_users"},{"type":"branch_manager"},{"type":"department_head"}]'::jsonb),
 ('form_submitted','Form submitted: {{form_name}}','{{actor_name}} submitted this form at {{submitted_at}}.','[{"type":"branch_manager"}]'::jsonb),
 ('form_approved','Form approved: {{form_name}}','{{actor_name}} approved this form at {{reviewed_at}}.','[{"type":"form_submitter"}]'::jsonb),
 ('form_rejected','Form rejected: {{form_name}}','{{actor_name}} rejected this form at {{reviewed_at}}.','[{"type":"form_submitter"}]'::jsonb),
 ('fms_stage_assigned','FMS stage assigned: {{stage_name}}','{{assignee_name}}, {{flow_name}} ({{reference}}) is assigned to you.','[{"type":"assigned_users"}]'::jsonb),
 ('fms_stage_completed','FMS stage completed: {{stage_name}}','{{actor_name}} completed {{flow_name}} / {{stage_name}} ({{reference}}).','[{"type":"instance_starter"}]'::jsonb),
 ('fms_stage_rejected','FMS stage rejected: {{stage_name}}','{{actor_name}} rejected {{flow_name}} / {{stage_name}}. {{reason}}','[{"type":"assigned_users"},{"type":"instance_starter"}]'::jsonb),
 ('fms_revision_requested','FMS revision requested: {{stage_name}}','{{actor_name}} requested a revision for {{flow_name}}. {{reason}}','[{"type":"assigned_users"},{"type":"instance_starter"}]'::jsonb),
 ('fms_stage_escalated','FMS stage escalated: {{stage_name}}','{{flow_name}} ({{reference}}) was escalated. {{reason}}','[{"type":"assigned_users"},{"type":"branch_manager"}]'::jsonb),
 ('fms_sla_breached','FMS SLA breached: {{stage_name}}','{{flow_name}} ({{reference}}) was due at {{planned_datetime}}.','[{"type":"assigned_users"},{"type":"branch_manager"}]'::jsonb),
 ('fms_completed','FMS completed: {{flow_name}}','{{flow_name}} ({{reference}}) completed at {{completed_at}}.','[{"type":"instance_starter"}]'::jsonb),
 ('system_alert','{{alert_title}}','{{alert_message}}','[{"type":"assigned_users"}]'::jsonb)
 loop
  insert into notification_templates(tenant_id,event_type,channel,title_template,body_template,is_active,name,lifecycle)
  values(p_tenant_id,v_event,'in_app',v_title,v_body,true,'Default '||replace(v_event,'_',' '),'active') returning id into v_template;
  insert into notification_rules(tenant_id,event_type,conditions,channels,is_active,name,recipient_rules,channel_templates,delay_minutes,cooldown_minutes,max_attempts,backoff_minutes,priority,lifecycle)
  values(p_tenant_id,v_event,'[]',array['in_app'],true,'Default '||replace(v_event,'_',' '),v_recipients,jsonb_build_object('in_app',v_template),0,0,3,5,case when v_event in ('task_overdue','task_coverage_required','fms_stage_escalated','fms_sla_breached') then 'high'::task_priority else 'medium'::task_priority end,'active');
 end loop;
end $$;

do $$ declare v_tenant uuid; begin for v_tenant in select id from tenants loop if not exists(select 1 from notification_rules where tenant_id=v_tenant) then perform seed_default_notification_rules(v_tenant); end if; end loop; end $$;
create function seed_notification_rules_for_new_tenant() returns trigger language plpgsql security definer set search_path=public as $$ begin perform seed_default_notification_rules(new.id); return new; end $$;
create trigger tenant_default_notification_rules after insert on tenants for each row execute function seed_notification_rules_for_new_tenant();

-- --------------------------------------------------------------------------
-- RLS and exact grants
-- --------------------------------------------------------------------------

alter table notification_events enable row level security;
alter table notification_deliveries enable row level security;
alter table notification_provider_configuration enable row level security;
alter table notification_logs enable row level security;
alter table notification_templates enable row level security;
alter table notification_rules enable row level security;
alter table notifications enable row level security;

drop policy if exists notification_templates_select on notification_templates;
create policy notification_templates_select on notification_templates for select to authenticated using((select current_profile_is_active()) and tenant_id=(select current_tenant_id()) and (select current_role_level()) in ('super_admin','admin'));
drop policy if exists notification_rules_select on notification_rules;
create policy notification_rules_select on notification_rules for select to authenticated using(
  (select current_profile_is_active())
  and tenant_id=(select current_tenant_id())
  and (select current_role_level()) in ('super_admin','admin')
  and (template_id is null or exists(select 1 from notification_templates t where t.id=template_id and t.tenant_id=notification_rules.tenant_id))
  and not exists(
    select 1 from jsonb_each_text(channel_templates) mapped
    left join notification_templates t on t.id=mapped.value::uuid and t.tenant_id=notification_rules.tenant_id
    where t.id is null
  )
);
drop policy if exists notifications_select on notifications;
create policy notifications_select on notifications for select to authenticated using((select current_profile_is_active()) and tenant_id=(select current_tenant_id()) and user_profile_id=(select (current_profile()).id));

revoke all privileges on table notification_events,notification_deliveries,notification_logs,notification_provider_configuration from public,anon,authenticated,service_role;
revoke insert,update,delete,truncate,references,trigger on table notification_templates,notification_rules,notifications from public,anon,authenticated,service_role;
grant select on table notification_templates,notification_rules,notifications to authenticated;

do $$ declare v_fn record; begin for v_fn in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
 'notification_event_variables','notification_link_is_safe','validate_notification_template_text','render_notification_template','notification_condition_matches','notification_rule_matches','resolve_notification_recipients','enqueue_notification_event','process_notification_events','claim_notification_deliveries','finish_notification_delivery','detect_scheduled_notification_events','assert_notification_admin','save_notification_template','archive_notification_template','save_notification_rule','set_notification_rule_enabled','archive_notification_rule','mark_notification_read','mark_all_notifications_read','retry_notification_delivery','get_notification_provider_availability','list_notification_delivery_logs','emit_task_notification_event','emit_task_completion_notification_event','emit_form_notification_event','emit_fms_stage_assignment_event','emit_fms_stage_completion_event','emit_fms_completion_event','emit_operational_audit_notification_event','converge_legacy_notification_insert','seed_default_notification_rules','seed_notification_rules_for_new_tenant'
 ) loop execute format('revoke all privileges on function %s from public,anon,authenticated,service_role',v_fn.identity); end loop; end $$;

grant execute on function save_notification_template(uuid,text,text,text,text,text,text,boolean),archive_notification_template(uuid),save_notification_rule(uuid,text,text,jsonb,jsonb,jsonb,integer,integer,integer,integer,task_priority,boolean),set_notification_rule_enabled(uuid,boolean),archive_notification_rule(uuid),mark_notification_read(uuid,boolean),mark_all_notifications_read(),retry_notification_delivery(uuid),get_notification_provider_availability(),list_notification_delivery_logs(text,text,text,text,timestamptz,timestamptz,integer,integer) to authenticated;
grant execute on function process_notification_events(integer),claim_notification_deliveries(integer,uuid,integer),finish_notification_delivery(uuid,text,text,text,boolean),detect_scheduled_notification_events(integer,timestamptz) to service_role;

notify pgrst, 'reload schema';
