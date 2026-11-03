-- FMS start modes and automatic start triggers (owner request 2026-11-03).
-- Design: docs/superpowers/specs/2026-11-03-fms-start-triggers-design.md
--
-- A workflow no longer has to begin with a starting form. Each workflow version now has a start
-- mode, frozen with the version once it is published:
--   form       the existing behaviour, unchanged; every existing version keeps it (column default).
--   automatic  a saved submission starts a run when the version's conditions match: a Forms Library
--              form, a CRM walk-in visit, a CRM queue registration, a CRM lead, or a CRM form built
--              in the Form Builder. Nobody fills a starting form.
--   manual     an authorized person starts a run from the FMS list without an intake form.
--
-- The trigger is configuration (fms_flows.start_trigger), never a stage: no hidden Form step, no
-- dummy completed visit. The first real step (Task, Form, Approval, Decision, Notification or
-- Parallel) is activated by the existing engine with its own published assignment and timing.
--
-- Event engine. Every source event is stored once, immutably (fms_trigger_events, unique per
-- tenant and event key), and evaluated per matching published version (fms_trigger_evaluations,
-- unique per event and version). A started run records its source (fms_instance_trigger_sources);
-- partial unique indexes allow at most one run per event and workflow family, and, by default, one
-- open run per case (CRM Not Bought follow-up case, else CRM client, else the record). A retry,
-- a replayed delivery or two concurrent deliveries therefore never start a second run.
--   * Forms Library: an AFTER trigger on form_submissions captures a submitted row in the same
--     transaction, so a failed or rolled-back submission never triggers. Processing errors are
--     caught and kept as a failed event; they never fail the submission itself.
--   * CRM: the CRM project writes an immutable snapshot to its own outbox when the original save
--     commits (CRM migration 20261103000200); sync-deliver sends it to crm-sync-receive, which calls
--     crm_sync_apply_submission_event (service role only). crm_sync.inbox deduplicates deliveries.
--   * Conditions are evaluated only here (fms_trigger_node_eval). @jewelos/core startTrigger.ts
--     mirrors the rules for the builder's test panel and keeps the same cases in its tests.
--
-- Existing paths are guarded rather than rewritten: a BEFORE INSERT trigger on fms_instances only
-- lets an automatic or manual version start through its own path, so the form-start functions
-- (unchanged) cannot start them. Function bodies patched by marker stop the migration on drift.
set search_path=public,extensions;

-- ---------------------------------------------------------------------------------------------
-- 1. Start configuration on each workflow version.
-- ---------------------------------------------------------------------------------------------
alter table fms_flows
  add column start_mode text not null default 'form' check (start_mode in ('form','automatic','manual')),
  add column start_trigger jsonb check (start_trigger is null or (jsonb_typeof(start_trigger)='object' and pg_column_size(start_trigger)<=65536));
alter table fms_flows add constraint fms_flows_start_trigger_matches_mode check ((start_mode='automatic')=(start_trigger is not null));

create function fms_flows_start_frozen() returns trigger
language plpgsql set search_path=public as $$
begin
  if old.status<>'draft' and (new.start_mode is distinct from old.start_mode or new.start_trigger is distinct from old.start_trigger) then
    raise exception 'A published workflow version keeps its start settings. Create a revision to change them' using errcode='42501';
  end if;
  return new;
end $$;
create trigger fms_flows_start_frozen before update of start_mode,start_trigger on fms_flows
  for each row execute function fms_flows_start_frozen();

-- Only the path a version was built for may start it. Form versions are unaffected.
create function fms_instance_start_path_guard() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_mode text;
begin
  select start_mode into v_mode from fms_flows where id=new.fms_flow_id;
  if coalesce(v_mode,'form')='form' or new.parent_instance_id is not null then return new; end if;
  if coalesce(current_setting('jewelos.fms_start_path',true),'')<>v_mode then
    raise exception '%',case v_mode when 'automatic' then 'This workflow starts automatically from its configured source'
      else 'This workflow is started from the FMS list without a form' end using errcode='42501';
  end if;
  return new;
end $$;
create trigger fms_instance_start_path_guard before insert on fms_instances
  for each row execute function fms_instance_start_path_guard();

-- Automatic versions are never started by hand; form starters list form versions only.
create or replace function can_start_fms_flow(p_flow_id uuid,p_branch_id uuid,p_department_id uuid) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(
    select 1
    from fms_flows f
    join user_profiles actor on actor.auth_user_id=auth.uid()
    where f.id=p_flow_id
      and f.tenant_id=actor.tenant_id
      and f.status='published'
      and f.is_active
      and f.start_mode in ('form','manual')
      and actor.working_status not in ('inactive','resigned')
      and actor.is_login_enabled
      and actor.user_role in ('super_admin','admin','manager','crm','staff')
      and (
        actor.user_role in ('super_admin','admin')
        or (
          p_branch_id=actor.branch_id
          and (f.branch_id is null or f.branch_id=p_branch_id)
          and (f.department_id is null or f.department_id=p_department_id)
          and (actor.user_role not in ('crm','staff') or p_department_id=actor.department_id)
        )
      )
  )
$$;

create or replace function list_fms_form_starters(p_form_template_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile(); result jsonb;
begin
  perform assert_module_enabled('fms_builder');
  if a.id is null or not current_profile_is_active() then raise exception 'An active profile is required to open workflow forms' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('flowId',f.id,'name',f.name,'version',f.version,'formTemplateId',first_stage.form_template_id) order by f.name,f.version),'[]') into result
  from fms_flows f join lateral (select form_template_id from fms_stages where fms_flow_id=f.id order by sort_order,id limit 1) first_stage on true
  where f.tenant_id=a.tenant_id and f.status='published' and f.is_active and f.start_mode='form' and first_stage.form_template_id=p_form_template_id
    and can_start_fms_flow(f.id,coalesce(f.branch_id,a.branch_id),coalesce(f.department_id,a.department_id));
  return result;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 2. Marker-checked patches: the first step is special only for form versions.
-- ---------------------------------------------------------------------------------------------
do $patch$
declare body text; needle text;
begin
  -- Publishing: a starting Form is required only in form mode.
  body:=replace(pg_get_functiondef('public.assert_fms_flow_publishable_before_assignment(uuid)'::regprocedure),E'\r','');
  needle:='  if (select step_type from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1)<>''form'' then';
  if strpos(body,needle)=0 then raise exception 'Unrecognized first-step publish contract'; end if;
  body:=replace(body,needle,'  if v_flow.start_mode=''form'' and (select step_type from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1)<>''form'' then');
  needle:='  if (select form_template_id from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1) is null then';
  if strpos(body,needle)=0 then raise exception 'Unrecognized starting-form publish contract'; end if;
  body:=replace(body,needle,'  if v_flow.start_mode=''form'' and (select form_template_id from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1) is null then');
  needle:='or s.id=(select first_stage.id from fms_stages first_stage where first_stage.fms_flow_id=p_flow_id order by first_stage.sort_order,first_stage.id limit 1))';
  if strpos(body,needle)=0 then raise exception 'Unrecognized first-step decision contract'; end if;
  body:=replace(body,needle,'or v_flow.start_mode=''form'' and s.id=(select first_stage.id from fms_stages first_stage where first_stage.fms_flow_id=p_flow_id order by first_stage.sort_order,first_stage.id limit 1))');
  execute body;

  -- Publishing: without a starting form, the first step needs its own assignment strategy.
  body:=replace(pg_get_functiondef('public.assert_fms_assignment_publishable_before_display(uuid)'::regprocedure),E'\r','');
  needle:='or (s.id=(select id from fms_stages where fms_flow_id=f.id order by sort_order,id limit 1)';
  if strpos(body,needle)=0 then raise exception 'Unrecognized first-step assignment publish contract'; end if;
  body:=replace(body,needle,'or (f.start_mode=''form'' and s.id=(select id from fms_stages where fms_flow_id=f.id order by sort_order,id limit 1)');
  execute body;

  -- Runtime: the first step goes to the form submitter only in form mode. An automatic run may
  -- name its first assignee (the source salesperson); otherwise the step's own strategy decides.
  body:=replace(pg_get_functiondef('public.resolve_fms_visit_assignment(uuid,uuid,uuid,uuid,jsonb,uuid,uuid[],text)'::regprocedure),E'\r','');
  needle:='if target.id=initial_id and prior.id is null then chosen:=i.started_by; method:=''initial_submitter'';';
  if strpos(body,needle)=0 then raise exception 'Unrecognized initial assignment contract'; end if;
  body:=replace(body,needle,
    'if target.id=initial_id and prior.id is null and coalesce((select flow.start_mode from fms_flows flow where flow.id=i.fms_flow_id),''form'')=''form'' then chosen:=i.started_by; method:=''initial_submitter'';'
    ||E'\n  elsif target.id=initial_id and prior.id is null and coalesce(current_setting(''jewelos.fms_start_assignee'',true),'''')<>'''' then chosen:=current_setting(''jewelos.fms_start_assignee'',true)::uuid; method:=''trigger_source'';');
  execute body;
end $patch$;

-- ---------------------------------------------------------------------------------------------
-- 3. Source catalog and condition evaluation (mirrored by @jewelos/core startTrigger.ts).
-- ---------------------------------------------------------------------------------------------
create function fms_trigger_source_catalog() returns table(source_type text,field_key text,field_type text,options text[])
language sql immutable set search_path=public as $$
  values
    ('crm_walkin','visit_status','choice',array['NO','YES','YES_AND_ORDER_PLACED','ORDER_PLACED','ORDER_PICKUP','REPAIR_PLACED','REPAIR_PICKUP','PRODUCT_RETURN','PRODUCT_EXCHANGE','STORE_VISIT','PRICE_CALCULATION','ORDER_PLACED_AND_BUYING_NEW_PRODUCT','ORDER_PLACED_AND_MAKING_NEW_ORDER','ORDER_PICKUP_AND_BUYING_NEW_PRODUCT','ORDER_PICKUP_AND_MAKING_NEW_ORDER','REPAIR_PLACED_AND_BUYING_NEW_PRODUCT','REPAIR_PLACED_AND_MAKING_NEW_ORDER','REPAIR_PICKUP_AND_BUYING_NEW_PRODUCT','REPAIR_PICKUP_AND_MAKING_NEW_ORDER']),
    ('crm_walkin','client_bought','choice',array['YES','NO']),
    ('crm_walkin','not_bought_reasons','multi_choice',array[]::text[]),
    ('crm_walkin','not_bought_other','text',array[]::text[]),
    ('crm_walkin','product_requirement','text',array[]::text[]),
    ('crm_walkin','seen_categories','multi_choice',array[]::text[]),
    ('crm_walkin','seen_count','number',array[]::text[]),
    ('crm_walkin','bought_categories','multi_choice',array[]::text[]),
    ('crm_walkin','order_categories','multi_choice',array[]::text[]),
    ('crm_walkin','visit_date','date',array[]::text[]),
    ('crm_walkin','next_visit_date','date',array[]::text[]),
    ('crm_walkin','client_type','choice',array['new','existing']),
    ('crm_walkin','bridal_or_non_bridal','text',array[]::text[]),
    ('crm_walkin','source_of_lead','text',array[]::text[]),
    ('crm_walkin','has_open_followup','boolean',array[]::text[]),
    ('crm_walkin','reference_number','text',array[]::text[]),
    ('crm_walkin','branch_id','branch',array[]::text[]),
    ('crm_walkin','crm_name','text',array[]::text[]),
    ('crm_walkin','staff_profile_id','user',array[]::text[]),
    ('crm_walkin','client_code','text',array[]::text[]),
    ('crm_walkin','client_name','text',array[]::text[]),
    ('crm_queue','is_new_client','boolean',array[]::text[]),
    ('crm_queue','token','text',array[]::text[]),
    ('crm_queue','registered_date','date',array[]::text[]),
    ('crm_queue','branch_id','branch',array[]::text[]),
    ('crm_queue','crm_name','text',array[]::text[]),
    ('crm_queue','staff_profile_id','user',array[]::text[]),
    ('crm_queue','client_code','text',array[]::text[]),
    ('crm_queue','client_name','text',array[]::text[]),
    ('crm_lead','source_channel','text',array[]::text[]),
    ('crm_lead','created_via','text',array[]::text[]),
    ('crm_lead','created_date','date',array[]::text[]),
    ('crm_lead','lead_name','text',array[]::text[]),
    ('crm_lead','branch_id','branch',array[]::text[]),
    ('crm_lead','staff_profile_id','user',array[]::text[]),
    ('crm_linked_form','branch_id','branch',array[]::text[]),
    ('crm_linked_form','staff_profile_id','user',array[]::text[]),
    ('crm_linked_form','client_code','text',array[]::text[]),
    ('crm_linked_form','client_name','text',array[]::text[]),
    ('jewelos_form','branch_id','branch',array[]::text[]),
    ('jewelos_form','submitted_by','user',array[]::text[]),
    ('jewelos_form','submitted_date','date',array[]::text[])
$$;

create function fms_trigger_question_type(p_type text,p_has_options boolean) returns text
language sql immutable set search_path=public as $$
  select case p_type
    when 'number' then 'number' when 'currency' then 'number' when 'rating' then 'number'
    when 'date' then 'date' when 'datetime' then 'date'
    when 'checkbox' then case when p_has_options then 'multi_choice' else 'boolean' end
    when 'select' then 'choice' when 'radio' then 'choice' when 'department_dropdown' then 'choice'
    when 'multiselect' then 'multi_choice'
    when 'user_dropdown' then 'user' when 'branch_dropdown' then 'branch'
    when 'phone' then null when 'file' then null when 'section_header' then null when 'divider' then null
    else 'text' end
$$;

-- Fields of a source: the static catalog plus, for form sources, the latest published version's
-- questions (phone numbers, files and layout items excluded).
create function fms_trigger_source_fields(p_tenant uuid,p_source jsonb) returns table(field_key text,field_type text,options jsonb)
language sql stable security definer set search_path=public as $$
  select c.field_key,c.field_type,to_jsonb(c.options) from fms_trigger_source_catalog() c where c.source_type=p_source->>'type'
  union all
  select f.field_key,fms_trigger_question_type(f.field_type,jsonb_array_length(o.opts)>0),o.opts
  from (select t.id from form_templates t
        where p_source->>'type' in ('jewelos_form','crm_linked_form')
          and coalesce(p_source->>'formFamilyId','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and t.tenant_id=p_tenant and t.family_id=(p_source->>'formFamilyId')::uuid and t.lifecycle='published' and t.is_active
        order by t.version desc limit 1) latest
  join form_fields f on f.form_template_id=latest.id
  cross join lateral (select coalesce(form_field_option_values(f.options,f.dropdown_master_type,p_tenant),'[]'::jsonb) opts) o
  where fms_trigger_question_type(f.field_type,jsonb_array_length(o.opts)>0) is not null
    and not exists(select 1 from fms_trigger_source_catalog() c where c.source_type=p_source->>'type' and c.field_key=f.field_key)
$$;

create function fms_trigger_operators_for(p_type text) returns text[]
language sql immutable set search_path=public as $$
  select case p_type
    when 'number' then array['equals','not_equals','greater_than','less_than','greater_than_or_equal','less_than_or_equal','is_empty','not_empty']
    when 'date' then array['equals','not_equals','greater_than','less_than','greater_than_or_equal','less_than_or_equal','is_empty','not_empty']
    when 'boolean' then array['equals','not_equals','is_empty','not_empty']
    when 'multi_choice' then array['contains','not_contains','in','is_empty','not_empty']
    when 'text' then array['equals','not_equals','contains','not_contains','is_empty','not_empty']
    when 'choice' then array['equals','not_equals','in','is_empty','not_empty']
    when 'branch' then array['equals','not_equals','in','is_empty','not_empty']
    when 'user' then array['equals','not_equals','in','is_empty','not_empty']
    else array[]::text[] end
$$;

create function fms_trigger_blank(v jsonb) returns boolean
language sql immutable set search_path=public as $$
  select v is null or jsonb_typeof(v)='null'
    or (jsonb_typeof(v)='string' and btrim(v#>>'{}')='')
    or (jsonb_typeof(v)='array' and jsonb_array_length(v)=0)
$$;
create function fms_trigger_lower(v jsonb) returns text
language sql immutable set search_path=public as $$
  select lower(btrim(case when jsonb_typeof(v)='string' then v#>>'{}' else v::text end))
$$;
create function fms_trigger_list(v jsonb) returns text[]
language sql immutable set search_path=public as $$
  select case when jsonb_typeof(v)='array' then coalesce((select array_agg(fms_trigger_lower(x) order by n) from jsonb_array_elements(v) with ordinality e(x,n)),'{}')
    when fms_trigger_blank(v) then '{}'::text[] else array[fms_trigger_lower(v)] end
$$;
create function fms_trigger_as_date(v jsonb,p_today date) returns text
language sql immutable set search_path=public as $$
  select case when v is null or jsonb_typeof(v)<>'string' then null
    when v#>>'{}'='today' then to_char(p_today,'YYYY-MM-DD')
    else substring(btrim(v#>>'{}') from '^(\d{4}-\d{2}-\d{2})') end
$$;
create function fms_trigger_as_number(v jsonb) returns numeric
language sql immutable set search_path=public as $$
  select case jsonb_typeof(v)
    when 'number' then (v#>>'{}')::numeric
    when 'string' then case when v#>>'{}' ~ '^\s*-?\d+(\.\d+)?\s*$' then btrim(v#>>'{}')::numeric end
    when 'array' then jsonb_array_length(v)::numeric
    else null end
$$;
create function fms_trigger_as_bool(v jsonb) returns boolean
language sql immutable set search_path=public as $$
  select case when jsonb_typeof(v)='boolean' then (v#>>'{}')::boolean
    when fms_trigger_lower(v) in ('true','yes','y','1') then true
    when fms_trigger_lower(v) in ('false','no','n','0') then false end
$$;

-- One rule. Blank, missing and hidden answers are empty: only "not equals", "does not contain"
-- and "is empty" match them.
create function fms_trigger_rule_matches(p_operator text,p_expected jsonb,p_actual jsonb,p_type text,p_today date) returns boolean
language plpgsql immutable set search_path=public as $$
declare l text; r text; ln numeric; rn numeric; lb boolean; rb boolean; items text[]; expected text[]; eq boolean; has boolean;
begin
  if p_operator='is_empty' then return fms_trigger_blank(p_actual); end if;
  if p_operator='not_empty' then return not fms_trigger_blank(p_actual); end if;
  if fms_trigger_blank(p_actual) then return p_operator in ('not_equals','not_contains'); end if;
  if p_operator in ('greater_than','less_than','greater_than_or_equal','less_than_or_equal') then
    if p_type='date' then
      l:=fms_trigger_as_date(p_actual,p_today); r:=fms_trigger_as_date(p_expected,p_today);
      if l is null or r is null then return false; end if;
      return case p_operator when 'greater_than' then l collate "C">r when 'less_than' then l collate "C"<r
        when 'greater_than_or_equal' then l collate "C">=r else l collate "C"<=r end;
    end if;
    ln:=fms_trigger_as_number(p_actual); rn:=fms_trigger_as_number(p_expected);
    if ln is null or rn is null then return false; end if;
    return case p_operator when 'greater_than' then ln>rn when 'less_than' then ln<rn when 'greater_than_or_equal' then ln>=rn else ln<=rn end;
  end if;
  items:=fms_trigger_list(p_actual);
  if p_operator='in' then
    expected:=fms_trigger_list(case when jsonb_typeof(p_expected)='array' then p_expected else jsonb_build_array(p_expected) end);
    return items && expected;
  end if;
  if p_type='boolean' then lb:=fms_trigger_as_bool(p_actual); rb:=fms_trigger_as_bool(p_expected); eq:=lb is not null and rb is not null and lb=rb;
  elsif p_type='number' then ln:=fms_trigger_as_number(p_actual); rn:=fms_trigger_as_number(p_expected); eq:=ln is not null and rn is not null and ln=rn;
  elsif p_type='date' then l:=fms_trigger_as_date(p_actual,p_today); r:=fms_trigger_as_date(p_expected,p_today); eq:=l is not null and r is not null and l=r;
  elsif jsonb_typeof(p_actual)='array' then eq:=cardinality(items)=1 and items[1]=fms_trigger_lower(p_expected);
  else eq:=fms_trigger_lower(p_actual)=fms_trigger_lower(p_expected); end if;
  if jsonb_typeof(p_actual)='array' then has:=fms_trigger_lower(p_expected)=any(items);
  else has:=strpos(fms_trigger_lower(p_actual),coalesce(fms_trigger_lower(p_expected),''))>0; end if;
  return case p_operator when 'equals' then coalesce(eq,false) when 'not_equals' then not coalesce(eq,false)
    when 'contains' then coalesce(has,false) when 'not_contains' then not coalesce(has,false) else false end;
end $$;

-- The condition tree. Returns {"r": true|false|null, "rules": [{id, field, operator, passed}]}.
-- Disabled rules and groups, and groups with nothing enabled, are skipped (r = null).
create function fms_trigger_node_eval(p_node jsonb,p_answers jsonb,p_types jsonb,p_today date) returns jsonb
language plpgsql immutable set search_path=public as $$
declare child jsonb; sub jsonb; rules jsonb:='[]'; outcomes boolean[]:='{}'; passed boolean;
begin
  if not coalesce((p_node->>'enabled')::boolean,false) then
    if p_node->>'kind'='rule' then
      return jsonb_build_object('r',null,'rules',jsonb_build_array(jsonb_build_object('id',p_node->>'id','field',p_node->>'field','operator',p_node->>'operator','passed',false,'skipped',true)));
    end if;
    return jsonb_build_object('r',null,'rules','[]'::jsonb);
  end if;
  if p_node->>'kind'='rule' then
    passed:=fms_trigger_rule_matches(p_node->>'operator',p_node->'value',p_answers->(p_node->>'field'),coalesce(p_types->>(p_node->>'field'),'text'),p_today);
    return jsonb_build_object('r',passed,'rules',jsonb_build_array(jsonb_build_object('id',p_node->>'id','field',p_node->>'field','operator',p_node->>'operator','passed',passed)));
  end if;
  for child in select value from jsonb_array_elements(coalesce(p_node->'children','[]'::jsonb)) loop
    sub:=fms_trigger_node_eval(child,p_answers,p_types,p_today);
    rules:=rules||(sub->'rules');
    if jsonb_typeof(sub->'r')='boolean' then outcomes:=outcomes||(sub->>'r')::boolean; end if;
  end loop;
  if cardinality(outcomes)=0 then return jsonb_build_object('r',null,'rules',rules); end if;
  return jsonb_build_object('r',case when p_node->>'combinator'='or' then true=any(outcomes) else not (false=any(outcomes)) end,'rules',rules);
end $$;

create function fms_trigger_value_text(v jsonb) returns text
language sql immutable set search_path=public as $$
  select case when fms_trigger_blank(v) then ''
    when jsonb_typeof(v)='array' then (select string_agg(case when jsonb_typeof(x)='string' then x#>>'{}' else x::text end,', ' order by n) from jsonb_array_elements(v) with ordinality e(x,n))
    when jsonb_typeof(v)='string' then v#>>'{}'
    else v::text end
$$;

create function fms_trigger_context(p_trigger jsonb,p_payload jsonb) returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(jsonb_object_agg(m->>'key',left(x.v,500)),'{}'::jsonb)
  from jsonb_array_elements(coalesce(p_trigger->'mapping','[]'::jsonb)) m
  cross join lateral (select coalesce(nullif(case when nullif(m->>'field','') is not null then fms_trigger_value_text(p_payload->(m->>'field')) else btrim(coalesce(m->>'fixed','')) end,''),
    nullif(btrim(coalesce(m->>'fallback','')),'')) v) x
  where x.v is not null
$$;

create function fms_trigger_title(p_trigger jsonb,p_payload jsonb,p_flow_name text) returns text
language sql immutable set search_path=public as $$
  select left(case when x.field<>'' then x.prefix||' · '||x.field else x.prefix end,200)
  from (select coalesce(nullif(btrim(coalesce(p_trigger#>>'{title,prefix}','')),''),p_flow_name) prefix,
    case when nullif(p_trigger#>>'{title,field}','') is not null then btrim(fms_trigger_value_text(p_payload->(p_trigger#>>'{title,field}'))) else '' end field) x
$$;

-- A source date becomes that day's second-half deadline (21:00 India time); blank or past dates
-- return null and the step keeps its own timing.
create function fms_trigger_due(p_trigger jsonb,p_payload jsonb) returns timestamptz
language sql stable set search_path=public as $$
  select case when x.d is not null and (x.d+time '21:00') at time zone 'Asia/Kolkata'>now() then (x.d+time '21:00') at time zone 'Asia/Kolkata' end
  from (select case when nullif(p_trigger->>'dueField','') is null then null else fms_due_parse_date(p_payload->>(p_trigger->>'dueField')) end d) x
$$;

-- ---------------------------------------------------------------------------------------------
-- 4. Publishing validation (mirror of validateFmsStartTrigger).
-- ---------------------------------------------------------------------------------------------
create function fms_trigger_check_node(p_node jsonb,p_depth integer,p_fields jsonb,p_state jsonb,p_parent_enabled boolean) returns jsonb
language plpgsql immutable set search_path=public as $$
declare state jsonb:=p_state; child jsonb; field jsonb; field_type text; vals jsonb; item jsonb; enabled boolean;
begin
  if jsonb_typeof(p_node) is distinct from 'object' or coalesce(p_node->>'id','')!~'^[A-Za-z0-9_-]{1,64}$'
     or (state->'ids') ? (p_node->>'id') or jsonb_typeof(p_node->'enabled') is distinct from 'boolean' then
    raise exception 'Each start condition needs a unique id and an on/off switch' using errcode='23514';
  end if;
  state:=jsonb_set(state,'{ids}',(state->'ids')||to_jsonb(p_node->>'id'));
  enabled:=p_parent_enabled and (p_node->>'enabled')::boolean;
  if p_node->>'kind'='group' then
    if p_depth>3 then raise exception 'Start condition groups can be nested at most 3 levels' using errcode='23514'; end if;
    if coalesce(p_node->>'combinator','') not in ('and','or') or jsonb_typeof(p_node->'children') is distinct from 'array' then
      raise exception 'A start condition group must use AND or OR' using errcode='23514';
    end if;
    for child in select value from jsonb_array_elements(p_node->'children') loop
      state:=fms_trigger_check_node(child,p_depth+1,p_fields,state,enabled);
    end loop;
    return state;
  end if;
  if p_node->>'kind' is distinct from 'rule' then raise exception 'Unknown start condition' using errcode='23514'; end if;
  state:=jsonb_set(state,'{total}',to_jsonb((state->>'total')::integer+1));
  if not (p_node->>'enabled')::boolean then return state; end if;
  if enabled then state:=jsonb_set(state,'{enabled}',to_jsonb((state->>'enabled')::integer+1)); end if;
  field:=p_fields->(p_node->>'field');
  if coalesce(p_node->>'field','')!~'^[A-Za-z][A-Za-z0-9_.]{0,79}$' or field is null then
    raise exception 'A start condition uses a field the source no longer has' using errcode='23514';
  end if;
  field_type:=field->>'type';
  if not (coalesce(p_node->>'operator','')=any(fms_trigger_operators_for(field_type))) then
    raise exception 'A start condition uses a comparison its field does not support' using errcode='23514';
  end if;
  if p_node->>'operator' in ('is_empty','not_empty') then return state; end if;
  vals:=case when jsonb_typeof(p_node->'value')='array' then p_node->'value' else jsonb_build_array(p_node->'value') end;
  if jsonb_array_length(vals)=0 or exists(select 1 from jsonb_array_elements(vals) v where fms_trigger_blank(v)) then
    raise exception 'A start condition needs the value it should match' using errcode='23514';
  end if;
  if p_node->>'operator'<>'in' and jsonb_typeof(p_node->'value')='array' then
    raise exception 'Only "Is one of" accepts several values' using errcode='23514';
  end if;
  if field_type='date' and exists(select 1 from jsonb_array_elements(vals) v where coalesce(v#>>'{}','')<>'today' and coalesce(v#>>'{}','')!~'^\d{4}-\d{2}-\d{2}$') then
    raise exception 'A date condition needs a date or today' using errcode='23514';
  end if;
  if field_type='number' and exists(select 1 from jsonb_array_elements(vals) v where fms_trigger_as_number(v) is null) then
    raise exception 'A number condition needs a number' using errcode='23514';
  end if;
  if jsonb_array_length(coalesce(field->'options','[]'::jsonb))>0 and (field_type='choice' or p_node->>'operator'='in') then
    for item in select value from jsonb_array_elements(vals) loop
      if not (field->'options') @> jsonb_build_array(item#>>'{}') then
        raise exception 'A start condition matches an answer the source no longer offers' using errcode='23514';
      end if;
    end loop;
  end if;
  return state;
end $$;

create function assert_fms_start_trigger_publishable(p_flow_id uuid) returns void
language plpgsql stable security definer set search_path=public as $$
declare f fms_flows; t jsonb; first_stage fms_stages; fields jsonb; state jsonb; m jsonb; keys text[]:='{}';
begin
  select * into f from fms_flows where id=p_flow_id;
  select * into first_stage from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1;
  if f.start_mode='form' then
    if f.start_trigger is not null then raise exception 'A form-started workflow has no automatic trigger' using errcode='23514'; end if;
    return;
  end if;
  if first_stage.step_type::text not in ('task','form','approval','branch','notification','parallel_start') then
    raise exception 'A workflow without a starting form must begin with a Task, Form, Approval, Decision, Notification or Parallel step' using errcode='23514';
  end if;
  if f.start_mode='manual' then return; end if;
  t:=f.start_trigger;
  if coalesce(t#>>'{source,type}','') not in ('jewelos_form','crm_walkin','crm_queue','crm_lead','crm_linked_form') then
    raise exception 'Choose a supported start source' using errcode='23514';
  end if;
  if t#>>'{source,type}' in ('jewelos_form','crm_linked_form') then
    if coalesce(t#>>'{source,formFamilyId}','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists(select 1 from form_templates ft where ft.tenant_id=f.tenant_id and ft.family_id=(t#>>'{source,formFamilyId}')::uuid and ft.lifecycle='published' and ft.is_active) then
      raise exception 'The start form must be a published form of this business' using errcode='23514';
    end if;
    if t#>>'{source,type}'='crm_linked_form' and coalesce(t#>>'{source,purpose}','') not in ('queue','lead') then
      raise exception 'Choose whether the CRM form is the queue or the lead registration form' using errcode='23514';
    end if;
  end if;
  select coalesce(jsonb_object_agg(s.field_key,jsonb_build_object('type',s.field_type,'options',s.options)),'{}'::jsonb) into fields
  from fms_trigger_source_fields(f.tenant_id,t->'source') s;
  if t#>>'{conditions,kind}' is distinct from 'group' then raise exception 'The start conditions must be a group' using errcode='23514'; end if;
  state:=fms_trigger_check_node(t->'conditions',0,fields,'{"ids":[],"total":0,"enabled":0}'::jsonb,true);
  if (state->>'total')::integer>25 then raise exception 'Use at most 25 start conditions' using errcode='23514'; end if;
  if (state->>'enabled')::integer=0 then raise exception 'Add at least one switched-on start condition, so the workflow does not start for every submission' using errcode='23514'; end if;
  if jsonb_typeof(coalesce(t->'mapping','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(t->'mapping','[]'::jsonb))>20 then
    raise exception 'Copy at most 20 values into the workflow' using errcode='23514';
  end if;
  for m in select value from jsonb_array_elements(coalesce(t->'mapping','[]'::jsonb)) loop
    if coalesce(m->>'key','')!~'^[a-z][a-z0-9_]{0,39}$' or (m->>'key')=any(keys)
       or (m->>'key') in ('form_submission_id','form_template_id','starter_assignment_id','status','trigger')
       or length(btrim(coalesce(m->>'label','')))=0 or length(m->>'label')>80 then
      raise exception 'Each copied value needs a unique key and a label' using errcode='23514';
    end if;
    keys:=keys||(m->>'key');
    if (nullif(m->>'field','') is not null and not fields ? (m->>'field'))
       or (nullif(m->>'field','') is null and length(btrim(coalesce(m->>'fixed','')))=0) then
      raise exception 'A copied value uses a field the source does not have' using errcode='23514';
    end if;
  end loop;
  if nullif(t#>>'{title,field}','') is not null and not fields ? (t#>>'{title,field}') then
    raise exception 'The run title uses a field the source does not have' using errcode='23514';
  end if;
  if nullif(t->>'dueField','') is not null and fields#>>array[t->>'dueField','type'] is distinct from 'date' then
    raise exception 'The first deadline must come from a date field' using errcode='23514';
  end if;
  if coalesce(t#>>'{assignment,mode}','') not in ('stage_rules','source_staff') or coalesce(t#>>'{assignment,onUnresolved}','') not in ('review','stage_rules')
     or coalesce(t->>'reentry','') not in ('one_active_per_case','one_per_event') or coalesce(t->>'onCaseClosed','') not in ('record_only','cancel_run') then
    raise exception 'Complete the start trigger settings' using errcode='23514';
  end if;
end $$;

create or replace function publish_fms_flow_with_audit(p_flow_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_flow fms_flows;
begin
  perform public.assert_module_enabled('fms_builder');
  select * into v_actor from current_profile();
  if not can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode='42501'; end if;
  perform assert_fms_flow_publishable(p_flow_id);
  perform assert_fms_start_trigger_publishable(p_flow_id);
  select * into v_flow from fms_flows where id=p_flow_id for update;
  update fms_starter_assignments starter set status='cancelled'
  from fms_flows previous
  where starter.fms_flow_id=previous.id and previous.tenant_id=v_flow.tenant_id and previous.family_id=v_flow.family_id and previous.status='published' and starter.status='pending';
  update fms_flows set status='archived',is_active=false,archived_at=now(),archived_by=v_actor.id,updated_at=now() where tenant_id=v_flow.tenant_id and family_id=v_flow.family_id and status='published';
  update fms_flows set status='published',is_active=true,published_by=v_actor.id,updated_by=v_actor.id,updated_at=now() where id=p_flow_id;
  -- Starting-form assignments exist only for form-started versions.
  if v_flow.start_mode='form' then perform queue_fms_starter_assignments(p_flow_id,v_actor.id); end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'fms_flow_published','fms_flows',p_flow_id,
    jsonb_build_object('version',v_flow.version,'starter_assignments_queued',v_flow.start_mode='form','start_mode',v_flow.start_mode,
      'start_source',v_flow.start_trigger#>>'{source,type}'));
end;
$$;

-- A revision keeps its version's start settings as an editable draft.
create or replace function create_fms_revision_with_audit(p_flow_id uuid) returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  perform assert_module_enabled('fms_builder');
  v_id:=create_fms_revision_before_assignment(p_flow_id);
  update fms_flows target set assignment_version=source.assignment_version,start_mode=source.start_mode,start_trigger=source.start_trigger
    from fms_flows source where target.id=v_id and source.id=p_flow_id;
  perform fms_remap_assignment_routes(v_id,null,p_flow_id);
  return v_id;
end $$;

-- The builder saves the start settings next to the draft (like set_fms_flow_context_with_audit).
create function set_fms_flow_start_with_audit(p_flow_id uuid,p_start_mode text,p_start_trigger jsonb default null) returns void
language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles:=current_profile(); v_flow fms_flows;
begin
  perform assert_module_enabled('fms_builder');
  if v_actor.id is null or not current_profile_is_active() or not has_permission('fms.manage') or not can_manage_fms_flow(p_flow_id) then
    raise exception 'FMS builder access denied' using errcode='42501';
  end if;
  select * into v_flow from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id for update;
  if v_flow.id is null or v_flow.status<>'draft' then raise exception 'Draft workflow not found' using errcode='23514'; end if;
  if p_start_mode not in ('form','automatic','manual') or (p_start_mode='automatic')<>(p_start_trigger is not null)
     or (p_start_trigger is not null and (jsonb_typeof(p_start_trigger)<>'object' or pg_column_size(p_start_trigger)>65536)) then
    raise exception 'Invalid workflow start settings' using errcode='22023';
  end if;
  if v_flow.start_mode is not distinct from p_start_mode and v_flow.start_trigger is not distinct from p_start_trigger then return; end if;
  update fms_flows set start_mode=p_start_mode,start_trigger=p_start_trigger,updated_by=v_actor.id,updated_at=now() where id=p_flow_id;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'fms_flow_start_saved','fms_flows',p_flow_id,
    jsonb_build_object('start_mode',v_flow.start_mode,'start_source',v_flow.start_trigger#>>'{source,type}'),
    jsonb_build_object('start_mode',p_start_mode,'start_source',p_start_trigger#>>'{source,type}'));
end $$;

-- ---------------------------------------------------------------------------------------------
-- 5. Events, evaluations and run sources.
-- ---------------------------------------------------------------------------------------------
create table fms_trigger_events(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  source_type text not null check (source_type in ('jewelos_form','crm_walkin','crm_queue','crm_lead','crm_linked_form')),
  event_key text not null check (event_key ~ '^[A-Za-z0-9_.:-]{1,160}$'),
  source_record_id uuid,
  source_family_id uuid,
  source_template_id uuid,
  source_purpose text check (source_purpose is null or source_purpose in ('queue','lead')),
  crm_client_id uuid,
  crm_case_id uuid,
  branch_id uuid references branches(id),
  staff_profile_id uuid references user_profiles(id),
  -- The immutable answer snapshot. No phone numbers, addresses or files.
  payload jsonb not null check (jsonb_typeof(payload)='object' and pg_column_size(payload)<=65536),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending','processed','review','failed')),
  attempts integer not null default 0 check (attempts>=0),
  last_error text check (char_length(last_error)<=300),
  processed_at timestamptz,
  unique(tenant_id,event_key)
);
create index fms_trigger_events_recent on fms_trigger_events(tenant_id,received_at desc);
create index fms_trigger_events_attention on fms_trigger_events(tenant_id,status) where status in ('review','failed');

create function fms_trigger_events_immutable() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' then raise exception 'Trigger events are kept as history' using errcode='42501'; end if;
  if (new.tenant_id,new.source_type,new.event_key,new.source_record_id,new.source_family_id,new.source_template_id,new.source_purpose,
      new.crm_client_id,new.crm_case_id,new.branch_id,new.staff_profile_id,new.payload,new.occurred_at,new.received_at)
     is distinct from
     (old.tenant_id,old.source_type,old.event_key,old.source_record_id,old.source_family_id,old.source_template_id,old.source_purpose,
      old.crm_client_id,old.crm_case_id,old.branch_id,old.staff_profile_id,old.payload,old.occurred_at,old.received_at) then
    raise exception 'A trigger event snapshot cannot be changed' using errcode='42501';
  end if;
  return new;
end $$;
create trigger fms_trigger_events_immutable before update or delete on fms_trigger_events
  for each row execute function fms_trigger_events_immutable();

create table fms_trigger_evaluations(
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  event_id uuid not null references fms_trigger_events(id),
  fms_flow_id uuid not null references fms_flows(id) on delete cascade,
  flow_family_id uuid not null,
  flow_version integer not null,
  outcome text not null check (outcome in ('started','not_matched','duplicate','out_of_scope','review','failed')),
  fms_instance_id uuid references fms_instances(id) on delete set null,
  -- Pass/fail per rule id, never the answers themselves.
  rule_results jsonb not null default '[]'::jsonb,
  detail text check (char_length(detail)<=300),
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id,fms_flow_id)
);
create index fms_trigger_evaluations_flow on fms_trigger_evaluations(flow_family_id,created_at desc);

create table fms_instance_trigger_sources(
  fms_instance_id uuid primary key references fms_instances(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  event_id uuid not null references fms_trigger_events(id),
  fms_flow_id uuid not null,
  flow_family_id uuid not null,
  source_type text not null,
  case_key text not null,
  exclusive boolean not null,
  crm_client_id uuid,
  crm_case_id uuid,
  source_record_id uuid,
  released_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index fms_trigger_one_run_per_event on fms_instance_trigger_sources(event_id,flow_family_id);
create unique index fms_trigger_one_open_run_per_case on fms_instance_trigger_sources(tenant_id,flow_family_id,case_key) where exclusive and released_at is null;
create index fms_instance_trigger_sources_case on fms_instance_trigger_sources(tenant_id,crm_case_id) where crm_case_id is not null;

alter table fms_trigger_events enable row level security;
alter table fms_trigger_evaluations enable row level security;
alter table fms_instance_trigger_sources enable row level security;
revoke all on fms_trigger_events,fms_trigger_evaluations,fms_instance_trigger_sources from public,anon,authenticated;

-- A finished or cancelled run frees its case, so the next qualifying event can start a new run.
create function fms_trigger_release_case() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.status in ('completed','cancelled') and old.status not in ('completed','cancelled') then
    update fms_instance_trigger_sources set released_at=now() where fms_instance_id=new.id and released_at is null;
  end if;
  return null;
end $$;
create trigger fms_trigger_release_case after update of status on fms_instances
  for each row execute function fms_trigger_release_case();

-- ---------------------------------------------------------------------------------------------
-- 6. Processing.
-- ---------------------------------------------------------------------------------------------
create function fms_trigger_case_key(p_event fms_trigger_events,p_trigger jsonb) returns text
language sql immutable set search_path=public as $$
  select case when p_trigger->>'reentry'='one_per_event' then 'event:'||p_event.id
    when p_event.crm_case_id is not null then 'crm_case:'||p_event.crm_case_id
    when p_event.crm_client_id is not null then 'crm_client:'||p_event.crm_client_id
    else 'record:'||coalesce(p_event.source_record_id,p_event.id) end
$$;

create function fms_trigger_active_staff(p_tenant uuid,p_profile uuid) returns user_profiles
language sql stable security definer set search_path=public as $$
  select p.* from user_profiles p
  where p.id=p_profile and p.tenant_id=p_tenant and p.account_status='active'
    and p.working_status not in ('inactive','resigned') and coalesce(p.is_login_enabled,false)
$$;

-- Starts one run. Returns null (no writes) when the source person must be resolved but is not.
create function fms_trigger_start_run(p_flow fms_flows,p_event fms_trigger_events,p_case_key text) returns uuid
language plpgsql security definer set search_path=public as $$
declare t jsonb:=p_flow.start_trigger; staff user_profiles; owner user_profiles; first_stage fms_stages; v_instance fms_instances;
  v_ref text; v_due timestamptz; v_source_staff boolean:=(p_flow.start_trigger#>>'{assignment,mode}')='source_staff';
begin
  if p_event.staff_profile_id is not null then staff:=fms_trigger_active_staff(p_event.tenant_id,p_event.staff_profile_id); end if;
  if v_source_staff and staff.id is null and t#>>'{assignment,onUnresolved}'='review' then return null; end if;
  select * into owner from user_profiles where id=coalesce(staff.id,p_flow.published_by,p_flow.created_by);
  v_ref:='FMS-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||lpad(nextval('fms_reference_sequence')::text,8,'0');
  perform set_config('jewelos.fms_start_path','automatic',true);
  insert into fms_instances(tenant_id,branch_id,department_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,priority,context,started_by,related_entity,related_record_id)
  values(p_flow.tenant_id,coalesce(p_flow.branch_id,p_event.branch_id,owner.branch_id),coalesce(p_flow.department_id,staff.department_id,owner.department_id),
    p_flow.id,p_flow.family_id,p_flow.version,v_ref,fms_trigger_title(t,p_event.payload,p_flow.name),'active','medium',
    fms_trigger_context(t,p_event.payload),owner.id,case when p_event.crm_client_id is not null then 'crm_client' end,p_event.crm_client_id)
  returning * into v_instance;
  perform set_config('jewelos.fms_start_path','',true);
  insert into fms_instance_trigger_sources(fms_instance_id,tenant_id,event_id,fms_flow_id,flow_family_id,source_type,case_key,exclusive,crm_client_id,crm_case_id,source_record_id)
  values(v_instance.id,p_flow.tenant_id,p_event.id,p_flow.id,p_flow.family_id,p_event.source_type,p_case_key,t->>'reentry'='one_active_per_case',p_event.crm_client_id,p_event.crm_case_id,p_event.source_record_id);
  update fms_flows set usage_count=usage_count+1 where id=p_flow.id;
  select * into first_stage from fms_stages where fms_flow_id=p_flow.id order by sort_order,id limit 1;
  perform set_config('jewelos.fms_start_assignee',case when v_source_staff and staff.id is not null then staff.id::text else '' end,true);
  perform activate_fms_stage_internal(v_instance.id,first_stage.id,null,null,0);
  perform set_config('jewelos.fms_start_assignee','',true);
  v_due:=fms_trigger_due(t,p_event.payload);
  if v_due is not null then
    with moved as (
      update fms_instance_stages work set planned_datetime=v_due
      from fms_stages step where work.fms_instance_id=v_instance.id and step.id=work.fms_stage_id
        and step.step_type in ('form','task','approval') and work.status in ('pending','in_progress','in_review')
      returning work.id)
    insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
    select moved.id,null,'due_from_trigger',jsonb_build_object('field',t->>'dueField','due_at',v_due) from moved;
  end if;
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(p_flow.tenant_id,null,'fms_instance_started_by_trigger','fms_instances',v_instance.id,
    jsonb_build_object('flow_id',p_flow.id,'version',p_flow.version,'event_id',p_event.id,'source_type',p_event.source_type,
      'reference_number',v_ref,'assignee_from_source',v_source_staff and staff.id is not null,'due_from_source',v_due is not null));
  return v_instance.id;
end $$;

-- Evaluates one stored event against every published automatic version of its source. Safe to
-- call again: settled outcomes are kept; failed and review outcomes are re-evaluated.
create function fms_trigger_process_event(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare e fms_trigger_events; f fms_flows; t jsonb; prior fms_trigger_evaluations; types jsonb; ev jsonb;
  v_outcome text; v_detail text; v_instance uuid; v_case text; counts jsonb:='{"started":0,"not_matched":0,"duplicate":0,"out_of_scope":0,"review":0,"failed":0}';
begin
  select * into e from fms_trigger_events where id=p_event_id for update;
  if e.id is null then raise exception 'Trigger event not found' using errcode='P0002'; end if;
  for f in
    select * from fms_flows flow
    where flow.tenant_id=e.tenant_id and flow.status='published' and flow.is_active and flow.start_mode='automatic'
      and flow.start_trigger#>>'{source,type}'=e.source_type
      and (e.source_type not in ('jewelos_form','crm_linked_form') or flow.start_trigger#>>'{source,formFamilyId}'=e.source_family_id::text)
      and (e.source_type<>'crm_linked_form' or flow.start_trigger#>>'{source,purpose}'=e.source_purpose)
    order by flow.name,flow.id
  loop
    select * into prior from fms_trigger_evaluations where event_id=e.id and fms_flow_id=f.id;
    if prior.id is not null and prior.outcome not in ('review','failed') then continue; end if;
    t:=f.start_trigger; v_outcome:=null; v_detail:=null; v_instance:=null; ev:='{"rules":[]}'::jsonb;
    begin
      select coalesce(jsonb_object_agg(s.field_key,s.field_type),'{}'::jsonb) into types from fms_trigger_source_fields(e.tenant_id,t->'source') s;
      ev:=fms_trigger_node_eval(t->'conditions',e.payload,types,(now() at time zone 'Asia/Kolkata')::date);
      if jsonb_typeof(ev->'r') is distinct from 'boolean' or not (ev->>'r')::boolean then
        v_outcome:='not_matched';
      elsif f.branch_id is not null and e.branch_id is distinct from f.branch_id then
        v_outcome:='out_of_scope'; v_detail:='The event belongs to a branch outside this workflow';
      else
        v_case:=fms_trigger_case_key(e,t);
        select s.fms_instance_id into v_instance from fms_instance_trigger_sources s where s.event_id=e.id and s.flow_family_id=f.family_id;
        if v_instance is null and t->>'reentry'='one_active_per_case' then
          select s.fms_instance_id into v_instance from fms_instance_trigger_sources s
          where s.tenant_id=e.tenant_id and s.flow_family_id=f.family_id and s.case_key=v_case and s.exclusive and s.released_at is null;
        end if;
        if v_instance is not null then
          v_outcome:='duplicate'; v_detail:='An open run already exists for this case';
        else
          v_instance:=fms_trigger_start_run(f,e,v_case);
          if v_instance is null then v_outcome:='review'; v_detail:='The person named by the source is not an active JewelOS user';
          else v_outcome:='started'; end if;
        end if;
      end if;
    exception
      when unique_violation then v_outcome:='duplicate'; v_detail:='An open run already exists for this case'; v_instance:=null;
      when others then v_outcome:='failed'; v_detail:=left(sqlerrm,300); v_instance:=null;
    end;
    insert into fms_trigger_evaluations(tenant_id,event_id,fms_flow_id,flow_family_id,flow_version,outcome,fms_instance_id,rule_results,detail)
    values(e.tenant_id,e.id,f.id,f.family_id,f.version,v_outcome,v_instance,coalesce(ev->'rules','[]'::jsonb),v_detail)
    on conflict(event_id,fms_flow_id) do update set outcome=excluded.outcome,fms_instance_id=excluded.fms_instance_id,
      rule_results=excluded.rule_results,detail=excluded.detail,attempts=fms_trigger_evaluations.attempts+1,updated_at=now();
    counts:=jsonb_set(counts,array[v_outcome],to_jsonb((counts->>v_outcome)::integer+1));
  end loop;
  update fms_trigger_events set attempts=attempts+1,processed_at=now(),
    status=case when (counts->>'failed')::integer>0 then 'failed' when (counts->>'review')::integer>0 then 'review' else 'processed' end,
    last_error=case when (counts->>'failed')::integer>0 then (select left(detail,300) from fms_trigger_evaluations where event_id=e.id and outcome='failed' order by updated_at desc limit 1) end
  where id=e.id;
  return counts||jsonb_build_object('outcome','processed','event_id',e.id);
end $$;

-- True when some published automatic version listens to this source.
create function fms_trigger_has_listener(p_tenant uuid,p_type text,p_family uuid default null,p_purpose text default null) returns boolean
language sql stable security definer set search_path=public as $$
  select exists(select 1 from fms_flows f where f.tenant_id=p_tenant and f.status='published' and f.is_active and f.start_mode='automatic'
    and f.start_trigger#>>'{source,type}'=p_type
    and (p_family is null or f.start_trigger#>>'{source,formFamilyId}'=p_family::text)
    and (p_purpose is null or f.start_trigger#>>'{source,purpose}'=p_purpose))
$$;

-- Answers of a form submission without phone numbers or files.
create function fms_trigger_form_answers(p_template uuid,p_data jsonb) returns jsonb
language sql stable security definer set search_path=public as $$
  select case when jsonb_typeof(p_data)='object' then p_data-coalesce(array(select f.field_key from form_fields f where f.form_template_id=p_template and f.field_type in ('phone','file')),'{}') else '{}'::jsonb end
$$;

-- Forms Library: capture the persisted submission in its own transaction.
create function fms_trigger_capture_form_submission() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_template form_templates; v_event fms_trigger_events;
begin
  if new.status<>'submitted' or (tg_op='UPDATE' and old.status='submitted') then return null; end if;
  select * into v_template from form_templates where id=new.form_template_id and tenant_id=new.tenant_id;
  if v_template.id is null or not fms_trigger_has_listener(new.tenant_id,'jewelos_form',v_template.family_id) then return null; end if;
  insert into fms_trigger_events(tenant_id,source_type,event_key,source_record_id,source_family_id,source_template_id,branch_id,staff_profile_id,payload,occurred_at)
  values(new.tenant_id,'jewelos_form','form.'||new.id,new.id,v_template.family_id,v_template.id,new.branch_id,new.submitted_by,
    fms_trigger_form_answers(new.form_template_id,new.data)||jsonb_strip_nulls(jsonb_build_object('branch_id',new.branch_id,'submitted_by',new.submitted_by,
      'submitted_date',to_char(coalesce(new.submitted_at,now()) at time zone 'Asia/Kolkata','YYYY-MM-DD'))),
    coalesce(new.submitted_at,now()))
  on conflict(tenant_id,event_key) do nothing
  returning * into v_event;
  if v_event.id is null then return null; end if;
  begin
    perform fms_trigger_process_event(v_event.id);
  exception when others then
    update fms_trigger_events set status='failed',attempts=attempts+1,last_error=left(sqlerrm,300) where id=v_event.id;
  end;
  return null;
end $$;
create trigger fms_trigger_capture_form_submission after insert or update of status on form_submissions
  for each row execute function fms_trigger_capture_form_submission();

-- A closed CRM Not Bought case reaches its linked open runs through an explicit policy.
create function fms_trigger_reconcile_crm_case(p_tenant uuid,p_case uuid,p_status text,p_event_id text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare r record; cancelled integer:=0; recorded integer:=0; v_reason text:=left('CRM follow-up case closed: '||coalesce(nullif(btrim(p_status),''),'closed'),300);
begin
  for r in
    select src.fms_instance_id,i.status,f.start_trigger->>'onCaseClosed' policy
    from fms_instance_trigger_sources src join fms_instances i on i.id=src.fms_instance_id join fms_flows f on f.id=i.fms_flow_id
    where src.tenant_id=p_tenant and src.crm_case_id=p_case and i.status in ('active','overdue','on_hold')
    for update of i
  loop
    if r.policy='cancel_run' then
      update fms_instances set status='cancelled',cancelled_by=null,cancelled_at=now(),cancel_reason=v_reason,updated_at=now() where id=r.fms_instance_id;
      update fms_instance_stages set status='blocked',updated_at=now() where fms_instance_id=r.fms_instance_id and status in ('pending','in_progress','in_review','overdue');
      update fms_instance_stage_assignees set status='cancelled',is_active=false
        where fms_instance_stage_id in (select id from fms_instance_stages where fms_instance_id=r.fms_instance_id) and is_active;
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
      values(p_tenant,null,'fms_instance_cancelled_by_crm_case','fms_instances',r.fms_instance_id,jsonb_build_object('status',r.status),
        jsonb_build_object('status','cancelled','crm_case_id',p_case,'crm_status',p_status,'event_id',p_event_id));
      cancelled:=cancelled+1;
    else
      insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
      select s.id,null,'crm_case_closed',jsonb_build_object('crm_status',p_status,'event_id',p_event_id)
      from fms_instance_stages s where s.fms_instance_id=r.fms_instance_id and s.status in ('pending','in_progress','in_review','overdue');
      insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
      values(p_tenant,null,'fms_crm_case_closed_recorded','fms_instances',r.fms_instance_id,jsonb_build_object('crm_case_id',p_case,'crm_status',p_status,'event_id',p_event_id));
      recorded:=recorded+1;
    end if;
  end loop;
  return jsonb_build_object('outcome','case_reconciled','cancelled',cancelled,'recorded',recorded);
end $$;

-- CRM -> JewelOS: one saved-submission event (sync-deliver -> crm-sync-receive, service role).
create function crm_sync_apply_submission_event(p_event_id text,p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_prior jsonb; v_kind text; v_tenant uuid; v_branch uuid; v_staff uuid; v_type text; v_family uuid; v_template uuid; v_purpose text;
  v_answers jsonb; v_event fms_trigger_events; v_result jsonb; v_uuid text:='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_record uuid; v_client uuid; v_case uuid; v_at timestamptz;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service role required' using errcode='42501'; end if;
  v_kind:=p_payload->>'kind';
  if p_event_id is null or p_event_id!~'^[A-Za-z0-9_.:-]{1,160}$' or jsonb_typeof(p_payload) is distinct from 'object'
     or v_kind not in ('crm.walkin_visit_saved','crm.queue_registered','crm.lead_saved','crm.form_submission_saved','crm.not_bought_case_closed')
     or pg_column_size(p_payload)>131072 then
    raise exception 'invalid sync event' using errcode='22023';
  end if;
  select i.result into v_prior from crm_sync.inbox i where i.event_id=p_event_id;
  if found then return v_prior||jsonb_build_object('duplicate',true); end if;
  perform pg_advisory_xact_lock(hashtextextended('crm_sync.submission:'||p_event_id,0));
  select i.result into v_prior from crm_sync.inbox i where i.event_id=p_event_id;
  if found then return v_prior||jsonb_build_object('duplicate',true); end if;

  if coalesce(p_payload->>'jewelos_branch_id','')~v_uuid then
    select b.id,b.tenant_id into v_branch,v_tenant from branches b where b.id=(p_payload->>'jewelos_branch_id')::uuid;
  end if;
  if v_tenant is null and (select count(*) from tenants)=1 then select id into v_tenant from tenants; end if;
  if coalesce(p_payload->>'record_id','')~v_uuid then v_record:=(p_payload->>'record_id')::uuid; end if;
  if coalesce(p_payload->>'client_id','')~v_uuid then v_client:=(p_payload->>'client_id')::uuid; end if;
  if coalesce(p_payload->>'case_id','')~v_uuid then v_case:=(p_payload->>'case_id')::uuid; end if;

  if v_tenant is null then
    v_result:=jsonb_build_object('outcome','no_tenant');
  elsif v_kind='crm.not_bought_case_closed' then
    v_result:=case when v_case is null then jsonb_build_object('outcome','invalid_case') else fms_trigger_reconcile_crm_case(v_tenant,v_case,left(p_payload->>'status',80),p_event_id) end;
  else
    v_type:=case v_kind when 'crm.walkin_visit_saved' then 'crm_walkin' when 'crm.queue_registered' then 'crm_queue' when 'crm.lead_saved' then 'crm_lead' else 'crm_linked_form' end;
    if v_type='crm_linked_form' then
      if coalesce(p_payload#>>'{form,formFamilyId}','')~v_uuid then v_family:=(p_payload#>>'{form,formFamilyId}')::uuid; end if;
      if coalesce(p_payload#>>'{form,formTemplateId}','')~v_uuid then v_template:=(p_payload#>>'{form,formTemplateId}')::uuid; end if;
      v_purpose:=case when p_payload#>>'{form,purpose}' in ('queue','lead') then p_payload#>>'{form,purpose}' end;
    end if;
    if v_type='crm_linked_form' and (v_family is null or v_purpose is null) then
      v_result:=jsonb_build_object('outcome','invalid_form');
    elsif not fms_trigger_has_listener(v_tenant,v_type,v_family,v_purpose) then
      -- Nothing listens: no answers are stored in JewelOS.
      v_result:=jsonb_build_object('outcome','no_trigger');
    else
      v_answers:=case when jsonb_typeof(p_payload->'answers')='object' then p_payload->'answers' else '{}'::jsonb end;
      if v_type='crm_linked_form' and v_template is not null then v_answers:=fms_trigger_form_answers(v_template,v_answers); end if;
      if coalesce(p_payload->>'staff_jewelos_user_id','')~v_uuid then
        select p.id into v_staff from user_profiles p where p.id=(p_payload->>'staff_jewelos_user_id')::uuid and p.tenant_id=v_tenant;
      end if;
      v_answers:=(v_answers-'branch_id'-'staff_profile_id')||jsonb_strip_nulls(jsonb_build_object('branch_id',v_branch,'staff_profile_id',v_staff));
      begin v_at:=coalesce((p_payload->>'occurred_at')::timestamptz,now());
      exception when others then v_at:=now(); end;
      insert into fms_trigger_events(tenant_id,source_type,event_key,source_record_id,source_family_id,source_template_id,source_purpose,crm_client_id,crm_case_id,branch_id,staff_profile_id,payload,occurred_at)
      values(v_tenant,v_type,p_event_id,v_record,v_family,v_template,v_purpose,v_client,v_case,v_branch,v_staff,v_answers,v_at)
      on conflict(tenant_id,event_key) do nothing returning * into v_event;
      if v_event.id is null then select * into v_event from fms_trigger_events where tenant_id=v_tenant and event_key=p_event_id; end if;
      v_result:=fms_trigger_process_event(v_event.id);
    end if;
  end if;
  insert into crm_sync.inbox(event_id,event_type,aggregate_id,result) values(p_event_id,v_kind,coalesce(v_case,v_record),v_result);
  return v_result;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 7. Builder, monitoring and manual start RPCs (authenticated, audited where they write).
-- ---------------------------------------------------------------------------------------------
create function assert_fms_trigger_admin() returns user_profiles
language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles:=current_profile();
begin
  perform assert_module_enabled('fms_builder');
  if v_actor.id is null or not current_profile_is_active() or not has_permission('fms.manage') then
    raise exception 'FMS builder access denied' using errcode='42501';
  end if;
  return v_actor;
end $$;

-- Test panel: evaluates an unsaved trigger against sample answers. STABLE: it cannot write.
create function test_fms_start_trigger(p_flow_id uuid,p_trigger jsonb,p_answers jsonb) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles:=assert_fms_trigger_admin(); f fms_flows; types jsonb; ev jsonb; first_stage fms_stages; staff user_profiles; v_answers jsonb;
begin
  select * into f from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id;
  if f.id is null or not can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode='42501'; end if;
  if jsonb_typeof(p_trigger) is distinct from 'object' or jsonb_typeof(p_answers) is distinct from 'object' or pg_column_size(p_answers)>65536 then
    raise exception 'Invalid trigger test' using errcode='22023';
  end if;
  v_answers:=p_answers;
  select coalesce(jsonb_object_agg(s.field_key,s.field_type),'{}'::jsonb) into types from fms_trigger_source_fields(f.tenant_id,p_trigger->'source') s;
  ev:=fms_trigger_node_eval(p_trigger->'conditions',v_answers,types,(now() at time zone 'Asia/Kolkata')::date);
  select * into first_stage from fms_stages where fms_flow_id=f.id order by sort_order,id limit 1;
  if coalesce(v_answers->>'staff_profile_id',v_answers->>'submitted_by','')~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    staff:=fms_trigger_active_staff(f.tenant_id,coalesce(v_answers->>'staff_profile_id',v_answers->>'submitted_by')::uuid);
  end if;
  return jsonb_build_object(
    'matched',jsonb_typeof(ev->'r')='boolean' and (ev->>'r')::boolean,
    'rules',ev->'rules',
    'title',fms_trigger_title(p_trigger,v_answers,f.name),
    'context',fms_trigger_context(p_trigger,v_answers),
    'dueAt',fms_trigger_due(p_trigger,v_answers),
    'firstStage',case when first_stage.id is null then null else jsonb_build_object('key',first_stage.stage_key,'name',first_stage.name,'type',first_stage.step_type) end,
    'assignee',case when p_trigger#>>'{assignment,mode}'='source_staff' then
      case when staff.id is not null then jsonb_build_object('method','source_staff','name',staff.employee_name)
        when p_trigger#>>'{assignment,onUnresolved}'='review' then jsonb_build_object('method','review')
        else jsonb_build_object('method','stage_rules') end
      else jsonb_build_object('method','stage_rules') end);
end $$;

-- Recent events to load into the test panel. CRM answers need CRM access as well.
create function list_fms_trigger_samples(p_source jsonb,p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles:=assert_fms_trigger_admin(); v_limit integer:=greatest(1,least(coalesce(p_limit,10),20)); v_type text:=p_source->>'type'; result jsonb;
begin
  if v_type='jewelos_form' then
    if coalesce(p_source->>'formFamilyId','')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return '[]'::jsonb; end if;
    select coalesce(jsonb_agg(row order by row->>'at' desc),'[]'::jsonb) into result from (
      select jsonb_build_object('id',s.id,'at',s.submitted_at,'label',t.name||' v'||t.version,
        'answers',fms_trigger_form_answers(s.form_template_id,s.data)||jsonb_strip_nulls(jsonb_build_object('branch_id',s.branch_id,'submitted_by',s.submitted_by,
          'submitted_date',to_char(coalesce(s.submitted_at,now()) at time zone 'Asia/Kolkata','YYYY-MM-DD')))) row
      from form_submissions s join form_templates t on t.id=s.form_template_id
      where s.tenant_id=v_actor.tenant_id and t.family_id=(p_source->>'formFamilyId')::uuid and s.status='submitted'
        and (v_actor.user_role in ('super_admin','admin') or s.branch_id=v_actor.branch_id)
      order by s.submitted_at desc limit v_limit) x;
    return result;
  end if;
  if not has_permission('crm.view') then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(row order by row->>'at' desc),'[]'::jsonb) into result from (
    select jsonb_build_object('id',e.id,'at',e.occurred_at,'label',coalesce(e.payload->>'client_code',e.payload->>'reference_number','Saved '||to_char(e.occurred_at at time zone 'Asia/Kolkata','DD Mon HH24:MI')),'answers',e.payload) row
    from fms_trigger_events e
    where e.tenant_id=v_actor.tenant_id and e.source_type=v_type
      and (v_type<>'crm_linked_form' or (e.source_family_id::text=p_source->>'formFamilyId' and e.source_purpose=p_source->>'purpose'))
      and (v_actor.user_role in ('super_admin','admin') or e.branch_id=v_actor.branch_id)
    order by e.occurred_at desc limit v_limit) x;
  return result;
end $$;

-- Trigger history: one row per event and workflow version, no answers.
create function get_fms_trigger_history(p_filter jsonb default '{}'::jsonb,p_limit integer default 50,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles:=assert_fms_trigger_admin(); v_limit integer:=greatest(1,least(coalesce(p_limit,50),200)); v_offset integer:=greatest(0,coalesce(p_offset,0));
  v_outcome text:=nullif(p_filter->>'outcome',''); v_family uuid; rows jsonb; summary jsonb;
begin
  if coalesce(p_filter->>'familyId','')~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then v_family:=(p_filter->>'familyId')::uuid; end if;
  select coalesce(jsonb_agg(r order by r->>'receivedAt' desc,r->>'eventId'),'[]'::jsonb) into rows from (
    select jsonb_build_object('eventId',e.id,'sourceType',e.source_type,'receivedAt',e.received_at,'occurredAt',e.occurred_at,'eventStatus',e.status,
      'attempts',e.attempts,'flowId',f.id,'flowName',f.name,'flowVersion',v.flow_version,'familyId',v.flow_family_id,
      'outcome',coalesce(v.outcome,'no_workflow'),'detail',coalesce(v.detail,e.last_error),'instanceId',i.id,'referenceNumber',i.reference_number,
      'duplicateDelivery',false) r
    from fms_trigger_events e
    left join fms_trigger_evaluations v on v.event_id=e.id
    left join fms_flows f on f.id=v.fms_flow_id
    left join fms_instances i on i.id=v.fms_instance_id
    where e.tenant_id=v_actor.tenant_id and (v_family is null or v.flow_family_id=v_family)
      and (v_outcome is null or coalesce(v.outcome,'no_workflow')=v_outcome or (v_outcome='attention' and (v.outcome in ('review','failed') or e.status in ('review','failed'))))
      and (v_actor.user_role in ('super_admin','admin') or e.branch_id=v_actor.branch_id)
    order by e.received_at desc,e.id limit v_limit offset v_offset) x;
  select jsonb_build_object(
    'events7d',(select count(*) from fms_trigger_events e where e.tenant_id=v_actor.tenant_id and e.received_at>now()-interval '7 days'),
    'started7d',(select count(*) from fms_trigger_evaluations v where v.tenant_id=v_actor.tenant_id and v.outcome='started' and v.created_at>now()-interval '7 days'),
    'notMatched7d',(select count(*) from fms_trigger_evaluations v where v.tenant_id=v_actor.tenant_id and v.outcome='not_matched' and v.created_at>now()-interval '7 days'),
    'duplicates7d',(select count(*) from fms_trigger_evaluations v where v.tenant_id=v_actor.tenant_id and v.outcome='duplicate' and v.created_at>now()-interval '7 days'),
    'needsAttention',(select count(*) from fms_trigger_events e where e.tenant_id=v_actor.tenant_id and e.status in ('review','failed')),
    'lastEventAt',(select max(e.received_at) from fms_trigger_events e where e.tenant_id=v_actor.tenant_id)) into summary;
  return jsonb_build_object('rows',rows,'summary',summary);
end $$;

create function inspect_fms_trigger_event(p_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles:=assert_fms_trigger_admin(); e fms_trigger_events; result jsonb;
begin
  select * into e from fms_trigger_events where id=p_event_id and tenant_id=v_actor.tenant_id
    and (v_actor.user_role in ('super_admin','admin') or branch_id=v_actor.branch_id);
  if e.id is null then raise exception 'Trigger event not found' using errcode='P0002'; end if;
  select jsonb_build_object('eventId',e.id,'sourceType',e.source_type,'eventKey',e.event_key,'status',e.status,'attempts',e.attempts,
    'receivedAt',e.received_at,'occurredAt',e.occurred_at,'processedAt',e.processed_at,'lastError',e.last_error,
    'answers',case when e.source_type='jewelos_form' or has_permission('crm.view') then e.payload end,
    'crmClientId',case when has_permission('crm.view') then e.crm_client_id end,
    'evaluations',coalesce((select jsonb_agg(jsonb_build_object('flowId',v.fms_flow_id,'flowName',f.name,'flowVersion',v.flow_version,'outcome',v.outcome,
      'detail',v.detail,'rules',v.rule_results,'attempts',v.attempts,'instanceId',v.fms_instance_id,'referenceNumber',i.reference_number,'updatedAt',v.updated_at) order by f.name)
      from fms_trigger_evaluations v join fms_flows f on f.id=v.fms_flow_id left join fms_instances i on i.id=v.fms_instance_id where v.event_id=e.id),'[]'::jsonb))
  into result;
  return result;
end $$;

create function retry_fms_trigger_event_with_audit(p_event_id uuid) returns jsonb
language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles:=assert_fms_trigger_admin(); e fms_trigger_events; result jsonb;
begin
  select * into e from fms_trigger_events where id=p_event_id and tenant_id=v_actor.tenant_id
    and (v_actor.user_role in ('super_admin','admin') or branch_id=v_actor.branch_id) for update;
  if e.id is null then raise exception 'Trigger event not found' using errcode='P0002'; end if;
  if e.status not in ('review','failed','pending') then raise exception 'Only failed or waiting events can be retried' using errcode='23514'; end if;
  result:=fms_trigger_process_event(e.id);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
  values(v_actor.tenant_id,v_actor.id,'fms_trigger_event_retried','fms_trigger_events',e.id,jsonb_build_object('status',e.status,'attempts',e.attempts),result);
  return result;
end $$;

-- The work page: where an automatic run came from. The CRM client id only for CRM users.
create function get_fms_instance_trigger_source(p_instance_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_actor user_profiles:=current_profile(); src fms_instance_trigger_sources; e fms_trigger_events; i fms_instances; f fms_flows; vals jsonb;
begin
  if v_actor.id is null or not current_profile_is_active() or not can_read_fms_instance(p_instance_id) then
    raise exception 'FMS run not available' using errcode='42501';
  end if;
  select * into src from fms_instance_trigger_sources where fms_instance_id=p_instance_id;
  if src.fms_instance_id is null then return null; end if;
  select * into e from fms_trigger_events where id=src.event_id;
  select * into i from fms_instances where id=p_instance_id;
  select * into f from fms_flows where id=i.fms_flow_id;
  select coalesce(jsonb_agg(jsonb_build_object('label',m->>'label','value',i.context->>(m->>'key')) order by n),'[]'::jsonb) into vals
  from jsonb_array_elements(coalesce(f.start_trigger->'mapping','[]'::jsonb)) with ordinality x(m,n)
  where i.context ? (m->>'key');
  return jsonb_build_object('sourceType',src.source_type,'occurredAt',e.occurred_at,'receivedAt',e.received_at,'values',vals,
    'crmClientId',case when has_permission('crm.view') then src.crm_client_id end,
    'crmCaseId',case when has_permission('crm.view') then src.crm_case_id end,
    'caseOpen',src.released_at is null);
end $$;

-- Mode C: start a manual version without an intake form. Idempotent per submission key.
create function start_fms_manual_with_audit(p_flow_id uuid,p_title text,p_note text default null,p_client_code text default null,
  p_branch_id uuid default null,p_department_id uuid default null,p_first_assignee_id uuid default null,p_idempotency_key uuid default null)
returns table(instance_id uuid,reference_number text)
language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles:=current_profile(); v_flow fms_flows; v_instance fms_instances; v_ref text; v_first fms_stages; v_context jsonb;
  cached fms_workflow_mutation_keys; v_hash text;
begin
  perform assert_module_enabled('fms_builder');
  if v_actor.id is null or not current_profile_is_active() then raise exception 'Active profile required' using errcode='42501'; end if;
  if p_idempotency_key is null then raise exception 'A start key is required' using errcode='22023'; end if;
  v_hash:=md5(jsonb_build_object('flow',p_flow_id,'title',p_title,'note',p_note,'client',p_client_code,'branch',p_branch_id,'department',p_department_id,'assignee',p_first_assignee_id)::text);
  insert into fms_workflow_mutation_keys(tenant_id,actor_id,mutation_key,linked_module,linked_record_id,request_hash)
    values(v_actor.tenant_id,v_actor.id,p_idempotency_key,'fms_entry',p_flow_id,v_hash) on conflict(tenant_id,actor_id,mutation_key) do nothing;
  select * into cached from fms_workflow_mutation_keys where tenant_id=v_actor.tenant_id and actor_id=v_actor.id and mutation_key=p_idempotency_key for update;
  if cached.linked_record_id<>p_flow_id or cached.linked_module<>'fms_entry' or cached.request_hash is distinct from v_hash then
    raise exception 'This start key was already used for a different request' using errcode='23514';
  end if;
  select i.* into v_instance from fms_instances i where i.tenant_id=v_actor.tenant_id and i.started_by=v_actor.id and i.context->>'manual_start_key'=p_idempotency_key::text limit 1;
  if v_instance.id is not null then return query select v_instance.id,v_instance.reference_number; return; end if;
  select * into v_flow from fms_flows where id=p_flow_id and tenant_id=v_actor.tenant_id for share;
  if v_flow.id is null or v_flow.start_mode<>'manual' then raise exception 'This workflow is not started from the FMS list' using errcode='23514'; end if;
  p_branch_id:=coalesce(p_branch_id,v_flow.branch_id,v_actor.branch_id);
  p_department_id:=coalesce(p_department_id,v_flow.department_id,v_actor.department_id);
  if not can_start_fms_flow(p_flow_id,p_branch_id,p_department_id) then raise exception 'Flow start is outside authorized scope' using errcode='42501'; end if;
  if not exists(select 1 from branches b where b.id=p_branch_id and b.tenant_id=v_actor.tenant_id and b.is_active) then raise exception 'Choose an active branch for this workflow run' using errcode='23514'; end if;
  if not exists(select 1 from departments d where d.id=p_department_id and d.tenant_id=v_actor.tenant_id and d.is_active and (d.branch_id is null or d.branch_id=p_branch_id)) then raise exception 'Choose an active department available in this branch' using errcode='23514'; end if;
  if length(btrim(coalesce(p_title,''))) not between 1 and 200 or length(coalesce(p_note,''))>1000 or length(coalesce(p_client_code,''))>40 then
    raise exception 'Enter a title (up to 200 characters) and a short note' using errcode='22023';
  end if;
  v_context:=jsonb_strip_nulls(jsonb_build_object('note',nullif(btrim(p_note),''),'client_code',nullif(upper(btrim(p_client_code)),''),'manual_start_key',p_idempotency_key));
  v_ref:='FMS-'||to_char(clock_timestamp(),'YYYYMMDD')||'-'||lpad(nextval('fms_reference_sequence')::text,8,'0');
  perform set_config('jewelos.fms_start_path','manual',true);
  insert into fms_instances(tenant_id,branch_id,department_id,fms_flow_id,flow_family_id,flow_version,reference_number,title,status,priority,context,started_by)
  values(v_actor.tenant_id,p_branch_id,p_department_id,v_flow.id,v_flow.family_id,v_flow.version,v_ref,btrim(p_title),'active','medium',v_context,v_actor.id)
  returning * into v_instance;
  perform set_config('jewelos.fms_start_path','',true);
  update fms_flows set usage_count=usage_count+1 where id=v_flow.id;
  select * into v_first from fms_stages where fms_flow_id=v_flow.id order by sort_order,id limit 1;
  perform activate_fms_stage_internal(v_instance.id,v_first.id,null,p_first_assignee_id,0);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'fms_instance_started_manually','fms_instances',v_instance.id,
    jsonb_build_object('flow_id',v_flow.id,'version',v_flow.version,'reference_number',v_ref,'branch_id',p_branch_id,'department_id',p_department_id,'first_assignee_id',p_first_assignee_id));
  return query select v_instance.id,v_ref;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 8. Grants.
-- ---------------------------------------------------------------------------------------------
revoke all on function fms_flows_start_frozen(),fms_instance_start_path_guard(),fms_trigger_source_catalog(),fms_trigger_question_type(text,boolean),
  fms_trigger_source_fields(uuid,jsonb),fms_trigger_operators_for(text),fms_trigger_blank(jsonb),fms_trigger_lower(jsonb),fms_trigger_list(jsonb),
  fms_trigger_as_date(jsonb,date),fms_trigger_as_number(jsonb),fms_trigger_as_bool(jsonb),fms_trigger_rule_matches(text,jsonb,jsonb,text,date),
  fms_trigger_node_eval(jsonb,jsonb,jsonb,date),fms_trigger_value_text(jsonb),fms_trigger_context(jsonb,jsonb),fms_trigger_title(jsonb,jsonb,text),
  fms_trigger_due(jsonb,jsonb),fms_trigger_check_node(jsonb,integer,jsonb,jsonb,boolean),assert_fms_start_trigger_publishable(uuid),
  fms_trigger_events_immutable(),fms_trigger_release_case(),fms_trigger_case_key(fms_trigger_events,jsonb),fms_trigger_active_staff(uuid,uuid),
  fms_trigger_start_run(fms_flows,fms_trigger_events,text),fms_trigger_process_event(uuid),fms_trigger_has_listener(uuid,text,uuid,text),
  fms_trigger_form_answers(uuid,jsonb),fms_trigger_capture_form_submission(),fms_trigger_reconcile_crm_case(uuid,uuid,text,text),
  crm_sync_apply_submission_event(text,jsonb),assert_fms_trigger_admin()
  from public,anon,authenticated,service_role;
grant execute on function crm_sync_apply_submission_event(text,jsonb) to service_role;

revoke all on function set_fms_flow_start_with_audit(uuid,text,jsonb),test_fms_start_trigger(uuid,jsonb,jsonb),list_fms_trigger_samples(jsonb,integer),
  get_fms_trigger_history(jsonb,integer,integer),inspect_fms_trigger_event(uuid),retry_fms_trigger_event_with_audit(uuid),
  get_fms_instance_trigger_source(uuid),start_fms_manual_with_audit(uuid,text,text,text,uuid,uuid,uuid,uuid)
  from public,anon;
grant execute on function set_fms_flow_start_with_audit(uuid,text,jsonb),test_fms_start_trigger(uuid,jsonb,jsonb),list_fms_trigger_samples(jsonb,integer),
  get_fms_trigger_history(jsonb,integer,integer),inspect_fms_trigger_event(uuid),retry_fms_trigger_event_with_audit(uuid),
  get_fms_instance_trigger_source(uuid),start_fms_manual_with_audit(uuid,text,text,text,uuid,uuid,uuid,uuid)
  to authenticated;

notify pgrst,'reload schema';
