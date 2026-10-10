-- JewelOS owns configurable options. This private projection has no CRM editor.
create table crm_private.master_snapshot_state(tenant_id uuid primary key,snapshot_at timestamptz not null);
create table crm_private.master_members(jewelos_user_id uuid primary key,tenant_id uuid not null,snapshot_at timestamptz not null,active boolean not null default true);
create table crm_private.master_options(
 tenant_id uuid not null,option_id uuid not null,master_type text not null,label text not null,value text not null,
 sort_order integer not null,active boolean not null,primary key(tenant_id,option_id)
);
alter table crm_private.master_snapshot_state enable row level security;
alter table crm_private.master_members enable row level security;
alter table crm_private.master_options enable row level security;
create index master_options_type on crm_private.master_options(tenant_id,master_type,active,sort_order);
revoke all on crm_private.master_snapshot_state,crm_private.master_members,crm_private.master_options from public,anon,authenticated,service_role;

create function public.crm_apply_master_snapshot(p_event_id text,p_snapshot jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare tenant uuid; at_time timestamptz; previous timestamptz; result jsonb;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'Service role required' using errcode='42501'; end if;
 if p_event_id is null or p_event_id !~ '^[A-Za-z0-9_.:-]{1,160}$' or jsonb_typeof(p_snapshot) is distinct from 'object'
  or jsonb_typeof(p_snapshot->'options') is distinct from 'array' or jsonb_typeof(p_snapshot->'members') is distinct from 'array'
  or jsonb_array_length(p_snapshot->'options')>10000 or jsonb_array_length(p_snapshot->'members')>10000 then
  raise exception 'Invalid master snapshot' using errcode='22023'; end if;
 tenant:=(p_snapshot->>'tenant_id')::uuid;at_time:=(p_snapshot->>'snapshot_at')::timestamptz;
 if tenant is null or at_time is null or at_time>now()+interval '5 minutes' then raise exception 'Invalid master snapshot' using errcode='22023'; end if;
 -- Serialize snapshots for a tenant, including its first snapshot.
 perform pg_advisory_xact_lock(hashtextextended('crm.master.'||tenant,0));
 select s.result||'{"duplicate":true}'::jsonb into result from crm_private.sync_inbox s where event_id=p_event_id;
 if result is not null then return result; end if;
 select snapshot_at into previous from crm_private.master_snapshot_state where tenant_id=tenant;
 if previous is not null and previous>=at_time then result:='{"outcome":"stale"}'::jsonb;
 else
  if exists(select 1 from jsonb_array_elements(p_snapshot->'options') o where jsonb_typeof(o) is distinct from 'object'
    or coalesce(o->>'master_type','') !~ '^[a-z][a-z0-9_]{0,79}$'
    or length(btrim(coalesce(o->>'label',''))) not between 1 and 160
    or length(coalesce(o->>'value','')) not between 1 and 160 or jsonb_typeof(o->'active') is distinct from 'boolean'
    or jsonb_typeof(o->'sort_order') is distinct from 'number') then raise exception 'Invalid master option' using errcode='22023'; end if;
  delete from crm_private.master_options where tenant_id=tenant;
  insert into crm_private.master_options(tenant_id,option_id,master_type,label,value,sort_order,active)
  select tenant,(o->>'id')::uuid,o->>'master_type',btrim(o->>'label'),o->>'value',(o->>'sort_order')::integer,(o->>'active')::boolean
    from jsonb_array_elements(p_snapshot->'options') o;
  update crm_private.master_members m set active=false,snapshot_at=at_time where m.tenant_id=tenant and m.snapshot_at<=at_time
    and not exists(select 1 from jsonb_array_elements_text(p_snapshot->'members') member where member::uuid=m.jewelos_user_id);
  insert into crm_private.master_members(jewelos_user_id,tenant_id,snapshot_at,active)
  select member::uuid,tenant,at_time,true from jsonb_array_elements_text(p_snapshot->'members') member
  on conflict(jewelos_user_id) do update set tenant_id=excluded.tenant_id,snapshot_at=excluded.snapshot_at,active=true
    where master_members.snapshot_at<excluded.snapshot_at;
  insert into crm_private.master_snapshot_state values(tenant,at_time) on conflict(tenant_id) do update set snapshot_at=excluded.snapshot_at;
  result:=jsonb_build_object('outcome','applied','options',jsonb_array_length(p_snapshot->'options'));
  perform crm_private.write_audit_log('crm.master_options_synced',tenant,result);
 end if;
 insert into crm_private.sync_inbox(event_id,event_type,aggregate_id,result) values(p_event_id,'master.options_changed',tenant,result);
 return result;
end $$;

create function public.get_crm_master_options() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid; result jsonb;
begin
 if public.current_crm_user_id() is null or public.current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501'; end if;
 select m.tenant_id into tenant from crm_private.master_members m join public.crm_sso_access_grants g on g.jewelos_user_id=m.jewelos_user_id
 where g.legacy_crm_user_id=public.current_crm_user_id() and g.active and m.active;
 if tenant is null then raise exception 'CRM Dropdown Master sync is not ready. Ask an administrator to run master sync.' using errcode='55000'; end if;
 with mapped as (
  select o.*,unnest(case master_type
   when 'beverage' then array['lookup_beverages','beverage'] when 'sugar_option' then array['lookup_sugar_options','sugar']
   when 'snack_option' then array['lookup_snacks','snack'] when 'gift_option' then array['lookup_gifts','gift']
   when 'caste' then array['lookup_communities','community'] when 'client_relation' then array['lookup_relations','relation']
   when 'crm_source' then array['lookup_source_of_leads']
   when 'product_category' then array['lookup_product_categories','product_category']
   when 'not_bought_reason' then array['lookup_not_bought_reasons','not_bought_reason']
   when 'potential_category' then array['client_potential_category','potential_category']
   else array[case when master_type like 'lead\_%' escape '\' then substring(master_type from 6) else master_type end] end) as option_key
  from crm_private.master_options o where o.tenant_id=tenant and o.active
 ), groups as (
  -- Original CRM stores normalized uppercase lookup labels. Master stable values
  -- remain preserved in the projection for rename/deactivation provenance.
  select option_key,jsonb_agg(label order by sort_order,option_id) as labels from (
   select distinct on(option_key,upper(label)) option_key,case when master_type='potential_category' then label else upper(label) end as label,sort_order,option_id
    from mapped order by option_key,upper(label),sort_order,option_id
  ) m group by option_key
 ) select coalesce(jsonb_object_agg(option_key,labels),'{}'::jsonb) into result from groups;
 return result;
end $$;
revoke all on function public.crm_apply_master_snapshot(text,jsonb),public.get_crm_master_options() from public,anon,authenticated,service_role;
grant execute on function public.crm_apply_master_snapshot(text,jsonb) to service_role;
grant execute on function public.get_crm_master_options() to authenticated;

-- Replace only the snapshot's configurable option source; preserve its queue,
-- permissions, roster, pending work and all other response keys.
do $$
declare body text; old_part text;
begin
 body:=pg_get_functiondef('public.get_walkin_queue_snapshot(uuid,text,uuid)'::regprocedure);
 old_part:=substring(body from $re$'lookup_options',jsonb_build_object\([\s\S]*?'lookup_gifts',[\s\S]*?\n\s*\)$re$);
 if old_part is null then raise exception 'Unexpected queue snapshot definition'; end if;
 body:=replace(body,old_part,$replacement$'lookup_options',public.get_crm_master_options()$replacement$);
 execute body;
end $$;

-- Validate configured lead choices against the same tenant projection used by
-- the renderer, including dynamic lead_<field_key> master categories.
create function crm_private.validate_lead_master_options() returns trigger
language plpgsql security definer set search_path='' as $$
declare options jsonb; f public.lead_form_fields; choices jsonb; selected_value text;
begin
 -- Historical/system imports retain their original evidence. Browser writes and
 -- the audited save both have an active CRM actor and are validated here.
 if public.current_crm_user_id() is null then return new; end if;
 for f in select * from public.lead_form_fields where field_type='dropdown' and not is_hidden loop
  selected_value:=new.field_values->>f.field_key;
  if nullif(btrim(selected_value),'') is null then continue; end if;
  if tg_op='UPDATE' and selected_value is not distinct from old.field_values->>f.field_key then continue; end if;
  if options is null then options:=public.get_crm_master_options(); end if;
  choices:=options->coalesce(f.option_source,f.field_key);
  if not exists(select 1 from jsonb_array_elements_text(coalesce(choices,'[]'::jsonb)) as choice(option_value) where upper(btrim(selected_value))=upper(btrim(choice.option_value))) then
   raise exception 'Choose an active value from JewelOS Dropdown Master' using errcode='22023'; end if;
 end loop;
 return new;
end $$;
create trigger leads_validate_master_options before insert or update of field_values on public.leads
for each row execute function crm_private.validate_lead_master_options();
revoke all on function crm_private.validate_lead_master_options() from public,anon,authenticated,service_role;

-- The form's durable conditional routing still uses its configured option triggers;
-- active values themselves are validated by the master trigger above.
do $$
declare body text;
begin
 body:=pg_get_functiondef('public.save_crm_lead(text,text,jsonb)'::regprocedure);
 body:=replace(body,'o.option_value=p_fields->>configured.field_key','upper(o.option_value)=upper(p_fields->>configured.field_key)');
 body:=regexp_replace(body,$re$    if f.field_type='dropdown' and f.option_source is null[\s\S]*?end if;$re$,'');
 execute body;
end $$;

-- The same master authority applies to changed profile preferences. Retained
-- values and private lead contributions remain valid historical evidence.
create function crm_private.assert_master_choice(p_key text,p_value text,p_saved text default null) returns void
language plpgsql security definer set search_path='' as $$
declare choices jsonb;
begin
 if nullif(btrim(p_value),'') is null or p_value is not distinct from p_saved or public.current_crm_user_id() is null or auth.role()='service_role' then return; end if;
 choices:=public.get_crm_master_options()->p_key;
 if not exists(select 1 from jsonb_array_elements_text(coalesce(choices,'[]'::jsonb)) choice(v) where upper(btrim(choice.v))=upper(btrim(p_value))) then
  raise exception 'Choose an active % value from JewelOS Dropdown Master',p_key using errcode='22023';
 end if;
end $$;
create function crm_private.validate_client_master_options() returns trigger
language plpgsql security definer set search_path='' as $$
declare k text; prior text; candidate text; option_key text;
begin
 for k,option_key in select * from (values
  ('gender','gender'),('community','lookup_communities'),('beverage','lookup_beverages'),('sugar','lookup_sugar_options'),
  ('snack','lookup_snacks'),('communication_preference','communication_preference'),('client_potential_category','client_potential_category')) mapping loop
  prior:=case when tg_op='UPDATE' then to_jsonb(old)->>k else null end;
  candidate:=to_jsonb(new)->>k;
  if exists(select 1 from crm_private.lead_profile_contributions p where p.client_id=new.client_id and p.field_key=k and p.applied and p.value=to_jsonb(candidate)) then continue; end if;
  perform crm_private.assert_master_choice(option_key,candidate,prior);
 end loop;
 for k in select unnest(array['last_seen_categories','last_bought_categories','last_order_categories']) loop
  for candidate in select jsonb_array_elements_text(coalesce(to_jsonb(new)->k,'[]'::jsonb)) loop
   prior:=case when tg_op='UPDATE' and coalesce(to_jsonb(old)->k,'[]'::jsonb) ? candidate then candidate end;
   perform crm_private.assert_master_choice('lookup_product_categories',candidate,prior);
  end loop;
 end loop;
 return new;
end $$;
create trigger clients_validate_master_options before insert or update on public.clients for each row execute function crm_private.validate_client_master_options();
-- Potential labels are now master-backed; retain the original system/import
-- guard while authorized browser values are checked by the trigger above.
create or replace function public.validate_client_potential_category() returns trigger
language plpgsql set search_path='' as $$
begin
 if public.current_crm_user_id() is not null or new.client_potential_category is null
  or (tg_op='UPDATE' and new.client_potential_category is not distinct from old.client_potential_category)
  or new.client_potential_category in ('Cold Lead','Cool Lead','Warm Lead','Hot Lead','VIP Lead') then return new; end if;
 raise exception 'Invalid imported client potential category' using errcode='23514';
end $$;
revoke all on function crm_private.assert_master_choice(text,text,text),crm_private.validate_client_master_options() from public,anon,authenticated,service_role;

-- Validate visit-only choices at the database boundary, including direct API
-- writes. This trigger retains the invoker walk-in RPC and its existing RLS.
create function crm_private.validate_visit_master_options() returns trigger
language plpgsql security definer set search_path='' as $$
declare previous public.visit_forms; t public.client_timeline; k text; option_key text; candidate text; prior text; category text;
begin
 select * into t from public.client_timeline where id=new.client_timeline_id;
 if tg_op='UPDATE' then previous:=old;
 else select f.* into previous from public.visit_forms f join public.client_timeline v on v.id=f.client_timeline_id
  where v.client_id=t.client_id and f.id<>new.id order by v.event_date desc,v.id desc limit 1; end if;
 for k,option_key in select * from (values ('occupation','occupation'),('bridal_or_non_bridal','bridal_or_non_bridal'),
  ('communication_preference','communication_preference'),('source_of_lead','lookup_source_of_leads')) mapping loop
  perform crm_private.assert_master_choice(option_key,to_jsonb(new)->>k,to_jsonb(previous)->>k);
 end loop;
 if new.wedding_month is not null then
  perform crm_private.assert_master_choice('wedding_month',upper(to_char(make_date(2026,new.wedding_month,1),'FMMonth')),
   case when new.wedding_month=previous.wedding_month then upper(to_char(make_date(2026,new.wedding_month,1),'FMMonth')) end);
 end if;
 for candidate in select jsonb_array_elements_text(coalesce(to_jsonb(new.not_bought_reasons),'[]'::jsonb)) loop
  perform crm_private.assert_master_choice('lookup_not_bought_reasons',candidate,case when candidate=any(previous.not_bought_reasons) then candidate end);
 end loop;
 perform crm_private.assert_master_choice('lookup_gifts',new.additional_fields->>'gift',previous.additional_fields->>'gift');
 for candidate in select item->>'relation' from jsonb_array_elements(coalesce(new.companions,'[]'::jsonb)) item loop
  prior:=case when exists(select 1 from jsonb_array_elements(coalesce(previous.companions,'[]'::jsonb)) item where item->>'relation'=candidate) then candidate end;
  perform crm_private.assert_master_choice('lookup_relations',candidate,prior);
 end loop;
 for k in select unnest(array['came_for_categories','new_things_categories','categories_client_wants_more']) loop
  for candidate in select jsonb_array_elements_text(coalesce(new.additional_fields->k,'[]'::jsonb)) loop
   prior:=case when coalesce(previous.additional_fields->k,'[]'::jsonb) ? candidate then candidate end;
   perform crm_private.assert_master_choice('lookup_product_categories',candidate,prior);
  end loop;
 end loop;
 return new;
end $$;
create trigger visit_forms_validate_master_options before insert or update on public.visit_forms for each row execute function crm_private.validate_visit_master_options();
revoke all on function crm_private.validate_visit_master_options() from public,anon,authenticated,service_role;

-- Conditional routes resolve active labels through stable master values.
create function public.get_crm_lead_option_routes()
returns table(id uuid,field_id uuid,option_value text,display_order integer,triggers_field_key text)
language plpgsql stable security definer set search_path='' as $$
declare tenant uuid;
begin
 perform public.get_crm_master_options();
 select m.tenant_id into tenant from crm_private.master_members m join public.crm_sso_access_grants g on g.jewelos_user_id=m.jewelos_user_id
 where g.legacy_crm_user_id=public.current_crm_user_id() and g.active and m.active;
 return query
 select o.id,o.field_id,upper(m.label),o.display_order,o.triggers_field_key
 from public.lead_form_field_options o join public.lead_form_fields f on f.id=o.field_id
 join crm_private.master_options m on m.tenant_id=tenant and m.active
  and m.master_type='lead_'||f.field_key
  and (upper(o.option_value)=upper(m.label) or regexp_replace(lower(o.option_value),'[^a-z0-9]','','g')=regexp_replace(lower(m.value),'[^a-z0-9]','','g'))
 union all select o.id,o.field_id,o.option_value,o.display_order,o.triggers_field_key from public.lead_form_field_options o;
end $$;
revoke all on function public.get_crm_lead_option_routes() from public,anon,authenticated,service_role;
grant execute on function public.get_crm_lead_option_routes() to authenticated;
do $$
declare body text;
begin
 body:=pg_get_functiondef('public.save_crm_lead(text,text,jsonb)'::regprocedure);
 if position('from public.lead_form_field_options o' in body)=0 then raise exception 'Unexpected lead routing contract'; end if;
 body:=replace(body,'from public.lead_form_field_options o','from public.get_crm_lead_option_routes() o');
 execute body;
end $$;

-- The opening 'Who are you registering?' route uses this same configuration.
do $$
declare body text; marker text:='select id,field_id,option_value,display_order,triggers_field_key from public.lead_form_field_options';
begin
 body:=pg_get_functiondef('public.get_walkin_queue_snapshot(uuid,text,uuid)'::regprocedure);
 if position(marker in body)=0 then raise exception 'Unexpected queue lead routing contract'; end if;
 body:=replace(body,marker,'select id,field_id,option_value,display_order,triggers_field_key from public.get_crm_lead_option_routes()');
 execute body;
end $$;
