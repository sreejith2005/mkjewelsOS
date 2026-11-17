-- 0415: enquiry FMS steps are recorded as the sheet wrote them.
--
-- Owner, 2026-11-17: "only if we know what it is, we can write it." The FMS
-- tabs do not say how a stage was done: an introduction call may be a phone or
-- WhatsApp call, a demonstration may be in store, a video call or a WhatsApp
-- call, a negotiation anything. 0414 recorded stage 3 as a video call and the
-- other stages as outbound phone calls. Now:
--
--   * a stage contact's channel and direction are "not_recorded";
--   * a STATUS is read only where its own words say it:
--       YES (INTERESTED), INTERESTED FOLLOW-UP REQUIRED,
--       CLIENT REQUESTED ANOTHER VIDEO CALL ..., YES, THE CLIENT BOUGHT ...  -> positive
--       NOT INTERESTED CLOSE THIS LEAD, NO, THE CLIENT DID NOT BUY            -> negative
--       NOT REACHABLE, BUSY                                                    -> not reached
--     everything else, including NO, CUSTOMER DECLINED and ORDER CLOSE, is
--     kept exactly as written and read as neutral;
--   * an enquiry is won only by "YES, THE CLIENT BOUGHT THE PRODUCT"; ORDER
--     CLOSE no longer counts as won (a closed enquiry stays "closed").
--
-- Rows already imported are queued again so they follow the new rules.

alter table customer.interactions drop constraint interactions_channel_check;
alter table customer.interactions add constraint interactions_channel_check
  check (channel in ('call', 'video_call', 'whatsapp', 'instagram', 'instagram_ads', 'website', 'walk_in', 'exhibition', 'software', 'not_recorded'));
alter table customer.interactions drop constraint interactions_direction_check;
alter table customer.interactions add constraint interactions_direction_check
  check (direction in ('inbound', 'outbound', 'in_person', 'not_recorded'));

create or replace function customer.enquiry_status_reading(p_status text, out result text, out successful boolean, out ends text)
language sql immutable set search_path = '' as $$
  select r.result, r.successful, r.ends
    from (select upper(btrim(coalesce(p_status, ''))) as s) x
    cross join lateral (select
      case
        when x.s in ('YES (INTERESTED)', 'INTERESTED FOLLOW-UP REQUIRED', 'CLIENT REQUESTED ANOTHER VIDEO CALL TO VIEW MORE PRODUCTS',
                     'YES, THE CLIENT BOUGHT THE PRODUCT') then 'positive'
        when x.s in ('NOT INTERESTED CLOSE THIS LEAD', 'NO, THE CLIENT DID NOT BUY') then 'negative'
        when x.s in ('NOT REACHABLE', 'BUSY') then 'not_connected'
        else 'neutral' end as result,
      x.s not in ('NOT REACHABLE', 'BUSY') as successful,
      case
        when x.s = 'YES, THE CLIENT BOUGHT THE PRODUCT' then 'won'
        when x.s in ('NOT INTERESTED CLOSE THIS LEAD', 'NO, THE CLIENT DID NOT BUY') then 'lost' end as ends) r
$$;

do $patch$
declare
  body text; found integer; f regprocedure := 'customer.apply_enquiry_row(uuid)'::regprocedure;
  old_text constant text := E'      ''occurred_at'', v_done, ''channel'', case when v_stage_no = 3 then ''video_call'' else ''call'' end,\n      ''direction'', ''outbound'',';
  new_text constant text := E'      ''occurred_at'', v_done, ''channel'', ''not_recorded'',\n      ''direction'', ''not_recorded'',';
  old_note constant text := E'  -- Assumption to confirm with the owner: stage 3 (product demonstration) is a\n  -- video call; the other stages are phone calls.\n';
  new_note constant text := E'  -- The sheet does not say how a stage was done, so channel and direction are\n  -- recorded as not recorded.\n';
begin
  body := replace(pg_get_functiondef(f), E'\r', '');
  found := (length(body) - length(replace(body, old_text, ''))) / length(old_text);
  if found <> 1 then raise exception '0415: expected 1 match of the stage channel in apply_enquiry_row, found %', found; end if;
  body := replace(body, old_text, new_text);
  found := (length(body) - length(replace(body, old_note, ''))) / length(old_note);
  if found <> 1 then raise exception '0415: expected 1 match of the stage note in apply_enquiry_row, found %', found; end if;
  execute replace(body, old_note, new_note);
end $patch$;

revoke all on function customer.enquiry_status_reading(text) from public, anon, authenticated;
revoke all on function customer.apply_enquiry_row(uuid) from public, anon, authenticated;
grant execute on function customer.enquiry_status_reading(text) to service_role;
grant execute on function customer.apply_enquiry_row(uuid) to service_role;

-- Apply the imported rows again under the new rules. Nothing is duplicated:
-- every contact is keyed by its sheet row.
update customer.ingest_rows r set status = 'pending'
  from customer.source_tables t
 where t.source = r.source and t.importer = 'enquiry_fms' and r.status = 'applied';
