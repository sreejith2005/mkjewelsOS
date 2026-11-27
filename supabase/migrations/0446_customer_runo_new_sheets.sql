-- 0446: the new Runo sheets, call logs joined with interaction forms, one call once.
--
-- Owner, 2026-11-27:
-- * "LIVE RUNO INTERACTION_13-08-2026" is no longer fed by Runo. A formula now
--   copies the new sheet into it, so it keeps getting the same calls.
-- * "LIVE RUNO 26-11-2026" is the new live sheet: tab INTERACTION (the
--   interaction form, same headers as before) and tab CALL LOG (one row per
--   call Runo logs: callId, Phone, Call Start Date, Duration, Call Type, Call
--   Tag, Caller Name, Process Name).
-- * The old sheet also gets a "Call logs" tab (interaction-form headers plus
--   CALL STATUS and MONTH).
-- * A call log and an interaction form with the same callId are the same call:
--   show them together. Not every call has a form. The same call seen in two
--   sheets must not appear twice; it should say which sheets it is in.
--
-- How:
-- * One call is one interaction: source 'runo', external_ref = callId, whichever
--   sheet it comes from (interactions are unique on tenant + source +
--   external_ref). Both interaction-form tabs (runo, runo_live) write it with
--   the existing Runo importer. Both call-log tabs (runo_call_log,
--   runo_call_log_old) use the new runo_call_log importer, which only fills the
--   call facts (call_* columns) on that interaction, or creates a bare "call"
--   entry when no form exists yet. A form never loses its answers to a call log.
-- * The sheets a call is in are read from customer.ingest_rows (every stored
--   row keeps its interaction_id): the timeline and the interaction page list them.
-- * A row removed from one sheet no longer archives a call that another sheet
--   still has (remove_source_row hands the interaction to the remaining row).
-- * The old sheet (runo) keeps rows that disappear from it: it is now a copy,
--   and a formula change must never remove calls.
-- * The three new tabs start unscheduled: the owner probes them, then turns
--   them on (see the pull request).

-- ---------------------------------------------------------------------------
-- 1. Sources
-- ---------------------------------------------------------------------------
insert into customer.sources (source, source_rank, label) values
  ('runo_live', 2, 'Runo calling'),
  ('runo_call_log', 2, 'Runo call log'),
  ('runo_call_log_old', 2, 'Runo call log')
on conflict (source) do nothing;

alter table customer.source_tables drop constraint source_tables_importer_check;
alter table customer.source_tables add constraint source_tables_importer_check check (importer = any (array[
  'runo', 'runo_call_log', 'enquiry_fms', 'walkin', 'walkin_family', 'referral', 'not_bought_fms', 'references_calling', 'order_fms',
  'repair_fms', 'zoho', 'exhibition', 'exhibition_old', 'customer_data', 'master_sheet', 'wrong_number', 'dont_contact',
  'buyer_list', 'scot', 'chirayu_app', 'account_list', 'referral_list', 'contact_list']));

insert into customer.source_tables (source, table_name, label, importer, one_time, scheduled) values
  ('runo_live', 'sheet_runo_2611_interaction', 'Runo interactions (LIVE RUNO 26-11-2026)', 'runo', false, false),
  ('runo_call_log', 'sheet_runo_2611_call_log', 'Runo call log (LIVE RUNO 26-11-2026)', 'runo_call_log', false, false),
  ('runo_call_log_old', 'sheet_runo_call_logs_old', 'Runo call logs (LIVE RUNO INTERACTION_13-08-2026)', 'runo_call_log', false, false)
on conflict (source) do nothing;

update customer.source_tables
   set label = 'Runo interactions (LIVE RUNO INTERACTION_13-08-2026)', keep_rows_gone_from_sheet = true
 where source = 'runo';

insert into customer.identity_phone_columns (importer, header, ord) values
  ('runo_call_log', 'Phone', 1), ('runo_call_log', 'Mobile Number', 2)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Call facts on the interaction
-- ---------------------------------------------------------------------------
alter table customer.interactions
  add column has_interaction_form boolean not null default false,
  add column has_call_log boolean not null default false,
  add column call_started_at timestamptz,
  add column call_duration_seconds integer check (call_duration_seconds is null or call_duration_seconds >= 0),
  add column call_type text,
  add column call_tag text,
  add column call_status text,
  add column caller_name text;

-- Every Runo call imported so far came from an interaction form.
update customer.interactions set has_interaction_form = true where source in ('runo', 'runo_old');

-- customer.ingest_rows_interaction_idx (interaction_id) already exists.

-- The sheets one interaction is in (labels), for the timeline and the interaction page.
create function customer.interaction_sheets(p_interaction_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(distinct coalesce(st.label, s.label, r.source)), '[]'::jsonb)
    from customer.ingest_rows r
    left join customer.source_tables st on st.source = r.source
    left join customer.sources s on s.source = r.source
   where r.interaction_id = p_interaction_id and r.status <> 'removed';
$$;
revoke all on function customer.interaction_sheets(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Importers
-- ---------------------------------------------------------------------------
create function customer._patch_0446(p_function regprocedure, p_old text, p_new text, p_expected integer)
returns void language plpgsql as $$
declare body text; found integer;
begin
  body := replace(pg_get_functiondef(p_function), E'\r', '');
  found := (length(body) - length(replace(body, p_old, ''))) / length(p_old);
  if found <> p_expected then
    raise exception '0446: expected % match(es) of "%" in %, found %', p_expected, left(p_old, 80), p_function, found;
  end if;
  execute replace(body, p_old, p_new);
end $$;

-- The interaction form: the new sheet's INTERACTION tab is the same form, and
-- one call is one interaction whichever form tab it is in.
select customer._patch_0446('customer.apply_runo_row(uuid)'::regprocedure,
  $o$v_row.source not in ('runo', 'runo_old')$o$, $n$v_row.source not in ('runo', 'runo_old', 'runo_live')$n$, 1);
select customer._patch_0446('customer.apply_runo_row(uuid)'::regprocedure,
  $o$'purpose', v_purpose, 'source', v_row.source,$o$,
  $n$'purpose', v_purpose, 'source', case when v_row.source = 'runo_live' then 'runo' else v_row.source end,$n$, 1);
select customer._patch_0446('customer.apply_runo_row(uuid)'::regprocedure,
  $o$  update customer.interactions set assigned_by_name = p ->> 'Assigned By'
   where id = v_interaction and assigned_by_name is distinct from (p ->> 'Assigned By');$o$,
  $n$  update customer.interactions set assigned_by_name = p ->> 'Assigned By'
   where id = v_interaction and assigned_by_name is distinct from (p ->> 'Assigned By');
  update customer.interactions set has_interaction_form = true where id = v_interaction and not has_interaction_form;$n$, 1);

-- The call log: fills the call facts on the call's interaction, or records a
-- bare call when no interaction form has arrived (yet).
create function customer.apply_runo_call_log_row(p_ingest_row_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_row customer.ingest_rows; p jsonb; v_tenant uuid;
  v_call text; v_phone text; v_name text; v_started timestamptz; v_duration integer;
  v_type text; v_tag text; v_status text; v_caller text; v_inbound boolean;
  v_interaction uuid; v_client uuid;
begin
  select * into v_row from customer.ingest_rows where id = p_ingest_row_id for update;
  if v_row.id is null or not exists (select 1 from customer.source_tables where source = v_row.source and importer = 'runo_call_log') then
    raise exception 'Runo call log row not found' using errcode = '22023';
  end if;
  v_tenant := v_row.tenant_id;
  select coalesce(jsonb_object_agg(key, btrim(value)), '{}'::jsonb) into p
    from jsonb_each_text(v_row.payload) where btrim(coalesce(value, '')) <> '';

  v_call := p ->> 'callId';
  if v_call is null then raise exception 'callId is missing' using errcode = '22023'; end if;
  v_phone := coalesce(p ->> 'Phone', p ->> 'Mobile Number');
  v_name := coalesce(nullif(concat_ws(' ', p ->> 'Name', p ->> 'Last Name'), ''), p ->> 'Name');
  v_started := customer.parse_sheet_timestamp(coalesce(p ->> 'Call Start Date', p ->> 'Interaction Date'));
  v_duration := case when (p ->> 'Duration (in Sec)') ~ '^\d{1,7}(\.\d+)?$' then round((p ->> 'Duration (in Sec)')::numeric)::integer end;
  v_type := p ->> 'Call Type';
  v_tag := p ->> 'Call Tag';
  v_status := p ->> 'CALL STATUS';
  v_caller := coalesce(p ->> 'Caller Name', p ->> 'Assigned To');
  v_inbound := lower(coalesce(v_type, '')) ~ '(incoming|inbound|missed)';

  select id, client_id into v_interaction, v_client from customer.interactions
   where tenant_id = v_tenant and source = 'runo' and external_ref = v_call;

  if v_interaction is null then
    if v_started is null then raise exception 'Call Start Date is missing or unreadable' using errcode = '22007'; end if;
    if customer.normalize_phone(v_phone) is null and v_name is null then
      raise exception 'Phone and Name are missing' using errcode = '22023';
    end if;
    v_client := customer.resolve_client(v_tenant, v_phone, v_name, v_row.source, v_started, null, null,
                                        v_row.source || ':' || v_row.row_key, v_row.id);
    v_interaction := customer.record_interaction(v_client, jsonb_strip_nulls(jsonb_build_object(
      'occurred_at', v_started, 'channel', 'call', 'direction', case when v_inbound then 'inbound' else 'outbound' end,
      'purpose', 'other', 'source', 'runo', 'external_ref', v_call, 'source_row', v_row.id,
      'outcome', coalesce(v_status, v_tag, p ->> 'Status'),
      'result', case when coalesce(v_duration, 0) > 0 then 'neutral' else 'not_connected' end,
      'successful', coalesce(v_duration, 0) > 0,
      'staff_user_id', customer.resolve_staff(v_tenant, v_caller), 'staff_name', v_caller,
      'process_name', p ->> 'Process Name')));
  end if;

  update customer.interactions set
    has_call_log = true,
    call_started_at = coalesce(v_started, call_started_at),
    call_duration_seconds = coalesce(v_duration, call_duration_seconds),
    call_type = coalesce(v_type, call_type), call_tag = coalesce(v_tag, call_tag),
    call_status = coalesce(v_status, call_status), caller_name = coalesce(v_caller, caller_name),
    archived_at = case when archive_reason = 'removed_from_sheet' then null else archived_at end,
    archive_reason = case when archive_reason = 'removed_from_sheet' then null else archive_reason end,
    updated_at = now()
   where id = v_interaction;

  if p ? 'Customer Id' then
    insert into customer.client_identifiers (tenant_id, client_id, id_type, value, source, first_seen_at)
    values (v_tenant, v_client, 'runo_customer_id', p ->> 'Customer Id', v_row.source, coalesce(v_started, now())) on conflict do nothing;
  end if;

  update customer.ingest_rows
     set status = 'applied', reject_reason = null, removed_at = null, client_id = v_client, interaction_id = v_interaction,
         applied_at = now(), updated_at = now(), attempts = attempts + 1
   where id = v_row.id;
  return v_interaction;
end $$;
revoke all on function customer.apply_runo_call_log_row(uuid) from public, anon, authenticated;

select customer._patch_0446((select p.oid::regprocedure from pg_proc p where p.proname = 'customer_ingest_apply'),
  $o$        when 'runo' then perform customer.apply_runo_row(r.id);$o$,
  $n$        when 'runo' then perform customer.apply_runo_row(r.id);
        when 'runo_call_log' then perform customer.apply_runo_call_log_row(r.id);$n$, 1);

-- A row removed from one sheet: if another sheet still has the same call, the
-- call stays and that sheet's row becomes its row.
select customer._patch_0446('customer.remove_source_row(uuid)'::regprocedure,
  $o$  if v_row.interaction_id is not null
     and exists (select 1 from customer.interactions where id = v_row.interaction_id and source_row = v_row.id) then$o$,
  $n$  if v_row.interaction_id is not null then
    update customer.interactions i
       set source_row = (select o.id from customer.ingest_rows o
                          where o.interaction_id = v_row.interaction_id and o.id <> v_row.id and o.status <> 'removed'
                          order by o.updated_at desc limit 1)
     where i.id = v_row.interaction_id and i.source_row = v_row.id
       and exists (select 1 from customer.ingest_rows o
                    where o.interaction_id = v_row.interaction_id and o.id <> v_row.id and o.status <> 'removed');
    update customer.interactions i set has_call_log = false
     where i.id = v_row.interaction_id and i.has_call_log
       and exists (select 1 from customer.source_tables st where st.source = v_row.source and st.importer = 'runo_call_log')
       and not exists (select 1 from customer.ingest_rows o join customer.source_tables st on st.source = o.source and st.importer = 'runo_call_log'
                        where o.interaction_id = v_row.interaction_id and o.id <> v_row.id and o.status <> 'removed');
  end if;

  if v_row.interaction_id is not null
     and exists (select 1 from customer.interactions where id = v_row.interaction_id and source_row = v_row.id) then$n$, 1);

-- ---------------------------------------------------------------------------
-- 4. Reads: the call and its sheets on the timeline and the interaction page
-- ---------------------------------------------------------------------------
select customer._patch_0446('public.customer_get_timeline(uuid,integer,timestamptz)'::regprocedure,
  $o$      'branch', coalesce(b.name, i.store_name), 'fms_stage', i.fms_stage,$o$,
  $n$      'branch', coalesce(b.name, i.store_name), 'fms_stage', i.fms_stage,
      'has_interaction_form', i.has_interaction_form, 'sheets', customer.interaction_sheets(i.id),
      'call', case when i.has_call_log then jsonb_strip_nulls(jsonb_build_object('started_at', i.call_started_at,
                'duration_seconds', i.call_duration_seconds, 'type', i.call_type, 'tag', i.call_tag, 'status', i.call_status, 'caller', i.caller_name)) end,$n$, 1);

select customer._patch_0446('public.customer_get_interaction_page(text)'::regprocedure,
  $o$      'created_at', i.created_at, 'updated_at', i.updated_at, 'archived', i.archived_at is not null, 'archive_reason', i.archive_reason),$o$,
  $n$      'created_at', i.created_at, 'updated_at', i.updated_at, 'archived', i.archived_at is not null, 'archive_reason', i.archive_reason,
      'has_interaction_form', i.has_interaction_form, 'sheets', customer.interaction_sheets(i.id),
      'call', case when i.has_call_log then jsonb_strip_nulls(jsonb_build_object('started_at', i.call_started_at,
                'duration_seconds', i.call_duration_seconds, 'type', i.call_type, 'tag', i.call_tag, 'status', i.call_status, 'caller', i.caller_name)) end),
    'other_sheet_rows', (select coalesce(jsonb_agg(jsonb_build_object('source', r.source, 'label', coalesce(st.label, r.source),
                            'sheet_row', r.sheet_row, 'status', r.status) order by st.label, r.sheet_row), '[]'::jsonb)
                           from customer.ingest_rows r left join customer.source_tables st on st.source = r.source
                          where r.interaction_id = i.id and r.status <> 'removed' and r.id is distinct from i.source_row),$n$, 1);

drop function customer._patch_0446(regprocedure, text, text, integer);
