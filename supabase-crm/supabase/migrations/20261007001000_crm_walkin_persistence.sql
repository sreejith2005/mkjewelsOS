-- Correct walk-in mappings without replacing later identity/reference contract changes.
-- No historical rows are rewritten. The existing invoker RPC, RLS and audit remain.
create function crm_private.prepare_walkin_payload(p_payload jsonb, p_branch uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  result jsonb := p_payload;
  status text := coalesce(nullif(p_payload->>'visit_status',''), nullif(p_payload->'additional_fields'->>'visit_status',''), case when (p_payload->>'did_buy')::boolean then 'YES' else 'NO' end);
  choice text := p_payload->'category_details'->>'new_things_choice';
  selected_name text := coalesce(nullif(p_payload->>'salesperson',''), nullif(p_payload->'additional_fields'->>'salesperson',''));
  selected_ids uuid[];
  seller uuid;
  categories jsonb;
begin
  status := upper(regexp_replace(btrim(status), '[[:space:]]+', '_', 'g'));
  if status = 'YES' and coalesce(p_payload->>'other_order',p_payload->'additional_fields'->>'other_order') = 'YES' then
    status := 'YES_AND_ORDER_PLACED';
  elsif status in ('REPAIR_PLACED','REPAIR_PICKUP','ORDER_PLACED','ORDER_PICKUP') and choice in ('BUYING_NEW_PRODUCT','MAKING_NEW_ORDER') then
    status := status || '_AND_' || choice;
  end if;
  -- Cast validates the entire status vocabulary before any persisted mutation.
  perform status::public.buy_status;
  -- Pre-existing RPC callers that never sent a salesperson keep their original
  -- actor attribution (follow-up/referral contracts require it). New form
  -- callers always send the selected name; that selection never falls back.
  seller := public.current_crm_user_id();
  if selected_name is null and p_payload ? 'salesperson' then
    raise exception 'Choose an active salesperson from the selected branch roster' using errcode = 'check_violation';
  end if;
  if selected_name is not null then
    select array_agg(distinct u.id) into selected_ids from public.users u
    join public.crm_allocation a on a.crm_user_id = u.id and a.branch_id = p_branch and a.active
    where u.active and public.normalize_crm_roster_value(u.name) = public.normalize_crm_roster_value(selected_name)
      and (u.branch_id = p_branch or u.role = 'super_admin');
    if coalesce(cardinality(selected_ids),0) <> 1 then
      raise exception 'Choose one active salesperson from the selected branch roster' using errcode = 'check_violation';
    end if;
    seller := selected_ids[1];
  end if;
  result := result || jsonb_build_object('visit_status',status,'resolved_salesperson_id',seller,
    'did_buy', status in ('YES','YES_AND_ORDER_PLACED') or status like '%_AND_BUYING_NEW_PRODUCT');
  categories := coalesce(p_payload->'additional_fields'->'new_things_categories',p_payload->'category_details'->'new_things_categories','[]'::jsonb);
  if choice = 'BUYING_NEW_PRODUCT' or status = 'PRODUCT_EXCHANGE' then
    result := result || jsonb_build_object('bought_categories',coalesce(p_payload->'bought_categories','[]'::jsonb) || categories);
  elsif choice = 'MAKING_NEW_ORDER' then
    result := result || jsonb_build_object('order_categories',coalesce(p_payload->'order_categories','[]'::jsonb) || categories);
  end if;
  -- Lossless immutable submission snapshot, including question-to-media metadata.
  result := jsonb_set(result,'{additional_fields}',coalesce(p_payload->'additional_fields','{}'::jsonb) || jsonb_build_object('submitted_fields',p_payload));
  return result;
end $$;
revoke all on function crm_private.prepare_walkin_payload(jsonb,uuid) from public,anon;
grant execute on function crm_private.prepare_walkin_payload(jsonb,uuid) to authenticated,service_role;

do $patch$
declare body text; original text;
begin
  original := replace(pg_get_functiondef('public.submit_walkin_visit(jsonb)'::regprocedure), E'\r', '');
  body := replace(original,'  phone_digits :=', E'  p_payload := crm_private.prepare_walkin_payload(p_payload,target_branch);\n  phone_digits :=');
  body := replace(body, 'purchase_status := CASE WHEN COALESCE((p_payload->>''did_buy'')::boolean, false) THEN ''YES''::"public"."buy_status" ELSE ''NO''::"public"."buy_status" END;',
    'purchase_status := (p_payload->>''visit_status'')::public.buy_status;');
  body := replace(body, 'auth.uid(),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->''seen_categories''',
    '(p_payload->>''resolved_salesperson_id'')::uuid,COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->''seen_categories''');
  body := replace(body, '"auth"."uid"(),COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->''seen_categories''',
    '(p_payload->>''resolved_salesperson_id'')::uuid,COALESCE(ARRAY(SELECT jsonb_array_elements_text(COALESCE(p_payload->''seen_categories''');
  body := replace(body, '  IF new_client THEN UPDATE', E'  UPDATE public.clients SET billing_phone = NULLIF(trim(p_payload->>''billing_phone''),'''') WHERE client_id = target_client;\n  IF new_client THEN UPDATE');
  body := replace(body, '    INSERT INTO "public"."documents"', $validate$
    IF split_part(doc->>'storage_path','/',1) IS DISTINCT FROM target_client::text
      OR split_part(doc->>'storage_path','/',2) IS DISTINCT FROM visit_id::text
      OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'crm-documents' AND o.name = doc->>'storage_path'
        AND o.owner_id = auth.uid()::text AND o.metadata->>'mimetype' = doc->>'mime_type'
        AND (o.metadata->>'size')::bigint BETWEEN 1 AND 10485760)
      OR coalesce(doc->>'mime_type','') NOT IN ('image/jpeg','image/png','image/webp','image/heic','image/heif','video/mp4','video/webm','video/quicktime')
      -- Older deployed clients did not send purpose; retain their video support.
      OR (doc ? 'purpose' AND doc->>'mime_type' LIKE 'video/%' AND coalesce(doc->>'purpose','') <> 'testimonial')
    THEN RAISE EXCEPTION 'Uploaded proof is missing, invalid or belongs to another submission' USING ERRCODE = 'check_violation'; END IF;
    UPDATE public.visit_forms SET
      instagram_proof_url = CASE WHEN doc->>'purpose' = 'instagram' THEN doc->>'storage_path' ELSE instagram_proof_url END,
      google_review_proof_url = CASE WHEN doc->>'purpose' = 'google_review' THEN doc->>'storage_path' ELSE google_review_proof_url END,
      testimonial_proof_url = CASE WHEN doc->>'purpose' = 'testimonial' THEN doc->>'storage_path' ELSE testimonial_proof_url END,
      feedback_form_proof_url = CASE WHEN doc->>'purpose' = 'feedback_form' THEN doc->>'storage_path' ELSE feedback_form_proof_url END,
      thank_you_note_proof_url = CASE WHEN doc->>'purpose' = 'thank_you_note' THEN doc->>'storage_path' ELSE thank_you_note_proof_url END,
      referrals_proof_url = CASE WHEN doc->>'purpose' = 'referrals' THEN doc->>'storage_path' ELSE referrals_proof_url END
    WHERE client_timeline_id = visit_id;
    INSERT INTO "public"."documents"
  $validate$);
  if body = original or body not like '%resolved_salesperson_id%' or body not like '%purchase_status := (p_payload%' or body not like '%Uploaded proof is missing%' then
    raise exception 'Unrecognized submit_walkin_visit contract; refusing partial patch';
  end if;
  execute body;
end $patch$;

-- Purchase/order rollups include upsales and purchase-plus-order visits.
do $$ declare body text; begin
  body := replace(pg_get_functiondef('public.recalculate_client_rollups()'::regprocedure), E'\r', '');
  body := replace(body, E'''YES_AND_ORDER_PLACED''\n                )', E'''YES_AND_ORDER_PLACED''\n                ) OR t.buy_status::text LIKE ''%_AND_BUYING_NEW_PRODUCT''');
  body := replace(body, E'OR t.buy_status::text LIKE ''ORDER_PICKUP%''', E'OR t.buy_status::text LIKE ''ORDER_PICKUP%''\n                   OR t.buy_status::text LIKE ''%_AND_MAKING_NEW_ORDER''\n                   OR t.buy_status = ''YES_AND_ORDER_PLACED''');
  if body not like '%OR t.buy_status::text LIKE ''%_AND_BUYING_NEW_PRODUCT''%' then raise exception 'Unrecognized purchase rollup contract'; end if;
  execute body;
end $$;

-- Resolve each action from the most recent answered visit. Minimal visits do
-- not erase answers, and a date edit can change which saved answer is latest.
create function crm_private.refresh_walkin_actions(p_client uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare answers jsonb;
begin
  with form_answers as (
    select t.event_date,t.created_at,t.id,jsonb_build_object(
      'instagram',coalesce(nullif(f.additional_fields->'engagement_answers'->>'instagram',''),case when f.instagram_asked then 'YES' when f.instagram_asked=false then 'NO' end),
      'google_review',coalesce(nullif(f.additional_fields->'engagement_answers'->>'google_review',''),case when f.google_review_asked then 'YES' when f.google_review_asked=false then 'NO' end),
      'testimonial',coalesce(nullif(f.additional_fields->'engagement_answers'->>'testimonial',''),case when f.testimonial_asked then 'YES' when f.testimonial_asked=false then 'NO' end),
      'referrals',coalesce(nullif(f.additional_fields->'engagement_answers'->>'referrals',''),case when f.referrals_asked then 'YES' when f.referrals_asked=false then 'NO' end)
    ) as values from public.visit_forms f join public.client_timeline t on t.id=f.client_timeline_id where t.client_id=p_client
  ), latest_answers as (
    select distinct on(a.key) a.key,a.value from form_answers f cross join lateral jsonb_each_text(f.values) a
      where nullif(btrim(a.value),'') is not null order by a.key,f.event_date desc,f.created_at desc,f.id desc
  ) select jsonb_object_agg(key,value) into answers from latest_answers;
  update public.clients set
    instagram_status=coalesce(answers->>'instagram',instagram_status),google_review_status=coalesce(answers->>'google_review',google_review_status),
    testimonial_status=coalesce(answers->>'testimonial',testimonial_status),referral_status=coalesce(answers->>'referrals',referral_status)
    where client_id=p_client;
end $$;
revoke all on function crm_private.refresh_walkin_actions(uuid) from public,anon,authenticated,service_role;

create function crm_private.project_walkin_actions() returns trigger
language plpgsql security definer set search_path = '' as $$
declare target uuid;
begin
  select client_id into target from public.client_timeline where id = NEW.client_timeline_id;
  -- Gifts are cumulative, including backdated visits. Replace only this visit's
  -- entry; an explicit blank removes it while unrelated/manual history survives.
  if NEW.additional_fields ? 'gift' or NEW.additional_fields ? 'gift_given' then
    update public.clients set gift_history =
      coalesce((select jsonb_agg(item) from jsonb_array_elements(case when jsonb_typeof(gift_history)='array' then gift_history when gift_history is null then '[]'::jsonb else jsonb_build_array(gift_history) end) item where item->>'timeline_id' is distinct from NEW.client_timeline_id::text),'[]'::jsonb)
      || case when nullif(coalesce(NEW.additional_fields->>'gift',NEW.additional_fields->>'gift_given'),'') is null then '[]'::jsonb else
        jsonb_build_array(jsonb_build_object('timeline_id',NEW.client_timeline_id,'gift',coalesce(NEW.additional_fields->>'gift',NEW.additional_fields->>'gift_given'),'other',NEW.additional_fields->>'gift_other')) end
      where client_id = target;
  end if;
  perform crm_private.refresh_walkin_actions(target);
  return NEW;
end $$;
revoke all on function crm_private.project_walkin_actions() from public,anon,authenticated,service_role;
create trigger visit_forms_project_walkin_actions after insert or update of additional_fields,instagram_asked,google_review_asked,testimonial_asked,referrals_asked on public.visit_forms
for each row execute function crm_private.project_walkin_actions();

create function crm_private.refresh_walkin_actions_after_date_edit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform crm_private.refresh_walkin_actions(NEW.client_id); return NEW; end $$;
revoke all on function crm_private.refresh_walkin_actions_after_date_edit() from public,anon,authenticated,service_role;
create trigger client_timeline_refresh_walkin_actions after update of event_date on public.client_timeline
for each row when (OLD.event_date is distinct from NEW.event_date) execute function crm_private.refresh_walkin_actions_after_date_edit();

notify pgrst, 'reload schema';
