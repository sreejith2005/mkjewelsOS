-- Every JewelOS form adds to the client's history automatically (owner request 2026-11-04).
--
-- JewelOS 0376 sends a submitted form that holds a client's phone number with an automatic
-- "history only" mapping (descriptor.automatic): the phone number identifies the client and
-- every other answer is history. Here:
-- 1. Such a mapping is approved when it is registered, provided it really is history only
--    (one identity question to primary_phone, every other question history). Mappings that
--    authors build in Customer Integration still need a CRM super admin's approval.
-- 2. An automatic event never creates a client: with no registered client or lead holding that
--    number (or any other identity doubt, or a branch the person may not write to) it is
--    skipped and reported as rejected with the reason, not put in the identity review queue.
-- 3. An automatic event never changes the client's profile; its answers are kept in the
--    client's history (Customer journey) exactly like other form events.
set search_path=public,extensions;

-- An automatic mapping that only identifies the client by phone and keeps every other answer as history.
create function crm_private.is_automatic_history_mapping(p_descriptor jsonb) returns boolean
language sql immutable set search_path='' as $$
  select coalesce((p_descriptor->>'automatic')::boolean,false)
    and coalesce(p_descriptor->>'identityField','')<>''
    and jsonb_typeof(p_descriptor->'fields')='array'
    and (select count(*) from jsonb_array_elements(p_descriptor->'fields') f where f->>'mode'='profile')=1
    and not exists(select 1 from jsonb_array_elements(p_descriptor->'fields') f
      where f ? 'contactConfirmedValues'
         or not ((f->>'mode'='history' and f->>'destination'='note')
              or (f->>'mode'='profile' and f->>'destination'='primary_phone' and f->>'fieldKey'=p_descriptor->>'identityField')))
$$;
revoke all on function crm_private.is_automatic_history_mapping(jsonb) from public,anon,authenticated,service_role;

do $$
declare definition text; amended text;
begin
  -- 1. Automatic history mappings are approved on registration.
  definition:=pg_get_functiondef('public.crm_register_customer_mapping(uuid,jsonb,text)'::regprocedure);
  amended:=replace(definition,
    $m$if existing.mapping_id is null then insert into crm_private.customer_mapping_registry(mapping_id,tenant_id,descriptor,digest) values(p_mapping_id,t,p_descriptor,p_digest);end if;$m$,
    $m$if existing.mapping_id is null then insert into crm_private.customer_mapping_registry(mapping_id,tenant_id,descriptor,digest) values(p_mapping_id,t,p_descriptor,p_digest);end if;
 if existing.approved_at is null and crm_private.is_automatic_history_mapping(p_descriptor) then
  update crm_private.customer_mapping_registry set approved_at=clock_timestamp() where mapping_id=p_mapping_id;
  existing.approved_at:=clock_timestamp();
  perform crm_private.write_audit_log('crm.customer_mapping_auto_approved',p_mapping_id,jsonb_build_object('form',p_descriptor->>'formName','template_id',p_descriptor->>'templateId'));
 end if;$m$);
  if amended=definition then raise exception 'Review mapping registration markers'; end if;
  execute amended;

  -- 2 and 3. Automatic events attach to existing clients only, and only add history.
  definition:=pg_get_functiondef('public.crm_apply_customer_event(text,jsonb)'::regprocedure);
  amended:=replace(definition,
    $m$if name is null then reason:=case when p_payload#>>'{workflow,instanceId}' is not null and jsonb_array_length(aliases)=0 then 'journey_pending' else 'missing_customer_name' end;$m$,
    $m$if crm_private.is_automatic_history_mapping(mapping.descriptor) then reason:='automatic_no_client'; elsif name is null then reason:=case when p_payload#>>'{workflow,instanceId}' is not null and jsonb_array_length(aliases)=0 then 'journey_pending' else 'missing_customer_name' end;$m$);
  amended:=replace(amended,
    $m$v_result:=jsonb_build_object('outcome',case when reason in ('source_unapproved','mapping_unapproved') then reason when reason='journey_pending' then 'retry' else 'review' end,'reason',reason);$m$,
    $m$v_result:=case when crm_private.is_automatic_history_mapping(mapping.descriptor) and reason not in ('source_unapproved','mapping_unapproved','journey_pending')
    then jsonb_build_object('outcome','rejected','reason',left(case when reason like 'automatic_%' then reason else 'automatic_'||reason end,80))
    else jsonb_build_object('outcome',case when reason in ('source_unapproved','mapping_unapproved') then reason when reason='journey_pending' then 'retry' else 'review' end,'reason',reason) end;$m$);
  amended:=replace(amended,
    $m$update crm_private.customer_event_inbox set review_reason=reason,candidates=coalesce(v_candidates,'{}'),result=v_result where event_id=p_event_id;$m$,
    $m$update crm_private.customer_event_inbox set review_reason=case when v_result->>'outcome'='rejected' then null else reason end,candidates=coalesce(v_candidates,'{}'),result=v_result,
    applied_at=case when v_result->>'outcome'='rejected' then clock_timestamp() end where event_id=p_event_id;$m$);
  amended:=replace(amended,
    $m$for item in select value from jsonb_array_elements(p_payload->'answers') where value->>'mode' in ('profile','both') loop$m$,
    $m$for item in select value from jsonb_array_elements(p_payload->'answers') where value->>'mode' in ('profile','both') and not crm_private.is_automatic_history_mapping(mapping.descriptor) loop$m$);
  if position('automatic_no_client' in amended)=0 or position($m$then jsonb_build_object('outcome','rejected','reason'$m$ in amended)=0
     or position($m$applied_at=case when v_result->>'outcome'='rejected'$m$ in amended)=0
     or position($m$and not crm_private.is_automatic_history_mapping(mapping.descriptor) loop$m$ in amended)=0 then
    raise exception 'Review customer event receiver markers';
  end if;
  execute amended;
end $$;

notify pgrst,'reload schema';
