-- CRM forms built in the JewelOS Form Builder (owner request 2026-11-03).
--
-- When a Super Admin links a Form Builder form to client queue or lead
-- registration (JewelOS 0373), the browser still makes one write, here, in the
-- CRM project. These wrappers call the existing audited RPCs unchanged
-- (register_walkin_entry, save_crm_lead), so phone normalization, client lookup,
-- tokens, branch rules, duplicate checks, lead routing, Dropdown Master checks
-- and audit behave exactly as with the standard CRM form. In the same
-- transaction they record which form version and answers produced the record,
-- keyed by a browser-generated submission key: a retried submission returns the
-- first result instead of creating a second queue entry or lead, and a
-- different payload under the same key is refused.
set search_path=public,extensions;

create table crm_private.form_submission_links (
  submission_key uuid primary key,
  purpose text not null check (purpose in ('queue','lead','walkin')),
  actor_id uuid not null,
  payload_digest text not null,
  -- Form family, template and version, link version, and every answer as entered.
  source jsonb not null check (jsonb_typeof(source)='object'),
  -- What was passed to the CRM RPC, and the answers CRM did not take (kept, never discarded).
  crm_payload jsonb not null,
  unused_answers jsonb not null default '{}'::jsonb,
  record_type text not null check (record_type in ('entry_queue','lead','visit')),
  record_id uuid not null,
  client_id uuid,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create index form_submission_links_record on crm_private.form_submission_links(record_type,record_id);
create index form_submission_links_client on crm_private.form_submission_links(client_id,created_at desc) where client_id is not null;
revoke all on crm_private.form_submission_links from public,anon,authenticated,service_role;

create function crm_private.form_submission_links_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'Form submission links cannot be changed' using errcode='42501';
end $$;
create trigger form_submission_links_immutable before update or delete on crm_private.form_submission_links
  for each row execute function crm_private.form_submission_links_immutable();
revoke all on function crm_private.form_submission_links_immutable() from public,anon,authenticated,service_role;

-- Checks the form source and returns the earlier result for a replayed key (null for a new key).
create function crm_private.claim_form_submission(p_key uuid,p_purpose text,p_actor uuid,p_digest text,p_source jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare earlier crm_private.form_submission_links;
begin
  if p_key is null then raise exception 'A submission key is required' using errcode='22023'; end if;
  if jsonb_typeof(p_source) is distinct from 'object' or octet_length(p_source::text)>131072
     or coalesce(p_source->>'formFamilyId','')!~'^[0-9a-f-]{36}$'
     or coalesce(p_source->>'formTemplateId','')!~'^[0-9a-f-]{36}$'
     or coalesce(p_source->>'bindingVersionId','')!~'^[0-9a-f-]{36}$'
     or jsonb_typeof(p_source->'formVersion') is distinct from 'number'
     or jsonb_typeof(p_source->'answers') is distinct from 'object' then
    raise exception 'The form details are not valid' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('crm.form_submission:'||p_key::text,0));
  select * into earlier from crm_private.form_submission_links where submission_key=p_key;
  if not found then return null; end if;
  if earlier.actor_id<>p_actor or earlier.purpose<>p_purpose or earlier.payload_digest<>p_digest then
    raise exception 'This submission was already saved with different answers' using errcode='23505';
  end if;
  return earlier.result;
end $$;
revoke all on function crm_private.claim_form_submission(uuid,text,uuid,text,jsonb) from public,anon,authenticated,service_role;

-- Client queue registration from a Form Builder form.
create function public.register_walkin_entry_from_form(p_submission_key uuid,p_client_name text,p_mobile text,p_branch_id uuid,p_source jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=public.current_crm_user_id();
  payload jsonb:=jsonb_build_object('client_name',p_client_name,'mobile',p_mobile,'branch_id',p_branch_id);
  digest text; earlier jsonb; saved record; result jsonb;
begin
  if actor is null or public.current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501'; end if;
  digest:=md5(jsonb_build_object('purpose','queue','payload',payload,'source',p_source)::text);
  earlier:=crm_private.claim_form_submission(p_submission_key,'queue',actor,digest,p_source);
  if earlier is not null then return earlier||jsonb_build_object('replayed',true); end if;
  select * into saved from public.register_walkin_entry(p_client_name,p_mobile,p_branch_id);
  if saved.id is null then raise exception 'The queue entry was not saved' using errcode='P0001'; end if;
  result:=to_jsonb(saved);
  insert into crm_private.form_submission_links(submission_key,purpose,actor_id,payload_digest,source,crm_payload,record_type,record_id,client_id,result)
  values (p_submission_key,'queue',actor,digest,p_source,payload,'entry_queue',saved.id,saved.client_id,result);
  perform crm_private.write_audit_log('crm.form_submission_linked',saved.id,jsonb_build_object(
    'purpose','queue','submission_key',p_submission_key,'form_template_id',p_source->>'formTemplateId','form_version',p_source->'formVersion'));
  return result||jsonb_build_object('replayed',false);
end $$;

-- Lead registration from a Form Builder form. Only the answers CRM's lead
-- routing shows are passed to save_crm_lead (it refuses others); every other
-- answer is kept in unused_answers with the link.
create function public.save_crm_lead_from_form(p_submission_key uuid,p_phone text,p_name text,p_fields jsonb,p_source jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=public.current_crm_user_id();
  digest text; earlier jsonb; shown text[]; expanded text[]; accepted jsonb:='{}'::jsonb; unused jsonb:='{}'::jsonb;
  item record; saved public.leads; result jsonb;
begin
  if actor is null or public.current_user_role() is null then raise exception 'Active CRM access required' using errcode='42501'; end if;
  if jsonb_typeof(p_fields) is distinct from 'object' or octet_length(p_fields::text)>65536 then
    raise exception 'Invalid lead details' using errcode='22023';
  end if;
  digest:=md5(jsonb_build_object('purpose','lead','payload',jsonb_build_object('phone',p_phone,'name',p_name,'fields',p_fields),'source',p_source)::text);
  earlier:=crm_private.claim_form_submission(p_submission_key,'lead',actor,digest,p_source);
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
  insert into crm_private.form_submission_links(submission_key,purpose,actor_id,payload_digest,source,crm_payload,unused_answers,record_type,record_id,client_id,result)
  values (p_submission_key,'lead',actor,digest,p_source,jsonb_build_object('phone',p_phone,'name',p_name,'fields',accepted),unused,'lead',saved.id,saved.client_id,result);
  perform crm_private.write_audit_log('crm.form_submission_linked',saved.id,jsonb_build_object(
    'purpose','lead','submission_key',p_submission_key,'form_template_id',p_source->>'formTemplateId','form_version',p_source->'formVersion',
    'unused_answers',(select coalesce(jsonb_agg(k),'[]'::jsonb) from jsonb_object_keys(unused) k)));
  return result||jsonb_build_object('replayed',false);
end $$;

revoke all on function public.register_walkin_entry_from_form(uuid,text,text,uuid,jsonb) from public,anon,service_role;
revoke all on function public.save_crm_lead_from_form(uuid,text,text,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.register_walkin_entry_from_form(uuid,text,text,uuid,jsonb) to authenticated;
grant execute on function public.save_crm_lead_from_form(uuid,text,text,jsonb,jsonb) to authenticated;

notify pgrst,'reload schema';
