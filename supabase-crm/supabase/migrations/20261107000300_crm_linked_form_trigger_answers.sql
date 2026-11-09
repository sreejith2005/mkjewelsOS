-- Emit every linked form's original question-key answers, including walk-in visits. The existing
-- derived visit event remains unchanged for previously published crm_walkin listeners.
-- Source submissions, customer records and delivered event snapshots are never rewritten.
create or replace function crm_private.enqueue_form_submission_event() returns trigger
language plpgsql security definer set search_path='' as $$
declare c public.clients; v_branch uuid; b public.branches; visit jsonb; answers jsonb;
begin
  if new.purpose not in ('queue','lead','walkin') then return null; end if;
  select * into c from public.clients where client_id=new.client_id;
  if new.record_type='entry_queue' then
    select branch_id into v_branch from public.entry_queue where id=new.record_id;
  elsif new.record_type='lead' then
    select branch_id into v_branch from public.leads where id=new.record_id;
  elsif new.record_type='visit' then
    select t.branch_id,crm_private.walkin_visit_event(v.id) into v_branch,visit
      from public.client_timeline t join public.visit_forms v on v.client_timeline_id=t.id
      where t.id=new.record_id;
  end if;
  select * into b from public.branches where id=v_branch;
  -- sourceOf / LinkedWalkinVisit save {answers:{answers:<stored values>,display:<labels>}}.
  -- Older integrations may supply a flat answer object; preserve that supported shape too.
  answers:=case when jsonb_typeof(new.source#>'{answers,answers}')='object' then new.source#>'{answers,answers}'
    when jsonb_typeof(new.source->'answers')='object' then new.source->'answers' else '{}'::jsonb end;
  insert into crm_private.submission_outbox(kind,record_id,payload)
  values('crm.form_submission_saved',new.submission_key,jsonb_build_object(
    'kind','crm.form_submission_saved','occurred_at',new.created_at,'record_id',new.record_id,'client_id',new.client_id,
    'case_id',visit->'case_id','jewelos_branch_id',b.jewelos_branch_id,
    'staff_jewelos_user_id',coalesce(visit->>'staff_jewelos_user_id',crm_private.jewelos_user_for_crm_user(new.actor_id)::text),
    'form',jsonb_build_object('formFamilyId',new.source->>'formFamilyId','formTemplateId',new.source->>'formTemplateId','formVersion',new.source->'formVersion','purpose',new.purpose),
    'answers',answers||jsonb_strip_nulls(jsonb_build_object('client_code',c.client_code,'client_name',left(c.primary_name,120)))))
  on conflict (kind,record_id) where kind<>'crm.not_bought_case_closed' do nothing;
  return null;
end $$;

revoke all on function crm_private.enqueue_form_submission_event() from public,anon,authenticated,service_role;
