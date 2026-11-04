-- CRM walk-in visit from a Form Builder form (owner request 2026-11-03), and the Form Builder
-- wrappers running with the caller's own rights.
--
-- 1. submit_walkin_visit_from_form: the browser's one write for a walk-in visit made with the
--    linked Form Builder walk-in form. It calls the existing submit_walkin_visit unchanged, so
--    queue completion, client identity, profile projection, documents, follow-ups, audit and the
--    walk-in task sync behave exactly as with the standard walk-in form, and records which form
--    version and answers produced the visit, keyed by a browser-generated submission key.
-- 2. register_walkin_entry_from_form and save_crm_lead_from_form (20261103000100) ran as the
--    function owner. They now run as the caller (SECURITY INVOKER), like register_walkin_entry
--    and submit_walkin_visit themselves, so every row-level rule applies to the wrapped write as
--    it does to the standard form. Only the replay check and the link record run privileged,
--    and the link helper accepts only a record created in the same transaction.
set search_path=public,extensions;

-- Replay check: the earlier result for a key (null for a new key), refusing a changed payload.
create function public.crm_claim_form_submission(p_key uuid,p_purpose text,p_digest text,p_source jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.current_crm_user_id();
begin
  if actor is null or public.current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501'; end if;
  if p_purpose not in ('queue','lead','walkin') then raise exception 'Unknown CRM form' using errcode='22023'; end if;
  return crm_private.claim_form_submission(p_key,p_purpose,actor,p_digest,p_source);
end $$;

-- Records the link for a record the same transaction created (created_at is the transaction time).
create function public.crm_record_form_submission(p_key uuid,p_purpose text,p_digest text,p_source jsonb,p_crm_payload jsonb,p_unused jsonb,
  p_record_type text,p_record_id uuid,p_client_id uuid,p_result jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=public.current_crm_user_id(); fresh boolean;
begin
  if actor is null or public.current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501'; end if;
  fresh:=case p_record_type
    when 'entry_queue' then exists(select 1 from public.entry_queue where id=p_record_id and created_at=now())
    when 'lead' then exists(select 1 from public.leads where id=p_record_id and created_at=now() and created_by=actor)
    when 'visit' then exists(select 1 from public.client_timeline where id=p_record_id and created_at=now())
    else false end;
  if not fresh then raise exception 'Only a record saved by this submission can be linked to it' using errcode='42501'; end if;
  if octet_length(coalesce(p_crm_payload,'{}')::text)>262144 or octet_length(coalesce(p_unused,'{}')::text)>131072 or octet_length(coalesce(p_result,'{}')::text)>16384 then
    raise exception 'The form details are too large' using errcode='22023';
  end if;
  insert into crm_private.form_submission_links(submission_key,purpose,actor_id,payload_digest,source,crm_payload,unused_answers,record_type,record_id,client_id,result)
  values (p_key,p_purpose,actor,p_digest,p_source,coalesce(p_crm_payload,'{}'),coalesce(p_unused,'{}'),p_record_type,p_record_id,p_client_id,p_result);
  perform crm_private.write_audit_log('crm.form_submission_linked',p_record_id,jsonb_build_object(
    'purpose',p_purpose,'submission_key',p_key,'form_template_id',p_source->>'formTemplateId','form_version',p_source->'formVersion',
    'unused_answers',(select coalesce(jsonb_agg(k),'[]'::jsonb) from jsonb_object_keys(coalesce(p_unused,'{}')) k)));
end $$;

revoke all on function public.crm_claim_form_submission(uuid,text,text,jsonb) from public,anon,service_role;
revoke all on function public.crm_record_form_submission(uuid,text,text,jsonb,jsonb,jsonb,text,uuid,uuid,jsonb) from public,anon,service_role;
grant execute on function public.crm_claim_form_submission(uuid,text,text,jsonb) to authenticated;
grant execute on function public.crm_record_form_submission(uuid,text,text,jsonb,jsonb,jsonb,text,uuid,uuid,jsonb) to authenticated;

-- Client queue registration: now as the caller.
create or replace function public.register_walkin_entry_from_form(p_submission_key uuid,p_client_name text,p_mobile text,p_branch_id uuid,p_source jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  payload jsonb:=jsonb_build_object('client_name',p_client_name,'mobile',p_mobile,'branch_id',p_branch_id);
  digest text:=md5(jsonb_build_object('purpose','queue','payload',payload,'source',p_source)::text);
  earlier jsonb; saved record; result jsonb;
begin
  earlier:=public.crm_claim_form_submission(p_submission_key,'queue',digest,p_source);
  if earlier is not null then return earlier||jsonb_build_object('replayed',true); end if;
  select * into saved from public.register_walkin_entry(p_client_name,p_mobile,p_branch_id);
  if saved.id is null then raise exception 'The queue entry was not saved' using errcode='P0001'; end if;
  result:=to_jsonb(saved);
  perform public.crm_record_form_submission(p_submission_key,'queue',digest,p_source,payload,'{}',
    'entry_queue',saved.id,saved.client_id,result);
  return result||jsonb_build_object('replayed',false);
end $$;

-- Lead registration: now as the caller (save_crm_lead keeps its own privileges and checks).
create or replace function public.save_crm_lead_from_form(p_submission_key uuid,p_phone text,p_name text,p_fields jsonb,p_source jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  digest text; earlier jsonb; shown text[]; expanded text[]; accepted jsonb:='{}'::jsonb; unused jsonb:='{}'::jsonb;
  item record; saved public.leads; result jsonb;
begin
  if jsonb_typeof(p_fields) is distinct from 'object' or octet_length(p_fields::text)>65536 then
    raise exception 'Invalid lead details' using errcode='22023';
  end if;
  digest:=md5(jsonb_build_object('purpose','lead','payload',jsonb_build_object('phone',p_phone,'name',p_name,'fields',p_fields),'source',p_source)::text);
  earlier:=public.crm_claim_form_submission(p_submission_key,'lead',digest,p_source);
  if earlier is not null then return earlier||jsonb_build_object('replayed',true); end if;
  -- The same configured routing save_crm_lead applies.
  select coalesce(array_agg(field_key),'{}') into shown from public.lead_form_fields
   where not is_hidden and field_key not in ('source_of_lead','type_of_calling','name_of_exhibition','exhibition_name','invitation_offer_name');
  loop
    select coalesce(array_agg(distinct o.triggers_field_key),'{}') into expanded
      from public.get_crm_lead_option_routes() o join public.lead_form_fields configured on configured.id=o.field_id
     where configured.field_key=any(shown) and upper(o.option_value)=upper(p_fields->>configured.field_key) and o.triggers_field_key is not null;
    exit when expanded <@ shown;
    shown:=shown||expanded;
  end loop;
  for item in select key,value from jsonb_each(p_fields) loop
    if item.key=any(shown) and item.key not in ('mobile_no','name') and jsonb_typeof(item.value)='string' and btrim(item.value #>> '{}')<>'' then
      accepted:=accepted||jsonb_build_object(item.key,item.value);
    else
      unused:=unused||jsonb_build_object(item.key,item.value);
    end if;
  end loop;
  saved:=public.save_crm_lead(p_phone,p_name,accepted);
  result:=jsonb_build_object('id',saved.id,'client_id',saved.client_id,'phone_number',saved.phone_number,'name',saved.name);
  perform public.crm_record_form_submission(p_submission_key,'lead',digest,p_source,
    jsonb_build_object('phone',p_phone,'name',p_name,'fields',accepted),unused,'lead',saved.id,saved.client_id,result);
  return result||jsonb_build_object('replayed',false);
end $$;

-- Walk-in visit: the same payload the standard walk-in form sends, through submit_walkin_visit.
create function public.submit_walkin_visit_from_form(p_submission_key uuid,p_payload jsonb,p_source jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare digest text; earlier jsonb; saved record; result jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' or octet_length(p_payload::text)>262144 then
    raise exception 'Invalid walk-in details' using errcode='22023';
  end if;
  digest:=md5(jsonb_build_object('purpose','walkin','payload',p_payload,'source',p_source)::text);
  earlier:=public.crm_claim_form_submission(p_submission_key,'walkin',digest,p_source);
  if earlier is not null then return earlier||jsonb_build_object('replayed',true); end if;
  select * into saved from public.submit_walkin_visit(p_payload) limit 1;
  if saved.timeline_id is null then raise exception 'The walk-in visit was not saved' using errcode='P0001'; end if;
  result:=jsonb_build_object('client_id',saved.client_id,'timeline_id',saved.timeline_id,'reference_number',saved.reference_number);
  perform public.crm_record_form_submission(p_submission_key,'walkin',digest,p_source,p_payload,'{}',
    'visit',saved.timeline_id,saved.client_id,result);
  return result||jsonb_build_object('replayed',false);
end $$;

revoke all on function public.register_walkin_entry_from_form(uuid,text,text,uuid,jsonb) from public,anon,service_role;
revoke all on function public.save_crm_lead_from_form(uuid,text,text,jsonb,jsonb) from public,anon,service_role;
revoke all on function public.submit_walkin_visit_from_form(uuid,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.register_walkin_entry_from_form(uuid,text,text,uuid,jsonb) to authenticated;
grant execute on function public.save_crm_lead_from_form(uuid,text,text,jsonb,jsonb) to authenticated;
grant execute on function public.submit_walkin_visit_from_form(uuid,jsonb,jsonb) to authenticated;

notify pgrst,'reload schema';
