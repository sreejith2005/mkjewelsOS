-- Ask Kiara, Phase 6: employee insights, daily-limit settings, usage, retention
-- purge, and the new-tenant default. Design: docs/superpowers/specs/2026-10-08-ask-kiara-design.md
-- (sections 5.1, 5.5, 6, 13, 14) and the Phase 6 section of the plan.
--
-- Additive only: no existing RPC changes its signature or behaviour. Insights are
-- derived labels; nobody (Super Admin included) reads another person's questions.
-- The kiara-insights worker uses the service role, and only through the
-- service-role RPCs below, which touch Kiara tables only.
set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. New tenants start with Ask Kiara switched off (owner decision 2026-10-12)
-- ---------------------------------------------------------------------------

-- 0213 switched every existing tenant off but left the default on, so a tenant
-- created later (or one without a stored "ask_kiara" flag) would see it at once.
-- The default is now off. Live state is preserved first: a tenant whose stored
-- flags lack the key (so it is on today through the old default) gets an explicit
-- "true", audited, so this migration changes nobody's access.
do $pin$
declare t record; c tenant_section_controls;
begin
  for t in select id from tenants order by id loop
    select * into c from tenant_section_controls where tenant_id = t.id for update;
    if c.tenant_id is not null and c.section_availability ? 'ask_kiara' then continue; end if;
    if c.tenant_id is null then
      insert into tenant_section_controls(tenant_id, developer_mode_enabled, section_availability, settings_version)
      values (t.id, false, default_section_availability() || '{"ask_kiara": true}'::jsonb, 1);
    else
      update tenant_section_controls
        set section_availability = section_availability || '{"ask_kiara": true}'::jsonb,
            settings_version = settings_version + 1, updated_at = now()
        where tenant_id = t.id;
    end if;
    insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (t.id, null, 'section_availability_pinned', 'developer_controls', t.id,
      case when c.tenant_id is null then null else jsonb_build_object('section_availability', c.section_availability, 'settings_version', c.settings_version) end,
      jsonb_build_object('ask_kiara', true, 'reason', 'Kept the effective Ask Kiara state before the default changed to off (migration 0220).'));
  end loop;
end $pin$;

-- Same keys as 0213; only ask_kiara changes to false. validated_section_availability()
-- merges this default under the stored flags, so it needs no change.
create or replace function default_section_availability()
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_build_object(
    'home', true, 'dashboard', true, 'crm', true, 'checklist_tasks', true,
    'recurring_todo', true, 'task_templates', true, 'task_evidence', true,
    'delegation_tasks', true, 'fms_tasks', true, 'fms_builder', true,
    'forms_library', true, 'meeting_ai', true, 'notifications', true,
    'users', true, 'availability', true, 'reports', true,
    'dropdown_master', true, 'settings', true, 'ask_kiara', false
  );
$$;
alter function default_section_availability() owner to postgres;
revoke all on function default_section_availability() from public, anon, authenticated, service_role;

-- The server gate read only the stored flags (a missing flag or row counted as
-- on). It now reads them over the default, exactly as get_section_availability()
-- shows them, so a new tenant really starts with Ask Kiara off. Every other
-- section defaults to on, and every existing tenant is pinned above, so no
-- current access changes. Same signature and section-parent rule as 0156.
create or replace function module_enabled(p_page text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((f.a ->> p_page)::boolean, true)
    and coalesce((f.a ->> case p_page
      when 'fms_tasks' then 'fms_builder'
      when 'task_evidence' then 'task_templates'
      when 'delegation_tasks' then 'checklist_tasks'
      else p_page end)::boolean, true)
  from (select default_section_availability()
    || coalesce((select c.section_availability from tenant_section_controls c where c.tenant_id = current_tenant_id()), '{}'::jsonb) as a) f;
$$;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------

-- "Refresh insights now" is limited to once an hour per tenant.
alter table kiara_settings add column insights_refresh_requested_at timestamptz;

-- One Message Batches request of the insights job. Not tenant data (a batch can
-- cover several tenants); no client grant.
create table kiara_insight_batches (
  id uuid primary key default gen_random_uuid(),
  provider_batch_id text unique check (provider_batch_id is null or provider_batch_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  status text not null default 'claimed' check (status in ('claimed','submitted','ended','failed')),
  trigger text not null check (trigger in ('nightly','refresh')),
  item_count integer not null default 0 check (item_count >= 0),
  question_count integer not null default 0 check (question_count >= 0),
  -- custom_id -> the claimed fact ids in the order sent (ids only, no text).
  item_facts jsonb not null default '{}'::jsonb check (jsonb_typeof(item_facts) = 'object'),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  ended_at timestamptz,
  error text check (error is null or length(error) <= 200)
);
create index kiara_insight_batches_open on kiara_insight_batches(status, created_at) where status in ('claimed','submitted');

-- Questions claimed by a batch, and how often labelling was tried (a question is
-- given up after 5 failed attempts).
alter table kiara_question_facts
  add column labelling_batch_id uuid references kiara_insight_batches(id) on delete set null,
  add column label_attempts smallint not null default 0 check (label_attempts between 0 and 20);
create index kiara_question_facts_unlabelled on kiara_question_facts(asked_at)
  where labelled_at is null and labelling_batch_id is null;
create index kiara_question_facts_batch on kiara_question_facts(labelling_batch_id) where labelling_batch_id is not null;

-- Where the insights worker lives, recorded when the owner schedules the jobs
-- (schedule_kiara_jobs). One row; no client grant.
create table kiara_insights_job_config (
  singleton boolean primary key default true check (singleton),
  function_url text not null check (function_url ~ '^https://[a-z0-9]{20}\.supabase\.co/functions/v1/kiara-insights$'
    or function_url ~ '^http://(127\.0\.0\.1|localhost|kong|host\.docker\.internal)(:[0-9]{2,5})?/functions/v1/kiara-insights$'),
  updated_at timestamptz not null default now()
);

create table kiara_employee_insights (
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_profile_id uuid primary key references user_profiles(id) on delete cascade,
  period_start date,
  period_end date,
  status text not null default 'insufficient_data' check (status in ('rated','insufficient_data')),
  rating smallint check (rating is null or rating between 1 and 5),
  classification text check (classification is null or classification in ('fresher','experienced','veteran')),
  question_count integer not null default 0 check (question_count >= 0),
  sop_question_count integer not null default 0 check (sop_question_count >= 0),
  active_days integer not null default 0 check (active_days >= 0),
  basic_count integer not null default 0 check (basic_count >= 0),
  repeat_count integer not null default 0 check (repeat_count >= 0),
  escalated_count integer not null default 0 check (escalated_count >= 0),
  last_active_on date,
  summary text check (summary is null or length(summary) <= 300),
  top_topics text[] not null default '{}' check (cardinality(top_topics) <= 5),
  top_documents text[] not null default '{}' check (cardinality(top_documents) <= 5),
  top_departments text[] not null default '{}' check (cardinality(top_departments) <= 5),
  formula_version integer,
  model text check (model is null or length(model) <= 100),
  summary_at timestamptz,
  computed_at timestamptz,
  constraint kiara_employee_insights_rated check (
    (status = 'rated' and rating is not null and classification is not null)
    or (status = 'insufficient_data' and rating is null and classification is null))
);
create index kiara_employee_insights_tenant on kiara_employee_insights(tenant_id);

alter table kiara_insight_batches enable row level security;
alter table kiara_insights_job_config enable row level security;
alter table kiara_employee_insights enable row level security;
revoke all on kiara_insight_batches, kiara_insights_job_config, kiara_employee_insights from public, anon, authenticated, service_role;
-- No policies and no grants: insights are read only through get_kiara_insights().

-- Retirement manifest: insights are retained (never demo data). Guarded text
-- replacement in the style of 0218, so main's later manifest edits survive.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('production_demo_data_retirement_manifest(uuid)'::regprocedure);
  if position($marker$'kiara_employee_insights'$marker$ in definition) > 0 then return; end if;
  if position($marker$'kiara_document_chunks','kiara_escalations'$marker$ in definition) = 0
    or position($marker$'kiara_escalations', (select count(*) from public.kiara_escalations where tenant_id = p_tenant_id)$marker$ in definition) = 0 then
    raise exception 'Retirement inventory contract changed';
  end if;
  definition := replace(definition, $marker$'kiara_document_chunks','kiara_escalations'$marker$,
    $replacement$'kiara_document_chunks','kiara_escalations','kiara_employee_insights'$replacement$);
  definition := replace(definition, $marker$'kiara_escalations', (select count(*) from public.kiara_escalations where tenant_id = p_tenant_id)$marker$,
    $replacement$'kiara_escalations', (select count(*) from public.kiara_escalations where tenant_id = p_tenant_id),
      'kiara_employee_insights', (select count(*) from public.kiara_employee_insights where tenant_id = p_tenant_id)$replacement$);
  execute definition;
end $$;
revoke all on function public.production_demo_data_retirement_manifest(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Service-role contract of the kiara-insights worker
-- ---------------------------------------------------------------------------
-- Each function rejects every caller except the service role (as 0162), reads
-- and writes Kiara tables only, and returns no more than the job needs: the
-- text of the employees' own questions (never Kiara's answers or tool data).

create function kiara_assert_service_role()
returns void language plpgsql stable set search_path = public as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
end $$;

-- Gives a batch's unlabelled questions back so the next run tries them again.
create function kiara_release_insight_batch(p_batch_id uuid, p_status text, p_error text)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_released integer;
begin
  update kiara_question_facts set labelling_batch_id = null where labelling_batch_id = p_batch_id;
  get diagnostics v_released = row_count;
  update kiara_insight_batches set status = p_status, ended_at = now(), error = left(p_error, 200) where id = p_batch_id;
  return v_released;
end $$;

-- Claims up to p_max_employees employees with new (unlabelled) questions from the
-- last 60 days, at most p_max_questions each, oldest first. Returns null when
-- nothing is new (the cost guard: employees without new questions are skipped).
create function claim_kiara_insight_work(p_tenant_id uuid, p_trigger text, p_max_employees integer default 200, p_max_questions integer default 40)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_batch_id uuid;
  v_items jsonb := '[]'::jsonb;
  v_profile record;
  v_questions jsonb;
  v_topics jsonb;
  v_count integer := 0;
  v_stale record;
begin
  perform kiara_assert_service_role();
  if p_trigger is null or p_trigger not in ('nightly','refresh') then raise exception 'Unknown trigger' using errcode = '22023'; end if;
  if coalesce(p_max_employees, 0) not between 1 and 500 or coalesce(p_max_questions, 0) not between 1 and 100 then
    raise exception 'Invalid limits' using errcode = '22023';
  end if;

  -- A worker that died between claiming and submitting leaves a claimed batch.
  for v_stale in select id from kiara_insight_batches where status = 'claimed' and created_at < now() - interval '30 minutes' for update skip locked loop
    perform kiara_release_insight_batch(v_stale.id, 'failed', 'not submitted');
  end loop;

  insert into kiara_insight_batches(trigger) values (p_trigger) returning id into v_batch_id;

  for v_profile in
    select f.user_profile_id, f.tenant_id
    from kiara_question_facts f
    join user_profiles p on p.id = f.user_profile_id
    where f.labelled_at is null and f.labelling_batch_id is null and f.message_id is not null
      and f.label_attempts < 5 and f.asked_at >= now() - interval '60 days'
      and (p_tenant_id is null or f.tenant_id = p_tenant_id)
    group by f.user_profile_id, f.tenant_id
    order by min(f.asked_at), f.user_profile_id
    limit p_max_employees
  loop
    with picked as (
      select f.id from kiara_question_facts f
      where f.user_profile_id = v_profile.user_profile_id and f.labelled_at is null and f.labelling_batch_id is null
        and f.message_id is not null and f.label_attempts < 5 and f.asked_at >= now() - interval '60 days'
      order by f.asked_at, f.id
      limit p_max_questions
      for update skip locked
    ), claimed as (
      update kiara_question_facts f set labelling_batch_id = v_batch_id, label_attempts = f.label_attempts + 1
      from picked where f.id = picked.id
      returning f.id, f.message_id, f.asked_at, f.local_date
    )
    select coalesce(jsonb_agg(jsonb_build_object('fact_id', c.id, 'asked_on', c.local_date, 'text', left(m.display_text, 600))
      order by c.asked_at, c.id), '[]'::jsonb)
    into v_questions
    from claimed c join kiara_messages m on m.id = c.message_id and m.role = 'user';

    if jsonb_array_length(v_questions) = 0 then continue; end if;
    -- Topics already given to this employee's earlier questions keep labels consistent.
    select coalesce(jsonb_agg(t.topic order by t.last_asked desc), '[]'::jsonb) into v_topics
    from (select topic, max(asked_at) last_asked from kiara_question_facts
      where user_profile_id = v_profile.user_profile_id and topic is not null and labelled_at is not null
        and asked_at >= now() - interval '60 days'
      group by topic order by max(asked_at) desc limit 15) t;

    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'custom_id', v_profile.user_profile_id::text,
      'user_profile_id', v_profile.user_profile_id,
      'tenant_id', v_profile.tenant_id,
      'known_topics', v_topics,
      'questions', v_questions));
    v_count := v_count + jsonb_array_length(v_questions);
  end loop;

  if jsonb_array_length(v_items) = 0 then
    delete from kiara_insight_batches where id = v_batch_id;
    return null;
  end if;
  update kiara_insight_batches set item_count = jsonb_array_length(v_items), question_count = v_count,
    item_facts = (select jsonb_object_agg(i->>'custom_id', (select jsonb_agg(q->'fact_id') from jsonb_array_elements(i->'questions') q))
      from jsonb_array_elements(v_items) i)
  where id = v_batch_id;
  return jsonb_build_object('batch_id', v_batch_id, 'items', v_items);
end $$;

create function mark_kiara_insight_batch_submitted(p_batch_id uuid, p_provider_batch_id text)
returns void language plpgsql volatile security definer set search_path = public as $$
begin
  perform kiara_assert_service_role();
  if p_provider_batch_id is null or p_provider_batch_id !~ '^[A-Za-z0-9_-]{1,100}$' then
    raise exception 'Invalid provider batch id' using errcode = '22023';
  end if;
  update kiara_insight_batches set status = 'submitted', provider_batch_id = p_provider_batch_id, submitted_at = now()
  where id = p_batch_id and status = 'claimed';
  if not found then raise exception 'Batch is not awaiting submission' using errcode = '22023'; end if;
end $$;

create function fail_kiara_insight_batch(p_batch_id uuid, p_error text)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare v_batch kiara_insight_batches;
begin
  perform kiara_assert_service_role();
  select * into v_batch from kiara_insight_batches where id = p_batch_id for update;
  if v_batch.id is null or v_batch.status not in ('claimed','submitted') then return 0; end if;
  return kiara_release_insight_batch(p_batch_id, 'failed', coalesce(p_error, 'failed'));
end $$;

create function list_open_kiara_insight_batches()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform kiara_assert_service_role();
  return coalesce((select jsonb_agg(jsonb_build_object('batch_id', id, 'provider_batch_id', provider_batch_id,
      'submitted_at', submitted_at, 'item_count', item_count, 'item_facts', item_facts) order by submitted_at)
    from kiara_insight_batches where status = 'submitted'), '[]'::jsonb);
end $$;

-- Applies one ended batch: labels for the questions that came back valid, the
-- per-employee summary, and gives every other claimed question back (a failed
-- item is retried on the next run). Idempotent: a batch already closed is a no-op.
create function complete_kiara_insight_batch(p_batch_id uuid, p_results jsonb, p_model text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_batch kiara_insight_batches;
  v_item jsonb;
  v_question jsonb;
  v_profile uuid;
  v_tenant uuid;
  v_summary text;
  v_labelled integer := 0;
  v_rows integer;
  v_released integer;
  v_profiles uuid[] := '{}'::uuid[];
begin
  perform kiara_assert_service_role();
  select * into v_batch from kiara_insight_batches where id = p_batch_id for update;
  if v_batch.id is null then raise exception 'Batch not found' using errcode = '22023'; end if;
  if v_batch.status <> 'submitted' then
    return jsonb_build_object('labelled', 0, 'released', 0, 'user_profile_ids', '[]'::jsonb, 'already_closed', true);
  end if;
  if p_results is null or jsonb_typeof(p_results) <> 'array' then raise exception 'Results must be an array' using errcode = '22023'; end if;
  if p_model is not null and length(p_model) > 100 then raise exception 'Invalid model' using errcode = '22023'; end if;

  for v_item in select value from jsonb_array_elements(p_results) loop
    perform assert_json_keys(v_item, array['user_profile_id','summary','questions'], 'insight result');
    v_profile := (v_item->>'user_profile_id')::uuid;
    v_summary := btrim(v_item->>'summary');
    if v_summary is null or length(v_summary) not between 1 and 300 or jsonb_typeof(v_item->'questions') <> 'array' then
      raise exception 'Invalid insight result' using errcode = '22023';
    end if;
    select tenant_id into v_tenant from kiara_question_facts where labelling_batch_id = p_batch_id and user_profile_id = v_profile limit 1;
    if v_tenant is null then continue; end if;
    for v_question in select value from jsonb_array_elements(v_item->'questions') loop
      perform assert_json_keys(v_question, array['id','category','sop_level','topic'], 'question label');
      if v_question->>'category' is null or v_question->>'category' not in ('sop','app_help','data','other')
        or (v_question->>'sop_level' is not null and v_question->>'sop_level' not in ('basic','intermediate','advanced'))
        or length(btrim(coalesce(v_question->>'topic', ''))) not between 1 and 120 then
        raise exception 'Invalid question label' using errcode = '22023';
      end if;
      update kiara_question_facts
        set category = v_question->>'category',
            sop_level = case when v_question->>'category' = 'sop' then coalesce(v_question->>'sop_level', 'intermediate') end,
            topic = btrim(v_question->>'topic'), labelled_at = now(), labelling_batch_id = null
      where id = (v_question->>'id')::uuid and labelling_batch_id = p_batch_id and user_profile_id = v_profile;
      get diagnostics v_rows = row_count;
      v_labelled := v_labelled + v_rows;
    end loop;
    insert into kiara_employee_insights(tenant_id, user_profile_id, summary, summary_at, model)
    values (v_tenant, v_profile, v_summary, now(), left(p_model, 100))
    on conflict (user_profile_id) do update set summary = excluded.summary, summary_at = excluded.summary_at, model = excluded.model;
    v_profiles := array_append(v_profiles, v_profile);
  end loop;

  v_released := kiara_release_insight_batch(p_batch_id, 'ended', null);
  return jsonb_build_object('labelled', v_labelled, 'released', v_released, 'user_profile_ids', to_jsonb(v_profiles));
end $$;

-- The labelled facts of the 60-day window, per employee, for the rating
-- (packages/core/src/assistant/insights.ts). Null ids: every employee who
-- already has an insights row (the nightly re-rating as the window moves).
create function kiara_insight_inputs(p_user_profile_ids uuid[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform kiara_assert_service_role();
  if p_user_profile_ids is not null and cardinality(p_user_profile_ids) > 2000 then
    raise exception 'Too many employees' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'user_profile_id', p.id,
      'tenant_id', p.tenant_id,
      'period_start', ((now() at time zone kiara_time_zone(p.tenant_id))::date - 59),
      'period_end', (now() at time zone kiara_time_zone(p.tenant_id))::date,
      'facts', coalesce((
        select jsonb_agg(jsonb_build_object(
          'local_date', f.local_date, 'category', f.category, 'sop_level', f.sop_level, 'topic', f.topic, 'escalated', f.escalated,
          'documents', coalesce((select jsonb_agg(distinct c->>'title') from kiara_messages a
              cross join lateral jsonb_array_elements(coalesce(a.citations, '[]'::jsonb)) c
              where a.reply_to_message_id = f.message_id and c ? 'title'), '[]'::jsonb),
          'departments', coalesce((select jsonb_agg(distinct t.tag) from kiara_messages a
              cross join lateral jsonb_array_elements(coalesce(a.citations, '[]'::jsonb)) c
              join kiara_documents d on d.id = (c->>'document_id')::uuid and d.tenant_id = f.tenant_id
              cross join lateral unnest(d.department_tags) t(tag)
              where a.reply_to_message_id = f.message_id and c->>'document_id' ~* '^[0-9a-f-]{36}$'), '[]'::jsonb))
          order by f.asked_at)
        from kiara_question_facts f
        where f.user_profile_id = p.id and f.labelled_at is not null
          and f.local_date >= (now() at time zone kiara_time_zone(p.tenant_id))::date - 59), '[]'::jsonb))
      order by p.id)
    from user_profiles p
    where (p_user_profile_ids is null and exists (select 1 from kiara_employee_insights i where i.user_profile_id = p.id))
       or p.id = any(coalesce(p_user_profile_ids, '{}'))
  ), '[]'::jsonb);
end $$;

-- Writes the computed ratings. The summary written by complete_kiara_insight_batch is kept.
create function upsert_kiara_insights(p_rows jsonb)
returns integer language plpgsql volatile security definer set search_path = public as $$
declare
  v_row jsonb;
  v_profile user_profiles;
  v_count integer := 0;
  v_status text;
  v_rating smallint;
  v_class text;
begin
  perform kiara_assert_service_role();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Rows must be an array of at most 2,000' using errcode = '22023';
  end if;
  for v_row in select value from jsonb_array_elements(p_rows) loop
    perform assert_json_keys(v_row, array['user_profile_id','period_start','period_end','status','rating','classification',
      'question_count','sop_question_count','active_days','basic_count','repeat_count','escalated_count','last_active_on',
      'top_topics','top_documents','top_departments','formula_version'], 'insight row');
    select * into v_profile from user_profiles where id = (v_row->>'user_profile_id')::uuid;
    if v_profile.id is null then raise exception 'Unknown employee' using errcode = '22023'; end if;
    v_status := v_row->>'status';
    v_rating := (v_row->>'rating')::smallint;
    v_class := v_row->>'classification';
    if v_status not in ('rated','insufficient_data')
      or (v_status = 'rated' and (v_rating is null or v_rating not between 1 and 5
        or v_class is distinct from case when v_rating <= 2 then 'fresher' when v_rating = 3 then 'experienced' else 'veteran' end))
      or (v_status = 'insufficient_data' and (v_rating is not null or v_class is not null)) then
      raise exception 'Invalid rating' using errcode = '22023';
    end if;
    insert into kiara_employee_insights(tenant_id, user_profile_id, period_start, period_end, status, rating, classification,
      question_count, sop_question_count, active_days, basic_count, repeat_count, escalated_count, last_active_on,
      top_topics, top_documents, top_departments, formula_version, computed_at)
    values (v_profile.tenant_id, v_profile.id, (v_row->>'period_start')::date, (v_row->>'period_end')::date, v_status, v_rating, v_class,
      (v_row->>'question_count')::integer, (v_row->>'sop_question_count')::integer, (v_row->>'active_days')::integer,
      (v_row->>'basic_count')::integer, (v_row->>'repeat_count')::integer, (v_row->>'escalated_count')::integer,
      (v_row->>'last_active_on')::date,
      array(select left(x, 200) from jsonb_array_elements_text(coalesce(v_row->'top_topics', '[]')) x limit 5),
      array(select left(x, 200) from jsonb_array_elements_text(coalesce(v_row->'top_documents', '[]')) x limit 5),
      array(select left(x, 200) from jsonb_array_elements_text(coalesce(v_row->'top_departments', '[]')) x limit 5),
      (v_row->>'formula_version')::integer, now())
    on conflict (user_profile_id) do update set
      tenant_id = excluded.tenant_id, period_start = excluded.period_start, period_end = excluded.period_end,
      status = excluded.status, rating = excluded.rating, classification = excluded.classification,
      question_count = excluded.question_count, sop_question_count = excluded.sop_question_count,
      active_days = excluded.active_days, basic_count = excluded.basic_count, repeat_count = excluded.repeat_count,
      escalated_count = excluded.escalated_count, last_active_on = excluded.last_active_on,
      top_topics = excluded.top_topics, top_documents = excluded.top_documents, top_departments = excluded.top_departments,
      formula_version = excluded.formula_version, computed_at = excluded.computed_at;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Insights for people (assistant.view_insights)
-- ---------------------------------------------------------------------------

-- The insights rows a viewer may see: tenant-wide, or their reports-to tree;
-- never their own row; resigned employees left out. Internal (no API role).
create function kiara_insight_scope(p_actor_id uuid, p_tenant_id uuid, p_tenant_wide boolean)
returns table (
  user_profile_id uuid, name text, designation text, department_id uuid, department text, branch_id uuid, branch text,
  status text, rating smallint, classification text, summary text, question_count integer, sop_question_count integer,
  active_days integer, basic_count integer, repeat_count integer, escalated_count integer, last_active_on date,
  top_topics text[], top_documents text[], top_departments text[], computed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(btrim(p.employee_name), ''), 'Employee'),
    (select d.label from dropdown_masters d where d.id = p.designation_id),
    p.department_id, (select d.name from departments d where d.id = p.department_id),
    p.branch_id, (select b.name from branches b where b.id = p.branch_id),
    i.status, i.rating, i.classification, i.summary, i.question_count, i.sop_question_count,
    i.active_days, i.basic_count, i.repeat_count, i.escalated_count, i.last_active_on,
    i.top_topics, i.top_documents, i.top_departments, i.computed_at
  from kiara_employee_insights i
  join user_profiles p on p.id = i.user_profile_id
  where i.tenant_id = p_tenant_id and p.tenant_id = p_tenant_id
    and p.id <> p_actor_id and p.working_status <> 'resigned'
    and (p_tenant_wide or is_reporting_descendant(p_actor_id, p.id));
$$;

-- Admin and Super Admin (effective role) see the tenant; everyone else holding
-- the permission (managers by default) sees their reports-to tree, as Users
-- does. Nobody sees their own row. Only derived labels and counts are returned.
create function get_kiara_insights(p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_actor();
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_tenant_wide boolean;
  v_branch uuid;
  v_department uuid;
  v_class text;
  v_sort text;
  v_rows jsonb;
  v_scope jsonb;
  v_settings kiara_settings;
begin
  if not has_permission('assistant.view_insights') then
    raise exception 'Viewing insights requires permission' using errcode = '42501';
  end if;
  perform assert_json_keys(v_filters, array['branch_id','department_id','classification','sort'], 'insight filters');
  v_branch := nullif(v_filters->>'branch_id', '')::uuid;
  v_department := nullif(v_filters->>'department_id', '')::uuid;
  v_class := nullif(v_filters->>'classification', '');
  v_sort := coalesce(nullif(v_filters->>'sort', ''), 'rating');
  if v_class is not null and v_class not in ('fresher','experienced','veteran','insufficient_data') then
    raise exception 'Unknown class' using errcode = '22023';
  end if;
  if v_sort not in ('rating','activity') then raise exception 'Unknown sort' using errcode = '22023'; end if;
  v_tenant_wide := v_actor.user_role in ('super_admin','admin');

  select jsonb_build_object(
    'branches', coalesce((select jsonb_agg(jsonb_build_object('id', b.branch_id, 'name', b.branch) order by b.branch)
      from (select distinct s.branch_id, s.branch from kiara_insight_scope(v_actor.id, v_actor.tenant_id, v_tenant_wide) s
        where s.branch_id is not null) b), '[]'::jsonb),
    'departments', coalesce((select jsonb_agg(jsonb_build_object('id', d.department_id, 'name', d.department) order by d.department)
      from (select distinct s.department_id, s.department from kiara_insight_scope(v_actor.id, v_actor.tenant_id, v_tenant_wide) s
        where s.department_id is not null) d), '[]'::jsonb))
  into v_scope;

  select coalesce(jsonb_agg(jsonb_build_object(
      'user_profile_id', s.user_profile_id, 'name', s.name, 'designation', s.designation,
      'department', s.department, 'branch', s.branch,
      'status', s.status, 'rating', s.rating, 'classification', s.classification,
      'summary', s.summary, 'question_count', s.question_count, 'sop_question_count', s.sop_question_count,
      'active_days', s.active_days, 'basic_count', s.basic_count, 'repeat_count', s.repeat_count,
      'escalated_count', s.escalated_count, 'last_active_on', s.last_active_on,
      'top_topics', to_jsonb(s.top_topics), 'top_documents', to_jsonb(s.top_documents),
      'top_departments', to_jsonb(s.top_departments), 'computed_at', s.computed_at)
    order by
      case when v_sort = 'rating' then coalesce(s.rating, 0) end desc nulls last,
      case when v_sort = 'activity' then s.question_count end desc nulls last,
      s.last_active_on desc nulls last, s.name, s.user_profile_id), '[]'::jsonb)
  into v_rows
  from kiara_insight_scope(v_actor.id, v_actor.tenant_id, v_tenant_wide) s
  where (v_branch is null or s.branch_id = v_branch)
    and (v_department is null or s.department_id = v_department)
    and (v_class is null or (v_class = 'insufficient_data' and s.status = 'insufficient_data') or s.classification = v_class);

  select * into v_settings from kiara_settings where tenant_id = v_actor.tenant_id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_insights_viewed', 'assistant', v_actor.id,
    jsonb_build_object('count', jsonb_array_length(v_rows), 'scope', case when v_tenant_wide then 'tenant' else 'reports_to_tree' end,
      'filters', v_filters));

  return jsonb_build_object(
    'rows', v_rows,
    'filters', v_scope,
    'scope', case when v_tenant_wide then 'tenant' else 'reports_to_tree' end,
    'window_days', 60, 'min_sop_questions', 8, 'min_active_days', 4, 'formula_version', 1,
    'last_computed_at', (select max(computed_at) from kiara_employee_insights where tenant_id = v_actor.tenant_id),
    'refresh', jsonb_build_object(
      'allowed', v_actor.user_role = 'super_admin',
      'requested_at', v_settings.insights_refresh_requested_at,
      'next_allowed_at', case when v_settings.insights_refresh_requested_at > now() - interval '1 hour'
        then v_settings.insights_refresh_requested_at + interval '1 hour' end));
end $$;

-- Super Admin only: asks the worker to label and rate this tenant now instead of
-- waiting for the nightly run. Once an hour per tenant; audited. The worker is
-- called through pg_net with the Vault cron secret, exactly as pg_cron calls it.
create function request_kiara_insights_refresh()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_actor();
  v_settings kiara_settings;
  v_url text;
  v_secret text;
begin
  if v_actor.user_role <> 'super_admin' or not has_permission('assistant.view_insights') then
    raise exception 'Only Super Admin can refresh insights' using errcode = '42501';
  end if;
  insert into kiara_settings(tenant_id) values (v_actor.tenant_id) on conflict do nothing;
  select * into v_settings from kiara_settings where tenant_id = v_actor.tenant_id for update;
  if v_settings.insights_refresh_requested_at > now() - interval '1 hour' then
    raise exception 'kiara_insights_refresh_too_soon' using errcode = 'P0001',
      detail = to_char((v_settings.insights_refresh_requested_at + interval '1 hour') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  end if;
  select function_url into v_url from kiara_insights_job_config where singleton;
  if to_regclass('vault.decrypted_secrets') is not null then
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'kiara_insights_cron_secret' limit 1$q$ into v_secret;
  end if;
  if v_url is null or v_secret is null or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    raise exception 'kiara_insights_not_configured' using errcode = 'P0001';
  end if;
  execute $q$select net.http_post(url := $1, headers := $2, body := $3, timeout_milliseconds := 30000)$q$
    using v_url,
      jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      jsonb_build_object('mode', 'refresh', 'tenant_id', v_actor.tenant_id);
  update kiara_settings set insights_refresh_requested_at = now() where tenant_id = v_actor.tenant_id;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_insights_refresh_requested', 'assistant', v_actor.tenant_id,
    jsonb_build_object('previous_request_at', v_settings.insights_refresh_requested_at));
  return jsonb_build_object('requested_at', now(), 'next_allowed_at', now() + interval '1 hour');
end $$;

-- ---------------------------------------------------------------------------
-- 5. Limits (assistant.manage_limits: protected, Super Admin only)
-- ---------------------------------------------------------------------------

create function kiara_limits_actor()
returns user_profiles language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles := kiara_actor();
begin
  if not has_permission('assistant.manage_limits') then
    raise exception 'Managing Ask Kiara limits requires permission' using errcode = '42501';
  end if;
  return v_actor;
end $$;

create function kiara_settings_json(p_tenant_id uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'daily_question_limit', coalesce(s.daily_question_limit, 10),
    'conversation_retention_days', coalesce(s.conversation_retention_days, 180),
    'fact_retention_days', 365,
    'settings_version', coalesce(s.settings_version, 1),
    'updated_at', s.updated_at,
    'updated_by', (select coalesce(nullif(btrim(p.employee_name), ''), 'Employee') from user_profiles p where p.id = s.updated_by))
  from (select 1) one left join kiara_settings s on s.tenant_id = p_tenant_id;
$$;

create function get_kiara_limits()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles := kiara_limits_actor();
begin
  return jsonb_build_object(
    'settings', kiara_settings_json(v_actor.tenant_id),
    'exceptions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_profile_id', p.id, 'name', coalesce(nullif(btrim(p.employee_name), ''), 'Employee'), 'employee_code', p.employee_code,
        'department', (select d.name from departments d where d.id = p.department_id),
        'branch', (select b.name from branches b where b.id = p.branch_id),
        'daily_question_limit', l.daily_question_limit, 'unlimited', l.daily_question_limit is null,
        'reason', l.reason, 'updated_at', l.updated_at,
        'is_super_admin', kiara_effective_role(p.id) = 'super_admin')
        order by p.employee_name, p.id)
      from kiara_user_limits l join user_profiles p on p.id = l.user_profile_id
      where l.tenant_id = v_actor.tenant_id), '[]'::jsonb));
end $$;

create function save_kiara_settings_with_audit(p_daily_limit integer, p_retention_days integer, p_expected_version integer)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare v_actor user_profiles := kiara_limits_actor(); v_old kiara_settings; v_new kiara_settings;
begin
  if p_daily_limit is null or p_daily_limit not between 0 and 500 then
    raise exception 'The daily limit must be 0 to 500 questions' using errcode = '22023';
  end if;
  if p_retention_days is null or p_retention_days not between 30 and 730 then
    raise exception 'Chats must be kept 30 to 730 days' using errcode = '22023';
  end if;
  insert into kiara_settings(tenant_id) values (v_actor.tenant_id) on conflict do nothing;
  select * into v_old from kiara_settings where tenant_id = v_actor.tenant_id for update;
  if p_expected_version is null or p_expected_version <> v_old.settings_version then
    raise exception 'Settings changed; refresh and retry' using errcode = '40001';
  end if;
  update kiara_settings set daily_question_limit = p_daily_limit, conversation_retention_days = p_retention_days,
    settings_version = settings_version + 1, updated_by = v_actor.id, updated_at = now()
  where tenant_id = v_actor.tenant_id returning * into v_new;
  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_settings_saved', 'assistant', v_actor.tenant_id,
    jsonb_build_object('daily_question_limit', v_old.daily_question_limit, 'conversation_retention_days', v_old.conversation_retention_days, 'settings_version', v_old.settings_version),
    jsonb_build_object('daily_question_limit', v_new.daily_question_limit, 'conversation_retention_days', v_new.conversation_retention_days, 'settings_version', v_new.settings_version));
  return kiara_settings_json(v_actor.tenant_id);
end $$;

-- One person's exception: a limit (0-500), unlimited, or cleared (back to the
-- company limit). Super Admin is always unlimited, so they cannot get one.
create function save_kiara_user_limit_with_audit(p_user_profile_id uuid, p_daily_limit integer, p_unlimited boolean, p_clear boolean, p_reason text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_limits_actor();
  v_target user_profiles;
  v_old kiara_user_limits;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_limit integer;
begin
  select * into v_target from user_profiles where id = p_user_profile_id;
  if v_target.id is null or v_target.tenant_id <> v_actor.tenant_id then
    raise exception 'Employee not found' using errcode = '42501';
  end if;
  if kiara_effective_role(v_target.id) = 'super_admin' then
    raise exception 'Super Admin has no daily limit' using errcode = '22023';
  end if;
  if v_reason is not null and length(v_reason) > 300 then raise exception 'The note must be at most 300 characters' using errcode = '22023'; end if;
  select * into v_old from kiara_user_limits where user_profile_id = v_target.id for update;

  if coalesce(p_clear, false) then
    if v_old.user_profile_id is null then return jsonb_build_object('user_profile_id', v_target.id, 'cleared', true); end if;
    delete from kiara_user_limits where user_profile_id = v_target.id;
  else
    if coalesce(p_unlimited, false) then
      v_limit := null;
    elsif p_daily_limit is null or p_daily_limit not between 0 and 500 then
      raise exception 'The daily limit must be 0 to 500 questions' using errcode = '22023';
    else
      v_limit := p_daily_limit;
    end if;
    insert into kiara_user_limits(tenant_id, user_profile_id, daily_question_limit, reason, updated_by, updated_at)
    values (v_actor.tenant_id, v_target.id, v_limit, v_reason, v_actor.id, now())
    on conflict (user_profile_id) do update set daily_question_limit = excluded.daily_question_limit, reason = excluded.reason,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;

  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_actor.tenant_id, v_actor.id, 'assistant_user_limit_saved', 'assistant', v_target.id,
    case when v_old.user_profile_id is null then null
      else jsonb_build_object('daily_question_limit', v_old.daily_question_limit, 'unlimited', v_old.daily_question_limit is null, 'reason', v_old.reason) end,
    case when coalesce(p_clear, false) then jsonb_build_object('cleared', true)
      else jsonb_build_object('daily_question_limit', v_limit, 'unlimited', v_limit is null, 'reason', v_reason) end);
  return jsonb_build_object('user_profile_id', v_target.id, 'cleared', coalesce(p_clear, false),
    'daily_question_limit', v_limit, 'unlimited', not coalesce(p_clear, false) and v_limit is null);
end $$;

-- Employees to pick for an exception (name or employee code).
create function search_kiara_limit_people(p_query text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_actor user_profiles := kiara_limits_actor(); v_query text := btrim(coalesce(p_query, ''));
begin
  if length(v_query) < 2 or length(v_query) > 60 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('user_profile_id', p.id, 'name', coalesce(nullif(btrim(p.employee_name), ''), 'Employee'),
        'employee_code', p.employee_code,
        'department', (select d.name from departments d where d.id = p.department_id),
        'branch', (select b.name from branches b where b.id = p.branch_id),
        'is_super_admin', kiara_effective_role(p.id) = 'super_admin')
      order by p.employee_name, p.id)
    from (select * from user_profiles p
      where p.tenant_id = v_actor.tenant_id and p.working_status <> 'resigned'
        and (p.employee_name ilike '%' || replace(replace(v_query, '%', ''), '_', '') || '%'
          or p.employee_code ilike replace(replace(v_query, '%', ''), '_', '') || '%')
      order by p.employee_name, p.id limit 20) p), '[]'::jsonb);
end $$;

-- Questions per person per day (questions minus refunds), with each person's
-- current limit and day totals. At most 31 days.
create function list_kiara_usage(p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_actor user_profiles := kiara_limits_actor();
  v_today date := (now() at time zone kiara_time_zone(v_actor.tenant_id))::date;
  v_from date := coalesce(p_from, v_today);
  v_to date := coalesce(p_to, v_today);
  v_default integer;
begin
  if v_to < v_from or v_to - v_from > 30 then raise exception 'Choose up to 31 days' using errcode = '22023'; end if;
  select coalesce((select daily_question_limit from kiara_settings where tenant_id = v_actor.tenant_id), 10) into v_default;
  return jsonb_build_object(
    'from', v_from, 'to', v_to, 'today', v_today, 'company_limit', v_default,
    'days', (select jsonb_agg(d::date order by d) from generate_series(v_from, v_to, interval '1 day') d),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object(
          'user_profile_id', p.id, 'name', coalesce(nullif(btrim(p.employee_name), ''), 'Employee'),
          'department', (select d.name from departments d where d.id = p.department_id),
          'branch', (select b.name from branches b where b.id = p.branch_id),
          'limit', case when kiara_effective_role(p.id) = 'super_admin' then null
            when l.user_profile_id is not null then l.daily_question_limit else v_default end,
          'unlimited', kiara_effective_role(p.id) = 'super_admin' or (l.user_profile_id is not null and l.daily_question_limit is null),
          'exception', l.user_profile_id is not null,
          'by_day', u.by_day, 'total', u.total)
        order by u.total desc, p.employee_name, p.id)
      from (select user_profile_id, sum(questions - refunded)::integer total,
          jsonb_object_agg(local_date, questions - refunded) by_day
        from kiara_daily_usage
        where tenant_id = v_actor.tenant_id and local_date between v_from and v_to
        group by user_profile_id having sum(questions - refunded) > 0) u
      join user_profiles p on p.id = u.user_profile_id
      left join kiara_user_limits l on l.user_profile_id = p.id), '[]'::jsonb),
    'totals', jsonb_build_object(
      'by_day', coalesce((select jsonb_object_agg(local_date, n) from (select local_date, sum(questions - refunded)::integer n
        from kiara_daily_usage where tenant_id = v_actor.tenant_id and local_date between v_from and v_to group by local_date) t), '{}'::jsonb),
      'total', coalesce((select sum(questions - refunded)::integer from kiara_daily_usage
        where tenant_id = v_actor.tenant_id and local_date between v_from and v_to), 0)));
end $$;

-- ---------------------------------------------------------------------------
-- 6. Retention purge (pg_cron, owner postgres; no API role can run it)
-- ---------------------------------------------------------------------------

-- Conversations (with their messages) whose last message is older than the
-- tenant's retention (default 180 days) are deleted. Question facts lose their
-- message link (on delete set null) and are kept until 365 days; escalations are
-- kept (their links are set null). Usage rows older than 365 days and closed
-- insight batches older than 90 days go too. One audit row per tenant that lost data.
create function purge_kiara_conversations()
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_tenant record;
  v_conversations integer;
  v_messages integer;
  v_facts integer;
  v_usage integer;
  v_total jsonb := '[]'::jsonb;
begin
  for v_tenant in
    select t.id, coalesce(s.conversation_retention_days, 180) retention_days
    from tenants t left join kiara_settings s on s.tenant_id = t.id order by t.id
  loop
    select count(*) into v_messages from kiara_messages m join kiara_conversations c on c.id = m.conversation_id
      where c.tenant_id = v_tenant.id and c.last_message_at < now() - make_interval(days => v_tenant.retention_days);
    delete from kiara_conversations
      where tenant_id = v_tenant.id and last_message_at < now() - make_interval(days => v_tenant.retention_days);
    get diagnostics v_conversations = row_count;
    delete from kiara_question_facts where tenant_id = v_tenant.id and asked_at < now() - interval '365 days';
    get diagnostics v_facts = row_count;
    delete from kiara_daily_usage where tenant_id = v_tenant.id
      and local_date < (now() at time zone kiara_time_zone(v_tenant.id))::date - 365;
    get diagnostics v_usage = row_count;
    if v_conversations + v_facts + v_usage > 0 then
      insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, new_value)
      values (v_tenant.id, null, 'assistant_retention_purged', 'assistant', v_tenant.id,
        jsonb_build_object('conversations', v_conversations, 'messages', v_messages, 'question_facts', v_facts,
          'usage_days', v_usage, 'conversation_retention_days', v_tenant.retention_days, 'fact_retention_days', 365));
      v_total := v_total || jsonb_build_array(jsonb_build_object('tenant_id', v_tenant.id, 'conversations', v_conversations,
        'messages', v_messages, 'question_facts', v_facts, 'usage_days', v_usage));
    end if;
  end loop;
  delete from kiara_insight_batches where status in ('ended','failed') and created_at < now() - interval '90 days';
  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Schedules (run once by the owner's deploy script; fail closed)
-- ---------------------------------------------------------------------------

-- Creates (or updates) the three pg_cron jobs, only when the Vault secret
-- kiara_insights_cron_secret exists exactly once; otherwise nothing is
-- scheduled and it raises. The worker URL is stored for the refresh button.
--   kiara-insights-nightly   02:30 Asia/Kolkata (21:00 UTC): label new questions, re-rate everyone
--   kiara-insights-collect   every 10 minutes: apply finished batches (no new labelling)
--   kiara-retention-purge    03:00 Asia/Kolkata (21:30 UTC): purge_kiara_conversations()
create function schedule_kiara_jobs(p_function_url text)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_secrets integer;
  v_command text;
  v_cron name;
begin
  -- Looked up at run time: pg_cron exists on the hosted project, not on local stacks.
  select e.extnamespace::regnamespace::name into v_cron from pg_extension e where e.extname = 'pg_cron';
  if v_cron is null or to_regclass('cron.job') is null then raise exception 'pg_cron is not installed' using errcode = '23514'; end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then raise exception 'pg_net is not installed' using errcode = '23514'; end if;
  if to_regclass('vault.secrets') is null then raise exception 'Vault is not available' using errcode = '23514'; end if;
  execute $q$select count(*)::integer from vault.secrets where name = 'kiara_insights_cron_secret'$q$ into v_secrets;
  if v_secrets <> 1 then
    raise exception 'Ask Kiara jobs need exactly one Vault secret named kiara_insights_cron_secret' using errcode = '23514';
  end if;
  insert into kiara_insights_job_config(singleton, function_url, updated_at) values (true, p_function_url, now())
  on conflict (singleton) do update set function_url = excluded.function_url, updated_at = now();

  v_command := 'select net.http_post(url := %L, headers := jsonb_build_object(''Content-Type'', ''application/json'', '
    || '''x-cron-secret'', (select decrypted_secret from vault.decrypted_secrets where name = ''kiara_insights_cron_secret'')), '
    || 'body := %L::jsonb, timeout_milliseconds := 60000);';
  execute format('select %I.schedule($1, $2, $3)', v_cron) using 'kiara-insights-nightly', '0 21 * * *', format(v_command, p_function_url, '{"mode":"nightly"}');
  execute format('select %I.schedule($1, $2, $3)', v_cron) using 'kiara-insights-collect', '*/10 * * * *', format(v_command, p_function_url, '{"mode":"collect"}');
  execute format('select %I.schedule($1, $2, $3)', v_cron) using 'kiara-retention-purge', '30 21 * * *', 'select public.purge_kiara_conversations();';
  return jsonb_build_object('scheduled', jsonb_build_array('kiara-insights-nightly', 'kiara-insights-collect', 'kiara-retention-purge'));
end $$;

-- ---------------------------------------------------------------------------
-- 8. Ownership and grants
-- ---------------------------------------------------------------------------

do $$
declare f record;
begin
  for f in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'kiara_assert_service_role', 'kiara_release_insight_batch', 'claim_kiara_insight_work', 'mark_kiara_insight_batch_submitted',
      'fail_kiara_insight_batch', 'list_open_kiara_insight_batches', 'complete_kiara_insight_batch', 'kiara_insight_inputs',
      'upsert_kiara_insights', 'kiara_insight_scope', 'get_kiara_insights', 'request_kiara_insights_refresh', 'kiara_limits_actor', 'kiara_settings_json',
      'get_kiara_limits', 'save_kiara_settings_with_audit', 'save_kiara_user_limit_with_audit', 'search_kiara_limit_people',
      'list_kiara_usage', 'purge_kiara_conversations', 'schedule_kiara_jobs')
  loop
    execute format('alter function %s owner to postgres', f.identity);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.identity);
  end loop;
end $$;

-- The insights worker (service role only; each function re-checks the role).
grant execute on function
  claim_kiara_insight_work(uuid, text, integer, integer),
  mark_kiara_insight_batch_submitted(uuid, text),
  fail_kiara_insight_batch(uuid, text),
  list_open_kiara_insight_batches(),
  complete_kiara_insight_batch(uuid, jsonb, text),
  kiara_insight_inputs(uuid[]),
  upsert_kiara_insights(jsonb)
to service_role;

-- Signed-in users (each function checks the section, the active profile and its permission).
grant execute on function
  get_kiara_insights(jsonb),
  request_kiara_insights_refresh(),
  get_kiara_limits(),
  save_kiara_settings_with_audit(integer, integer, integer),
  save_kiara_user_limit_with_audit(uuid, integer, boolean, boolean, text),
  search_kiara_limit_people(text),
  list_kiara_usage(date, date)
to authenticated;

notify pgrst, 'reload schema';
