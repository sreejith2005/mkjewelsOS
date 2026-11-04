-- Every form adds to the client's history automatically (owner request 2026-11-04).
--
-- When a submitted form has no approved customer mapping of its own (Customer Integration) and
-- one of its questions holds a client's phone number, the submission is sent to CRM through the
-- existing customer events pipeline with an automatic "history only" mapping: the phone number
-- identifies the client and every other answer is kept in the client's history (Client 360 /
-- Customer journey). CRM approves these mappings by itself (supabase-crm 20261105000100), never
-- creates a client from them and never changes the client's profile from them; a form whose phone
-- number belongs to no registered client or lead is skipped. Forms with their own approved mapping
-- keep using it, unchanged.
--
-- Automatic mappings are versions of form_customer_mapping_versions marked descriptor.automatic.
-- Every screen and job that reads "the form's own mapping" ignores them, as it already ignores
-- historical mappings.
set search_path=public,extensions;

-- A question that holds the client's phone number (mirrors @jewelos/core isClientPhoneQuestion).
create function crm_sync.is_client_phone_field(p_field jsonb) returns boolean
language sql immutable set search_path='' as $$
  select case
    when p_field->>'field_type'='phone' then lower(coalesce(p_field->>'field_name','')) !~ '(billing|reference|referral)'
    when p_field->>'field_type'='text' then btrim(regexp_replace(lower(coalesce(p_field->>'field_name','')),'[^a-z0-9]+',' ','g')) in
      ('mobile','mobile number','mobile no','phone','phone number','contact number','whatsapp number','client mobile','customer mobile','client phone','customer phone','primary phone')
      or btrim(regexp_replace(lower(coalesce(p_field->>'field_key','')),'[^a-z0-9]+',' ','g')) in
      ('mobile','mobile number','mobile no','phone','phone number','contact number','whatsapp number','client mobile','customer mobile','client phone','customer phone','primary phone')
    else false end
$$;

-- The automatic history mapping of a submitted form version: built from the submission's own
-- snapshot, reused while the form version is unchanged, and immutable like every mapping version.
create function crm_sync.automatic_customer_mapping(p_submission form_submissions) returns uuid
language plpgsql security definer set search_path=public,extensions as $$
declare
  snapshot jsonb:=p_submission.template_snapshot; v_template uuid; digest_text text; identity text; f jsonb;
  fields jsonb:='[]'; descriptor jsonb; existing form_customer_mapping_versions; n integer; saved form_customer_mapping_versions;
begin
  v_template:=nullif(snapshot#>>'{template,id}','')::uuid;
  if v_template is null or v_template<>p_submission.form_template_id then return null; end if;
  -- The first client phone question that was answered with a real number.
  select value->>'field_key' into identity from jsonb_array_elements(coalesce(snapshot->'fields','[]'::jsonb))
   where crm_sync.is_client_phone_field(value) and jsonb_typeof(p_submission.data->(value->>'field_key'))='string'
     and length(regexp_replace(p_submission.data->>(value->>'field_key'),'\D','','g')) between 10 and 15
   order by (value->>'sort_order')::integer, value->>'field_key' limit 1;
  if identity is null then return null; end if;
  digest_text:=crm_sync.customer_definition_digest(snapshot);
  perform pg_advisory_xact_lock(hashtextextended('customer.mapping.'||v_template,0));
  select v.* into existing from form_customer_mapping_versions v
   where v.template_id=v_template and v.descriptor ? 'automatic' and v.descriptor->>'definitionDigest'=digest_text and v.descriptor->>'identityField'=identity
   order by v.version desc limit 1;
  if existing.id is not null then return existing.id; end if;
  for f in select value from jsonb_array_elements(coalesce(snapshot->'fields','[]'::jsonb)) order by (value->>'sort_order')::integer, value->>'field_key' loop
    if f->>'field_type' in ('section_header','divider','file','user_dropdown','branch_dropdown','department_dropdown','repeat','crm_photo') then continue; end if;
    fields:=fields||jsonb_build_array(jsonb_build_object(
      'fieldKey',f->>'field_key',
      'mode',case when f->>'field_key'=identity then 'profile' else 'history' end,
      'destination',case when f->>'field_key'=identity then 'primary_phone' else 'note' end,
      'label',f->>'field_name','type',f->>'field_type','options',coalesce(f->'options','[]'::jsonb),
      'sectionKey',form_field_section_key(f->>'group_name',snapshot#>'{template,sections}')));
  end loop;
  select coalesce(max(v.version),0)+1 into n from form_customer_mapping_versions v where v.template_id=v_template;
  descriptor:=jsonb_build_object('schemaVersion',1,'sourceProject','jewelos','tenantId',p_submission.tenant_id,'templateId',v_template,
    'templateVersion',(snapshot#>>'{template,version}')::integer,'familyId',snapshot#>>'{template,family_id}','formName',snapshot#>>'{template,name}','enabled',true,
    'channel','JEWELOS_FORM','identityScope','jewelos-forms','fields',fields,'definitionDigest',digest_text,
    'automatic',true,'identityField',identity,'mappingVersion',n);
  insert into form_customer_mapping_versions(tenant_id,template_id,version,descriptor,digest,enabled,created_by)
  values(p_submission.tenant_id,v_template,n,descriptor,encode(digest(descriptor::text,'sha256'),'hex'),true,p_submission.submitted_by)
  returning * into saved;
  return saved.id;
end $$;
revoke all on function crm_sync.automatic_customer_mapping(form_submissions) from public,anon,authenticated,service_role;
revoke all on function crm_sync.is_client_phone_field(jsonb) from public,anon,authenticated,service_role;

-- A submission uses its form's own enabled mapping as before; otherwise, when it holds a client's
-- phone number, the automatic history mapping.
create or replace function crm_sync.pin_customer_mapping() returns trigger
language plpgsql security definer set search_path=public as $$
declare m form_customer_mapping_versions; automatic uuid;
begin
  if new.status<>'submitted' then return null; end if;
  select * into m from form_customer_mapping_versions where template_id=new.form_template_id and tenant_id=new.tenant_id
   and not(descriptor ?| array['historicalSnapshotDigest','automatic']) order by version desc limit 1;
  if m.enabled and crm_sync.customer_definition_digest(new.template_snapshot) is not distinct from m.descriptor->>'definitionDigest' then
    insert into crm_sync.submission_mappings values(new.id,m.id);
    return null;
  end if;
  automatic:=crm_sync.automatic_customer_mapping(new);
  if automatic is not null then insert into crm_sync.submission_mappings values(new.id,automatic); end if;
  return null;
end $$;

-- Readers of "the form's own mapping" ignore automatic mappings, as they ignore historical ones.
do $$
declare name text; definition text; amended text;
begin
  foreach name in array array['public.get_form_customer_mapping(uuid)','public.customer_integration_health()','public.customer_integration_overview()'] loop
    definition:=pg_get_functiondef(name::regprocedure);
    amended:=replace(definition,$m$descriptor ? 'historicalSnapshotDigest')$m$,$m$descriptor ?| array['historicalSnapshotDigest','automatic'])$m$);
    if amended=definition then raise exception 'Review automatic mapping markers in %',name; end if;
    if name='public.customer_integration_overview()' then
      amended:=replace(amended,
        $m$select distinct o.family_id from form_customer_mapping_versions v join form_templates o on o.id=v.template_id where v.tenant_id=a.tenant_id$m$,
        $m$select distinct o.family_id from form_customer_mapping_versions v join form_templates o on o.id=v.template_id where v.tenant_id=a.tenant_id and not(v.descriptor ? 'automatic')$m$);
      amended:=replace(amended,$m$e.enabled and e.id<>m.id$m$,$m$e.enabled and e.id<>m.id and not(e.descriptor ? 'automatic')$m$);
      if position($m$where v.tenant_id=a.tenant_id and not(v.descriptor ? 'automatic')$m$ in amended)=0 or position($m$e.id<>m.id and not(e.descriptor ? 'automatic')$m$ in amended)=0 then
        raise exception 'Review customer integration overview markers';
      end if;
    end if;
    execute amended;
  end loop;
end $$;

-- The delivery worker registers an automatic mapping as soon as it has an event to deliver.
create or replace function crm_sync_claim_customer_mappings(p_limit integer default 10)
returns table(mapping_id uuid,descriptor jsonb,digest text)
language sql security definer set search_path=public as $$
 select m.id,m.descriptor,m.digest from form_customer_mapping_versions m
 left join crm_sync.customer_mapping_registrations r on r.mapping_id=m.id
 where (r.mapping_id is null or r.next_check_at<=now())
  and ((m.enabled and not(m.descriptor ?| array['historicalSnapshotDigest','automatic'])
        and m.version=(select max(v.version) from form_customer_mapping_versions v where v.template_id=m.template_id and not(v.descriptor ?| array['historicalSnapshotDigest','automatic'])))
   or (m.descriptor ? 'automatic' and exists(select 1 from crm_sync.customer_events e where e.mapping_id=m.id and e.delivered_at is null and e.rejected_at is null and e.dead_at is null))
   or exists(select 1 from crm_sync.customer_events e where e.mapping_id=m.id and e.delivered_at is null and e.rejected_at is null
        and e.dead_at is null and e.review_at is not null and e.last_error in ('mapping_unapproved','source_unapproved')))
 order by r.next_check_at nulls first,m.created_at,m.id
 limit greatest(1,least(coalesce(p_limit,10),10));
$$;

-- A skipped automatic event (no registered client or lead with that number) keeps CRM's reason.
do $$
declare definition text; amended text;
begin
  definition:=pg_get_functiondef('public.crm_sync_finish_customer_event(uuid,uuid,jsonb,text)'::regprocedure);
  amended:=replace(definition,
    $m$set rejected_at=clock_timestamp(),result=p_result,lease_until=null,lease_token=null,last_error='reviewer_rejected' where id=p_id;$m$,
    $m$set rejected_at=clock_timestamp(),result=p_result,lease_until=null,lease_token=null,last_error=left(coalesce(nullif(p_result->>'reason',''),'reviewer_rejected'),80) where id=p_id;$m$);
  if amended=definition then raise exception 'Review customer event finish markers'; end if;
  execute amended;
end $$;

notify pgrst,'reload schema';
