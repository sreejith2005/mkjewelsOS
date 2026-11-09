-- Linked CRM forms use their published Form Builder questions, including walk-in visits.
-- Existing crm_walkin triggers keep their derived CRM fields and behavior. No historical replay.
set search_path=public,extensions;

alter table public.fms_trigger_events drop constraint fms_trigger_events_source_purpose_check;
alter table public.fms_trigger_events add constraint fms_trigger_events_source_purpose_check
  check (source_purpose is null or source_purpose in ('queue','lead','walkin'));

-- Retain the existing authorization, audit, evaluator and idempotency contracts. Fail on drift.
create function pg_temp.patch_linked_walkin(p_signature text,p_old text,p_new text)
returns void language plpgsql as $$
declare body text; matches integer;
begin
  body:=replace(pg_get_functiondef(p_signature::regprocedure),E'\r','');
  matches:=(length(body)-length(replace(body,p_old,'')))/length(p_old);
  if matches<>1 then raise exception 'linked walk-in patch: expected one match in %, found %',p_signature,matches; end if;
  execute replace(body,p_old,p_new);
end $$;

select pg_temp.patch_linked_walkin('public.assert_fms_start_trigger_publishable(uuid)',
  $$coalesce(t#>>'{source,purpose}','') not in ('queue','lead')$$,
  $$coalesce(t#>>'{source,purpose}','') not in ('queue','lead','walkin')$$);
select pg_temp.patch_linked_walkin('public.assert_fms_start_trigger_publishable(uuid)',
  'Choose whether the CRM form is the queue or the lead registration form',
  'Choose whether the CRM form is for a client queue registration, lead or walk-in visit');
select pg_temp.patch_linked_walkin('public.crm_sync_apply_submission_event(text,jsonb)',
  $$p_payload#>>'{form,purpose}' in ('queue','lead')$$,
  $$p_payload#>>'{form,purpose}' in ('queue','lead','walkin')$$);

-- A linked event must identify a real version of this tenant's form before its answers travel
-- into an FMS run. Archived versions remain valid for submissions opened before a revision.
select pg_temp.patch_linked_walkin('public.crm_sync_apply_submission_event(text,jsonb)',
  $$v_type='crm_linked_form' and (v_family is null or v_purpose is null)$$,
  $$v_type='crm_linked_form' and (v_family is null or v_purpose is null or v_template is null
      or not exists(select 1 from form_templates t where t.id=v_template and t.family_id=v_family
        and t.tenant_id=v_tenant and t.lifecycle in ('published','archived')))$$);

drop function pg_temp.patch_linked_walkin(text,text,text);
notify pgrst,'reload schema';
