-- CRM three-tab workspace (owner request 2026-11-04): Dashboard, Client Queue, Client Database.
-- JewelOS side: supabase/migrations/0378_crm_branch_master_and_client_runs.sql.
--
-- 1. Queue intake never creates a second pending entry for the same client identity (the chosen
--    profile, or the one the phone resolves to) on the same business day (Asia/Kolkata) in the same
--    branch: create_entry_queue returns the existing pending row
--    with client_type 'pending_duplicate'. Signature unchanged; every caller (quick intake, linked
--    Form Builder intake, existing-client action) gets the guard. Later visits on other days, and
--    a new entry after the earlier one is completed, are still separate entries.
-- 2. Branch choices follow JewelOS Dropdown Master list 'crm_branch' (values are JewelOS branch
--    codes, resolved by JewelOS to stable branch ids before they travel). Identity and
--    authorization stay on public.branches; nothing is created from the list. A tenant whose
--    snapshot has no 'crm_branch' list yet keeps the active CRM branches and gets a visible
--    warning; list entries without a CRM branch are reported, never shown as choices.
-- 3. get_walkin_queue_page returns the CRM roster of every branch the reader may choose, so the
--    CRM NAME list follows the BRANCH choice at once. Root cause of the empty list: for a super
--    admin the page had no selected branch unless ?branch= was in the address (opening CRM from
--    the menu), so the roster read for "no branch" was empty. Roster health is reported to
--    managers: CRM-department people the JewelOS sync could not put on the roster, by reason.
-- 4. browse_crm_followups: an 'overdue' tab and count, the client's purchase history around each
--    Not Bought case (bought before / after the case's visit), and referral identifiers
--    (relationship, referrer client/household/referral codes, referred client code).
-- 5. get_crm_operations_summary_v1: the dashboard's operations cards, read as the asker (RLS).

-- 1. Same-day pending duplicate guard ------------------------------------------------------------
create or replace function public.create_entry_queue(p_client_name text, p_mobile text, p_branch_id uuid default null::uuid, p_assigned_crm_name text default null::text, p_client_id uuid default null::uuid)
 returns table(id uuid, token text, client_id uuid, client_code text, client_type text)
 language plpgsql
 set search_path to ''
as $function$
#variable_conflict use_column
DECLARE
  actor_role "public"."user_role"; own_branch uuid; target_branch uuid; phone_digits text;
  generated_token text; found_client uuid; found_client_code text; canonical_name text;
  assigned_crm text; created_client boolean := false;
  lock_key text; pending_entry "public"."entry_queue";
  today_start timestamptz := ((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date)::timestamp AT TIME ZONE 'Asia/Kolkata';
BEGIN
  actor_role := "public"."current_user_role"(); own_branch := "public"."current_user_branch_id"();
  IF actor_role IS NULL THEN RAISE EXCEPTION 'active CRM profile required' USING ERRCODE = 'insufficient_privilege'; END IF;
  target_branch := CASE WHEN actor_role = 'super_admin' THEN p_branch_id ELSE own_branch END;
  IF target_branch IS NULL OR (actor_role <> 'super_admin' AND NOT "public"."is_branch_staff"(target_branch)) OR NOT EXISTS (SELECT 1 FROM "public"."branches" WHERE branches.id = target_branch AND active) THEN RAISE EXCEPTION 'an active branch you may write to is required' USING ERRCODE = 'insufficient_privilege'; END IF;
  IF p_client_id IS NOT NULL THEN
    SELECT clients.client_id, clients.client_code, clients.primary_name, COALESCE(clients.primary_phone, '') INTO found_client, found_client_code, canonical_name, phone_digits FROM "public"."clients" WHERE clients.client_id = p_client_id;
    IF found_client IS NULL THEN RAISE EXCEPTION 'selected client is not available' USING ERRCODE = 'insufficient_privilege'; END IF;
    lock_key := found_client::text;
  ELSE
    phone_digits := crm_private.phone_key(p_mobile); canonical_name := trim(COALESCE(p_client_name, ''));
    IF length(canonical_name) = 0 OR phone_digits IS NULL THEN RAISE EXCEPTION 'client name and a valid phone number with country code are required' USING ERRCODE = 'check_violation'; END IF;
    lock_key := phone_digits;
  END IF;

  -- One pending entry per client identity, branch and business day. The identity is the chosen
  -- profile, or the profile the phone resolves to (phone + name identity, 2026-10-06), so two
  -- people who share a phone keep separate entries. Registrations of the same person wait for each
  -- other, and the phone is resolved after the wait, so two front-desk taps cannot both create one.
  PERFORM pg_advisory_xact_lock(hashtextextended('crm.queue.' || target_branch::text || ':' || lock_key, 0));
  IF p_client_id IS NULL THEN
    SELECT m.client_id INTO found_client FROM public.lookup_client_by_phone(crm_private.as_phone_input(phone_digits)) m;
  END IF;
  IF found_client IS NOT NULL THEN
    SELECT q.* INTO pending_entry FROM "public"."entry_queue" q
    WHERE q.branch_id = target_branch AND q.status = 'pending' AND q.created_at >= today_start AND q.client_id = found_client
    ORDER BY q.created_at DESC, q.id DESC LIMIT 1;
  END IF;
  IF pending_entry.id IS NOT NULL THEN
    PERFORM "crm_private"."write_audit_log"('crm.create_entry_queue_duplicate', pending_entry.id, jsonb_build_object('branch_id', target_branch, 'token', pending_entry.token, 'client_id', pending_entry.client_id));
    RETURN QUERY SELECT pending_entry.id, pending_entry.token::text, pending_entry.client_id,
      (SELECT c.client_code::text FROM "public"."clients" c WHERE c.client_id = pending_entry.client_id), 'pending_duplicate'::text;
    RETURN;
  END IF;

  IF p_client_id IS NULL THEN
    IF found_client IS NULL THEN
      INSERT INTO "public"."clients" (primary_name, primary_phone, last_branch_id)
      VALUES (canonical_name, crm_private.as_phone_input(phone_digits), target_branch)
      RETURNING clients.client_id, clients.client_code INTO found_client, found_client_code;
      created_client := true;
    ELSE
      SELECT clients.client_code INTO found_client_code FROM "public"."clients" WHERE clients.client_id = found_client;
    END IF;
  END IF;
  -- A client known only as a lead or referral registers as a new client (client identity, 2026-10-05).
  IF crm_private.engage_client(found_client) THEN created_client := true; END IF;
  assigned_crm := NULLIF("public"."normalize_crm_roster_value"(p_assigned_crm_name), '');
  IF assigned_crm IS NULL THEN assigned_crm := "public"."assign_next_available_crm"(target_branch); END IF;
  IF assigned_crm IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "public"."crm_allocation" allocation LEFT JOIN "public"."crm_daily_availability" availability ON availability.branch_id = allocation.branch_id AND "public"."normalize_crm_roster_value"(availability.crm_name) = "public"."normalize_crm_roster_value"(allocation.crm_name) AND availability.date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date WHERE allocation.branch_id = target_branch AND "public"."normalize_crm_roster_value"(allocation.crm_name) = assigned_crm AND allocation.active AND COALESCE(availability.is_available, true)) THEN RAISE EXCEPTION 'assigned CRM is not available for this branch today' USING ERRCODE = 'check_violation'; END IF;
  LOOP
    generated_token := upper(to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata', 'MMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 5));
    BEGIN INSERT INTO "public"."entry_queue" (token, client_name, mobile, branch_id, assigned_crm_name, status, client_id, client_is_new)
      VALUES (generated_token, canonical_name, crm_private.as_phone_input(phone_digits), target_branch, assigned_crm, 'pending', found_client, created_client) RETURNING entry_queue.id INTO id; EXIT;
    EXCEPTION WHEN unique_violation THEN END;
  END LOOP;
  PERFORM "crm_private"."write_audit_log"('crm.create_entry_queue', id, jsonb_build_object('client_id', found_client, 'branch_id', target_branch, 'token', generated_token, 'client_is_new', created_client));
  RETURN QUERY SELECT id, generated_token, found_client, found_client_code, CASE WHEN created_client THEN 'new' ELSE 'existing' END;
END;
$function$;

-- 2. Branch choices from Dropdown Master ---------------------------------------------------------
-- The reader's JewelOS tenant, as get_crm_master_options resolves it.
create function crm_private.reader_master_tenant() returns uuid
language sql stable security definer set search_path='' as $$
  select m.tenant_id from crm_private.master_members m
  join public.crm_sso_access_grants g on g.jewelos_user_id=m.jewelos_user_id
  where g.legacy_crm_user_id=public.current_crm_user_id() and g.active and m.active
  order by m.snapshot_at desc limit 1
$$;
revoke all on function crm_private.reader_master_tenant() from public,anon,authenticated,service_role;

-- Branches the reader may choose for queue intake: { source, branches[], issues[] }.
--   source 'dropdown_master'  the tenant's 'crm_branch' list decides (order and label from it);
--   source 'crm_branches'     the list has not reached CRM yet: active CRM branches, with a warning.
-- Non super admins only ever receive their own branch. Issues (list entries with no active CRM
-- branch) are returned to super admins and branch managers only.
create function public.get_walkin_branch_choices() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare
  actor_role public.user_role := public.current_user_role();
  own_branch uuid := public.current_user_branch_id();
  tenant uuid := crm_private.reader_master_tenant();
  configured boolean;
  result jsonb;
begin
  if public.current_crm_user_id() is null or actor_role is null then raise exception 'active CRM profile required' using errcode='42501'; end if;
  configured := tenant is not null and exists(select 1 from crm_private.master_options o where o.tenant_id=tenant and o.master_type='crm_branch');
  with choices as (
    select b.id,coalesce(nullif(btrim(o.label),''),b.name)::text as name,b.jewelos_branch_id,coalesce(o.sort_order,0) as sort_order
    from public.branches b
    left join crm_private.master_options o on configured and o.tenant_id=tenant and o.master_type='crm_branch' and o.active
      and o.value=b.jewelos_branch_id::text
    where b.active and (not configured or o.option_id is not null)
      and (actor_role='super_admin' or b.id=own_branch)
  )
  select jsonb_build_object(
    'source',case when configured then 'dropdown_master' else 'crm_branches' end,
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'jewelos_branch_id',c.jewelos_branch_id) order by c.sort_order,c.name,c.id) from choices c),'[]'::jsonb),
    'issues',case when actor_role in ('super_admin','branch_manager') then coalesce((
      select jsonb_agg(jsonb_build_object('label',o.label,'reason',case when o.value like 'unmapped:%' then 'no_jewelos_branch' else 'no_crm_branch' end) order by o.sort_order,o.label)
      from crm_private.master_options o
      where configured and o.tenant_id=tenant and o.master_type='crm_branch' and o.active
        and not exists(select 1 from public.branches b where b.active and b.jewelos_branch_id::text=o.value)),'[]'::jsonb) else '[]'::jsonb end
  ) into result;
  return result;
end $$;
revoke all on function public.get_walkin_branch_choices() from public,anon;
grant execute on function public.get_walkin_branch_choices() to authenticated,service_role;

-- Why a CRM-department person may be missing from the CRM NAME list (managers only). Counts only:
-- people without CRM access have no CRM identity and their JewelOS details stay in JewelOS.
create function public.get_walkin_roster_health() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor_role public.user_role := public.current_user_role(); tenant uuid := crm_private.reader_master_tenant(); result jsonb;
begin
  if public.current_crm_user_id() is null or actor_role is null then raise exception 'active CRM profile required' using errcode='42501'; end if;
  if actor_role not in ('super_admin','branch_manager') then return null; end if;
  select jsonb_build_object(
    'crm_department_people',(select count(*) from crm_private.staff_sync_state s where s.selection_department='crm'),
    'on_roster',(select count(distinct s.jewelos_user_id) from crm_private.staff_sync_state s
      join public.crm_allocation a on a.crm_user_id=s.crm_user_id and a.active where s.selection_department='crm'),
    'not_on_roster',coalesce((select jsonb_agg(jsonb_build_object('outcome',x.outcome,'reason',x.reason,'count',x.n) order by x.n desc,x.outcome)
      from (select s.outcome,coalesce(s.reason,'') as reason,count(*) as n from crm_private.staff_sync_state s
        where s.selection_department='crm' and not exists(select 1 from public.crm_allocation a where a.crm_user_id=s.crm_user_id and a.active)
        group by 1,2) x),'[]'::jsonb),
    'last_staff_sync_at',(select max(s.applied_at) from crm_private.staff_sync_state s),
    'master_snapshot_at',(select st.snapshot_at from crm_private.master_snapshot_state st where st.tenant_id=tenant)
  ) into result;
  return result;
end $$;
revoke all on function public.get_walkin_roster_health() from public,anon;
grant execute on function public.get_walkin_roster_health() to authenticated,service_role;

-- 3. Queue page: master branch choices, a default branch, the roster of every choosable branch ---
create or replace function public.get_walkin_queue_page(p_branch_id uuid default null::uuid, p_crm_name text default null::text, p_completed_client_id uuid default null::uuid, p_tab text default 'active'::text, p_offset integer default 0, p_limit integer default 50)
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
 set jit to 'off'
as $function$
declare
 actor uuid := public.current_crm_user_id();
 actor_role public.user_role := public.current_user_role();
 own_branch uuid := public.current_user_branch_id();
 choices jsonb;
 choosable uuid[];
 selected_branch uuid;
 selected_crm text;
 today date := (now() at time zone 'Asia/Kolkata')::date;
 result jsonb;
begin
 if actor is null or actor_role is null then raise exception 'active CRM profile required' using errcode='42501'; end if;
 choices := public.get_walkin_branch_choices();
 select coalesce(array_agg((b->>'id')::uuid),'{}') into choosable from jsonb_array_elements(choices->'branches') b;
 if actor_role = 'super_admin' then
   -- The requested branch when it is a choice; else the reader's own branch; else the only choice.
   selected_branch := case when p_branch_id = any(choosable) then p_branch_id
     when own_branch = any(choosable) then own_branch
     when cardinality(choosable)=1 then choosable[1] end;
 else selected_branch := own_branch;
 end if;
 select crm_name into selected_crm from public.get_walkin_crm_roster()
   where branch_id=selected_branch and active and crm_name=p_crm_name order by created_at,id limit 1;
 select jsonb_build_object(
   'actor_id',actor,'profile',(select to_jsonb(p) from public.get_my_profile() p),
   'own_branch_id',own_branch,'selected_branch_id',selected_branch,'selected_crm',coalesce(selected_crm,''),
   'branches',choices->'branches',
   'branch_source',choices->>'source',
   'branch_issues',choices->'issues',
   'allocation',coalesce((select jsonb_agg(jsonb_build_object('crm_name',a.crm_name) order by a.created_at,a.id) from public.get_walkin_crm_roster() a where a.branch_id=selected_branch and a.active),'[]'::jsonb),
   'availability',coalesce((select jsonb_agg(jsonb_build_object('crm_name',a.crm_name,'is_available',a.is_available)) from public.crm_daily_availability a where a.branch_id=selected_branch and a.date=today),'[]'::jsonb),
   -- Every choosable branch's CRM roster and today's availability, so the CRM NAME list follows
   -- the BRANCH choice without a reload. Unavailable people stay listed, marked unavailable.
   'roster_by_branch',coalesce((select jsonb_object_agg(r.branch_id,r.people) from (
      select a.branch_id,jsonb_agg(jsonb_build_object('crm_name',a.crm_name,'available',coalesce(d.is_available,true)) order by a.crm_name,a.id) as people
      from public.get_walkin_crm_roster() a
      left join public.crm_daily_availability d on d.branch_id=a.branch_id and d.date=today
        and public.normalize_crm_roster_value(d.crm_name)=public.normalize_crm_roster_value(a.crm_name)
      where a.active and a.branch_id=any(choosable) group by a.branch_id) r),'{}'::jsonb),
   'roster_health',public.get_walkin_roster_health(),
   -- Never let historical completed entries displace outstanding work at the REST row cap.
   'items',coalesce((select jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc) from (
     select id,token,client_name,mobile,assigned_crm_name,status,created_at,client_id,branch_id,client_is_new from public.entry_queue
     where branch_id=selected_branch and status=case when p_tab='recent' then 'complete' else 'pending' end and (selected_crm is null or assigned_crm_name=selected_crm)
     order by created_at desc,id desc offset greatest(p_offset,0) limit least(greatest(p_limit,1),50)) q),'[]'::jsonb),
   'total_count',(select count(*) from public.entry_queue where branch_id=selected_branch and status=case when p_tab='recent' then 'complete' else 'pending' end and (selected_crm is null or assigned_crm_name=selected_crm)),
   'completed_client_code',(select client_code from public.clients where client_id=p_completed_client_id),
   'fields',coalesce((select jsonb_agg(to_jsonb(f) order by f.display_order,f.id) from (
      select id,field_key,label,field_type,is_mandatory,is_hidden,display_order,is_runo_synced,runo_field_name,option_source from public.lead_form_fields) f),'[]'::jsonb),
   'options',coalesce((select jsonb_agg(to_jsonb(o) order by o.display_order,o.id) from (
      select id,field_id,option_value,display_order,triggers_field_key from public.get_crm_lead_option_routes()) o),'[]'::jsonb),
   'lookup_options',public.get_crm_master_options()
 ) into result;
 return result;
end $function$;
revoke all on function public.get_walkin_queue_page(uuid,text,uuid,text,integer,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_walkin_queue_page(uuid,text,uuid,text,integer,integer) to authenticated;

-- 4. Follow-up browser: overdue, purchase context, referral identifiers ---------------------------
-- Purchase-positive saved outcomes (the same family the insights dashboard counts as purchases).
create function crm_private.is_purchase_outcome(p_status text) returns boolean
language sql immutable set search_path='' as $$
  select coalesce(p_status in ('YES','YES_AND_ORDER_PLACED') or p_status like '%\_BUYING\_NEW\_PRODUCT' escape '\', false)
$$;
revoke all on function crm_private.is_purchase_outcome(text) from public,anon,authenticated,service_role;
grant execute on function crm_private.is_purchase_outcome(text) to authenticated;

do $$
declare body text; marker text;
begin
  body := pg_get_functiondef('public.browse_crm_followups(text,jsonb,integer,integer)'::regprocedure);
  marker := $m$when 'done' then is_done when 'pending' then not is_done$m$;
  if position(marker in body)=0 then raise exception 'followup tab contract changed'; end if;
  body := replace(body, marker, $m$when 'overdue' then not is_done and not is_historical and next_followup_date<today when 'done' then is_done when 'pending' then not is_done$m$);
  marker := $m$'done',count(*) filter(where f.is_done),$m$;
  if position(marker in body)=0 then raise exception 'followup counts contract changed'; end if;
  body := replace(body, marker, $m$'done',count(*) filter(where f.is_done),'overdue',count(*) filter(where not f.is_done and not f.is_historical and f.next_followup_date<today),$m$);
  marker := $m$'remark_history','','history','') as row from page_rows p$m$;
  if position(marker in body)=0 then raise exception 'followup row contract changed'; end if;
  body := replace(body, marker, $m$'remark_history','','history','')
 ||case when p_kind='not_bought' then jsonb_build_object('purchase_context',jsonb_build_object(
   'bought_before',exists(select 1 from public.client_timeline t where t.client_id=p.client_id and t.event_date<coalesce(p.visit_date,p.created_at) and crm_private.is_purchase_outcome(t.buy_status::text)),
   'bought_after',exists(select 1 from public.client_timeline t where t.client_id=p.client_id and t.event_date>coalesce(p.visit_date,p.created_at) and crm_private.is_purchase_outcome(t.buy_status::text))))
 else (select jsonb_build_object('referral_context',jsonb_build_object('relationship',nullif(btrim(rf.relationship),''),'best_time_to_call',nullif(btrim(rf.best_time_to_call),''),
   'given_by_client_code',gc.client_code,'given_by_household_code',gh.household_code,'given_by_referral_code',gc.referral_code,
   'referred_client_code',coalesce(cc.client_code,rc.client_code)))
   from public.referral_calling rcl join public.referrals rf on rf.id=rcl.referral_id
   left join public.clients gc on gc.client_id=rf.given_by_client_id left join public.households gh on gh.id=gc.household_id
   left join public.clients rc on rc.client_id=rf.referred_client_id left join public.clients cc on cc.client_id=rcl.converted_client_id
   where rcl.id=p.id) end as row from page_rows p$m$);
  execute body;
end $$;

-- 5. Operations summary for the dashboard --------------------------------------------------------
-- Period counts use [p_from, p_to] business dates in Asia/Kolkata; "current" counts ignore the
-- period (work outstanding now). Read as the asker, so RLS scopes every number.
create function public.get_crm_operations_summary_v1(p_branch_id uuid default null,p_from date default null,p_to date default null)
returns jsonb language plpgsql stable set search_path='' set jit=off as $$
declare
  today date := (statement_timestamp() at time zone 'Asia/Kolkata')::date;
  d_from date := coalesce(p_from,today); d_to date := coalesce(p_to,coalesce(p_from,today));
  t_from timestamptz; t_to timestamptz; result jsonb;
begin
  if public.current_user_role() is null then raise exception 'active CRM profile required' using errcode='42501'; end if;
  if d_to<d_from or d_to-d_from>366 then raise exception 'Choose 1 to 367 days' using errcode='22023'; end if;
  t_from := d_from::timestamp at time zone 'Asia/Kolkata'; t_to := (d_to+1)::timestamp at time zone 'Asia/Kolkata';
  with visits as (
    select t.buy_status::text as status from public.client_timeline t
    -- The same visit event types as get_crm_insights_v1 (crm_insights_rows_v1), so a card and its drill-down agree.
    where t.event_type::text in ('UPSALE_VISIT','READY_PRODUCT_PURCHASE','ORDER_PLACED_VISIT','ORDER_PICKUP_VISIT','REPAIR_PLACED_VISIT','REPAIR_PICKUP_VISIT','PRODUCT_RETURN_VISIT','PRODUCT_EXCHANGE_VISIT','NON_PURCHASE_VISIT','STORE_VISIT','PRICE_CALCULATION_VISIT','VISIT')
      and t.event_date>=t_from and t.event_date<t_to and (p_branch_id is null or t.branch_id=p_branch_id)
  ), cases as (
    select f.status,f.next_followup_date,f.followup_count,public.crm_queue_tab(f.status,f.next_followup_date,f.followup_count,'done',today,false) as is_done,
      upper(btrim(f.status))='HISTORICAL' as is_historical
    from public.not_bought_followups f where p_branch_id is null or f.branch_id=p_branch_id
  ), refs as (
    select rc.status,rc.followup_count,rc.converted_client_id,public.crm_queue_tab(rc.status,rc.next_followup_date,rc.followup_count,'done',today,false) as is_done
    from public.referral_calling rc join public.referrals r on r.id=rc.referral_id where p_branch_id is null or r.branch_id=p_branch_id
  )
  select jsonb_build_object(
    'from',d_from,'to',d_to,'today',today,'generated_at',statement_timestamp(),
    'queue_pending',(select count(*) from public.entry_queue q where q.status='pending' and (p_branch_id is null or q.branch_id=p_branch_id)),
    'queue_registered',(select count(*) from public.entry_queue q where q.created_at>=t_from and q.created_at<t_to and (p_branch_id is null or q.branch_id=p_branch_id)),
    'walkin_forms_completed',(select count(*) from public.entry_queue q where q.status='complete' and q.full_form_timestamp>=t_from and q.full_form_timestamp<t_to and (p_branch_id is null or q.branch_id=p_branch_id)),
    'store_visits',(select count(*) from visits),
    'visits_with_outcome',(select count(*) from visits where status is not null),
    'purchase_visits',(select count(*) from visits where crm_private.is_purchase_outcome(status)),
    'not_bought_visits',(select count(*) from visits where status='NO'),
    'new_leads',(select count(*) from public.leads l where l.created_at>=t_from and l.created_at<t_to and (p_branch_id is null or l.branch_id=p_branch_id)),
    'followups_open',(select count(*) from cases where not is_done and not is_historical),
    -- Same rule as the Not Bought "Due today" tab (crm_queue_tab 'today'): due today, overdue or undated.
    'followups_due_now',(select count(*) from cases where not is_done and not is_historical and (next_followup_date is null or next_followup_date<=today)),
    'followups_overdue',(select count(*) from cases where not is_done and not is_historical and next_followup_date<today),
    'followup_contacts',(select count(*) from public.not_bought_history h join public.not_bought_followups f on f.id=h.followup_id
      where h.updated_by is not null and h.created_at>=t_from and h.created_at<t_to and (p_branch_id is null or f.branch_id=p_branch_id)),
    'followups_recovered',(select count(*) from public.not_bought_history h join public.not_bought_followups f on f.id=h.followup_id
      where upper(btrim(h.status))='ALREADY PURCHASED FROM MK JEWELS' and coalesce(upper(btrim(h.previous_status)),'')<>'ALREADY PURCHASED FROM MK JEWELS'
        and h.created_at>=t_from and h.created_at<t_to and (p_branch_id is null or f.branch_id=p_branch_id)),
    'referrals_active',(select count(*) from refs where not is_done),
    'referrals_pending_outreach',(select count(*) from refs where not is_done and followup_count=0),
    'referrals_converted',(select count(*) from refs where converted_client_id is not null or status='CONVERTED TO CLIENT')
  ) into result;
  return result;
end $$;
revoke all on function public.get_crm_operations_summary_v1(uuid,date,date) from public,anon;
grant execute on function public.get_crm_operations_summary_v1(uuid,date,date) to authenticated;

notify pgrst,'reload schema';
