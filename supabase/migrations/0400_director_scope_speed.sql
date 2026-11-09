-- 0400: Directors' Home and Dashboard load again.
--
-- Owner report 2026-11-09, after 0398: a Director's Home showed "Could not load this
-- page / Request failed". 0398 made a Director's own session scoped while franchise
-- isolation stays off, so for the first time in production the franchise rules
-- (0385-0393) ran their scoped branch. Two costs then crossed the request time limit:
--
-- 1. The scope helpers run once per row. org_branch_visible() calls org_scope_enforced(),
--    org_has_company_scope() and org_scope_branch_ids(); the last re-plans and re-reads
--    every store, grant and franchise on each call. Locally, checking 40,000 tasks for
--    a Director took 181 s (an Admin, never scoped while the switch is off, 0.02 s).
-- 2. Home's "recent activity" walked the whole audit log newest-first, testing each
--    row's actor, until it found 8 from the Director's stores (1.5M rows: 24.7 s).
--
-- Fix, without changing who sees what:
-- * The three helpers remember their answer for the rest of the database transaction
--   (one request). The memory is a transaction-local setting keyed by the arguments,
--   the signed-in user and a generation number. Any insert, update, delete or truncate
--   of a table the answer depends on bumps the generation, so a request that changes
--   scope and then reads it gets a fresh answer. Nothing outlives the transaction.
-- * Home's recent activity reads the latest entries of each in-scope person through
--   idx_audit_logs_home, instead of filtering the whole log.

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- Generation counter: bumped by any change to the tables scope is computed from.
-- ---------------------------------------------------------------------------
create function org_scope_cache_bump()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform set_config('jewelos.org_scope_gen',
    (coalesce(nullif(current_setting('jewelos.org_scope_gen', true), ''), '0')::bigint + 1)::text, true);
  return null;
end $$;
revoke all on function org_scope_cache_bump() from public, anon, authenticated;

create trigger org_scope_cache_bump after insert or update or delete or truncate on org_scope_grants
  for each statement execute function org_scope_cache_bump();
create trigger org_scope_cache_bump after insert or update or delete or truncate on user_profiles
  for each statement execute function org_scope_cache_bump();
create trigger org_scope_cache_bump after insert or update or delete or truncate on user_access_profiles
  for each statement execute function org_scope_cache_bump();
create trigger org_scope_cache_bump after insert or update or delete or truncate on branches
  for each statement execute function org_scope_cache_bump();
create trigger org_scope_cache_bump after insert or update or delete or truncate on franchise_groups
  for each statement execute function org_scope_cache_bump();
create trigger org_scope_cache_bump after insert or update or delete or truncate on tenant_franchise_controls
  for each statement execute function org_scope_cache_bump();

-- Cache key prefix: generation | signed-in user. Including the user keeps answers that
-- depend on the session (org_scope_enforced) correct when one transaction switches users.
create function org_scope_cache_key(p_parts text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce(nullif(current_setting('jewelos.org_scope_gen', true), ''), '0')
    || '|' || coalesce(auth.uid()::text, '-') || '|' || p_parts || '=';
$$;
revoke all on function org_scope_cache_key(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The three per-row helpers, same answers as 0385/0397/0398, now remembered.
-- ---------------------------------------------------------------------------
create or replace function org_scope_enforced(p_tenant_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_key text := org_scope_cache_key('enf|' || coalesce(p_tenant_id::text, '-'));
  v_hit text := current_setting('jewelos.org_scope_c_enf', true); v_actor uuid; v_tenant uuid; v_out boolean;
begin
  if v_hit is not null and left(v_hit, length(v_key)) = v_key then
    return substr(v_hit, length(v_key) + 1)::boolean;
  end if;
  if org_isolation_switch_on(p_tenant_id) then
    v_out := true;
  else
    select p.id, p.tenant_id into v_actor, v_tenant from current_profile() p;
    v_out := v_actor is not null and v_tenant = p_tenant_id and org_is_director(v_actor);
  end if;
  perform set_config('jewelos.org_scope_c_enf', v_key || v_out::text, true);
  return v_out;
end $$;

create or replace function org_has_company_scope(p_profile_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_key text := org_scope_cache_key('co|' || coalesce(p_profile_id::text, '-'));
  v_hit text := current_setting('jewelos.org_scope_c_co', true); v_out boolean;
begin
  if v_hit is not null and left(v_hit, length(v_key)) = v_key then
    return substr(v_hit, length(v_key) + 1)::boolean;
  end if;
  select org_profile_is_active(p_profile_id) and exists (
    select 1 from user_profiles p left join user_access_profiles a on a.user_profile_id = p.id
    where p.id = p_profile_id and (
      coalesce(a.dashboard_authority, p.user_role) = 'super_admin'
      or exists (select 1 from org_scope_grants g where g.user_profile_id = p.id and g.tenant_id = p.tenant_id
        and g.revoked_at is null and g.scope_level = 'company')
      or (coalesce(a.dashboard_authority, p.user_role) = 'admin'
        and not exists (select 1 from org_scope_grants g where g.user_profile_id = p.id and g.tenant_id = p.tenant_id
          and g.revoked_at is null and g.authority = 'director' and g.scope_level <> 'company'))))
  into v_out;
  v_out := coalesce(v_out, false);
  perform set_config('jewelos.org_scope_c_co', v_key || v_out::text, true);
  return v_out;
end $$;

create or replace function org_scope_branch_ids(p_profile_id uuid, p_manage boolean)
returns uuid[] language plpgsql stable security definer set search_path = public as $$
declare v_key text := org_scope_cache_key('br|' || coalesce(p_profile_id::text, '-') || '|' || coalesce(p_manage::text, '-'));
  v_hit text := current_setting('jewelos.org_scope_c_br', true); v_out uuid[]; v_company boolean;
begin
  if v_hit is not null and left(v_hit, length(v_key)) = v_key then
    return substr(v_hit, length(v_key) + 1)::uuid[];
  end if;
  v_company := org_has_company_scope(p_profile_id);
  with actor as (
    select p.* from user_profiles p where p.id = p_profile_id and org_profile_is_active(p.id)
  ), grants as (
    select g.* from org_scope_grants g join actor a on a.id = g.user_profile_id and a.tenant_id = g.tenant_id
    where g.revoked_at is null
  ), automatic as (
    select s.franchise_group_id from actor a cross join lateral org_automatic_scope(a.id) s
  )
  select coalesce(array_agg(b.id order by b.id), '{}'::uuid[]) into v_out
  from branches b join actor a on a.tenant_id = b.tenant_id
  where v_company
    or (not p_manage and b.id = a.branch_id)
    or b.manager_id = a.id
    or exists (select 1 from automatic s where s.franchise_group_id = b.franchise_group_id)
    or exists (select 1 from grants g join franchise_groups f on f.id = g.franchise_group_id and f.tenant_id = g.tenant_id and f.is_active
               where g.scope_level = 'franchise' and g.franchise_group_id = b.franchise_group_id)
    or exists (select 1 from grants g where g.scope_level = 'branch' and g.branch_id = b.id
               and (not p_manage or g.authority in ('store_manager', 'director')));
  perform set_config('jewelos.org_scope_c_br', v_key || v_out::text, true);
  return v_out;
end $$;

-- Same rule as 0386. It runs once per task row in Dashboard, Reports and Task Control,
-- so it remembers the actor's whole answer ('*' = every store, else the store list)
-- and each row costs one lookup.
create or replace function org_branch_visible(p_tenant_id uuid, p_actor_id uuid, p_branch_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_key text := org_scope_cache_key('vis|' || coalesce(p_tenant_id::text, '-') || '|' || coalesce(p_actor_id::text, '-'));
  v_hit text := current_setting('jewelos.org_scope_c_vis', true); v_set text;
begin
  if v_hit is not null and left(v_hit, length(v_key)) = v_key then
    v_set := substr(v_hit, length(v_key) + 1);
  else
    v_set := case
      when not org_scope_enforced(p_tenant_id) then '*'
      when p_actor_id is null then '{}'
      when org_has_company_scope(p_actor_id) then '*'
      else org_scope_branch_ids(p_actor_id, false)::text end;
    perform set_config('jewelos.org_scope_c_vis', v_key || v_set, true);
  end if;
  return v_set = '*' or (p_branch_id is not null and p_branch_id = any(v_set::uuid[]));
end $$;

revoke all on function org_scope_enforced(uuid), org_has_company_scope(uuid), org_scope_branch_ids(uuid, boolean),
  org_branch_visible(uuid, uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Home: recent activity from in-scope people, read per person through the index.
-- Same rows as 0387: Super Admin and company Admins see the whole tenant; a scoped
-- Admin/Director sees people homed in their stores; a Manager sees their store's
-- people; everyone sees their own entries.
-- ---------------------------------------------------------------------------
create or replace function public.get_home_summary(p_context jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $function$
declare v_actor user_profiles; v_context jsonb; v_today date; v_tasks jsonb; v_fms jsonb; v_forms jsonb; v_followups jsonb; v_activity jsonb; v_unread integer; v_availability text; v_actions jsonb;
  v_filter uuid[]; v_people uuid[];
begin
  perform public.assert_module_access('home');
  v_actor:=assert_reporting_actor();
  perform assert_json_keys(coalesce(p_context,'{}'::jsonb),array[]::text[],'home context');
  v_context:=reporting_context_for_actor(v_actor.id,jsonb_build_object('preset','today'));
  v_today:=(v_context->>'local_start')::date;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.overdue desc,q.priority_order,q.due_at,q.id),'[]'::jsonb) into v_tasks from (
    select ti.id,ti.title,ti.task_type,ti.priority,ti.status,coalesce(ti.revised_datetime,ti.planned_datetime) due_at,
      (ti.status not in ('completed','rejected') and coalesce(ti.revised_datetime,ti.planned_datetime)<now()) overdue,
      case ti.priority when 'high' then 1 when 'medium' then 2 else 3 end priority_order,
      coalesce((select round(100.0*count(*) filter(where tc.is_completed)/nullif(count(*),0),1) from (select * from public.task_checklists where deleted_at is null) tc where tc.task_instance_id=ti.id and tc.is_required),null) checklist_completion
    from public.task_instances_live ti
    where ti.tenant_id=v_actor.tenant_id
      and ti.status not in ('completed','rejected')
      and exists(select 1 from task_assignees ta where ta.task_instance_id=ti.id and ta.user_profile_id=v_actor.id and ta.is_active)
    order by overdue desc,priority_order,due_at nulls last,id limit 10
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.planned_datetime nulls last,q.stage_id),'[]'::jsonb) into v_fms from (
    select fis.id stage_id,fi.id instance_id,fi.reference_number,fi.title instance_title,fs.name stage_name,fis.status,fis.planned_datetime,fis.sla_breached
    from fms_instance_stages fis join fms_instances fi on fi.id=fis.fms_instance_id join fms_stages fs on fs.id=fis.fms_stage_id
    where fis.status in ('pending','in_progress','in_review','blocked','overdue')
      and fi.tenant_id=v_actor.tenant_id
      and exists(select 1 from fms_instance_stage_assignees a where a.fms_instance_stage_id=fis.id and a.user_profile_id=v_actor.id and a.is_active)
    order by fis.planned_datetime nulls last,fis.id limit 6
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.due_at nulls last,q.task_id),'[]'::jsonb) into v_forms from (
    select ti.id task_id,ti.form_template_id,ft.name form_name,ti.title task_title,coalesce(ti.revised_datetime,ti.planned_datetime) due_at
    from public.task_instances_live ti join form_templates ft on ft.id=ti.form_template_id
    where ti.requires_form and ti.form_template_id is not null and ti.status not in ('completed','rejected')
      and ti.tenant_id=v_actor.tenant_id
      and exists(select 1 from task_assignees ta where ta.task_instance_id=ti.id and ta.user_profile_id=v_actor.id and ta.is_active)
      and not exists(select 1 from form_submissions fs where fs.linked_module='task' and fs.linked_record_id=ti.id and fs.form_template_id=ti.form_template_id and fs.submitted_by=v_actor.id)
    order by due_at nulls last,ti.id limit 6
  ) q;

  select coalesce(jsonb_agg(to_jsonb(q) order by q.overdue desc,q.due_date nulls last,q.id),'[]'::jsonb) into v_followups from (
    select f.id,f.client_id,f.subject,f.due_date,f.status,(f.due_date<v_today) overdue
    from client_followups f
    where f.tenant_id=v_actor.tenant_id and f.status='open' and f.assigned_to=v_actor.id
    order by overdue desc,f.due_date nulls last,f.id limit 6
  ) q;

  select count(*)::integer into v_unread from notifications n where n.tenant_id=v_actor.tenant_id and n.user_profile_id=v_actor.id and not n.is_read;
  select ua.status::text into v_availability from user_availability ua where ua.user_profile_id=v_actor.id and ua.date=v_today;

  if v_actor.user_role in ('super_admin','admin') then
    v_filter:=org_branch_filter_for(v_actor.tenant_id,v_actor.id);
  end if;
  if v_actor.user_role in ('super_admin','admin') and v_filter is null then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]'::jsonb) into v_activity from (
      select a.id,a.action,a.module,a.created_at from audit_logs a where a.tenant_id=v_actor.tenant_id
      order by a.created_at desc,a.id desc limit 8
    ) q;
  else
    select coalesce(array_agg(p.id),'{}'::uuid[]) into v_people from user_profiles p
    where p.tenant_id=v_actor.tenant_id and (p.id=v_actor.id
      or (v_actor.user_role in ('super_admin','admin') and p.branch_id=any(v_filter))
      or (v_actor.user_role='manager' and p.branch_id=v_actor.branch_id));
    select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc,q.id desc),'[]'::jsonb) into v_activity from (
      select r.id,r.action,r.module,r.created_at
      from unnest(v_people) person(id)
      cross join lateral (
        select a.id,a.action,a.module,a.created_at from audit_logs a
        where a.tenant_id=v_actor.tenant_id and a.actor_user_id=person.id
        order by a.created_at desc,a.id desc limit 8
      ) r
      order by r.created_at desc,r.id desc limit 8
    ) q;
  end if;

  v_actions:=case
    when v_actor.user_role in ('super_admin','admin','manager') then '["/tasks/checklist","/tasks/delegation","/tasks/fms","/forms","/reports"]'::jsonb
    when v_actor.user_role='crm' then '["/crm","/tasks/checklist","/tasks/fms","/forms","/reports"]'::jsonb
    else '["/tasks/checklist","/tasks/delegation","/tasks/fms","/forms"]'::jsonb end;
  return jsonb_build_object('generated_at',now(),'tenant_local_date',v_today,'timezone',v_context->>'timezone',
    'profile',jsonb_build_object('id',v_actor.id,'name',v_actor.employee_name,'role',v_actor.user_role,'branch_id',v_actor.branch_id,
      'branch_name',(select b.name from branches b where b.id=v_actor.branch_id),'department_id',v_actor.department_id,
      'department_name',(select d.name from departments d where d.id=v_actor.department_id),'working_status',v_actor.working_status),
    'tasks',v_tasks,'fms_stages',v_fms,'forms_awaiting_submission',v_forms,'crm_followups',v_followups,
    'unread_notifications',v_unread,'availability_status',v_availability,'recent_activity',v_activity,'quick_actions',v_actions);
end $function$;

notify pgrst, 'reload schema';
