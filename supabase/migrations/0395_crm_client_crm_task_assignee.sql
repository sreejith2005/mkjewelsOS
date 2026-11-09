-- CRM forms -> FMS: the task goes to the client's CRM, not the salesperson.
--
-- 1. A CRM event may name the client's CRM (`crm_jewelos_user_id`: the CRM recorded on the
--    walk-in visit, else today's round-robin CRM from the Client Queue). For CRM sources the
--    "person the source names" is now that CRM; the salesperson is only the fallback when no
--    active CRM can be resolved. Forms Library sources are unchanged (the submitter).
-- 2. Whoever holds an open step of a CRM-started run can hand it over to another CRM, or to a
--    salesperson of the run's branch (audited, the new person is notified). Managers keep the
--    existing Reassign (reassign_fms_stage_with_audit), which is unchanged.
-- 3. Work that nothing names is no longer called by its long FMS reference number: the CRM
--    client's name, a written run title, or "Workflow — Step".
-- Existing events, runs and assignments are not rewritten.
set search_path=public,extensions;

-- Patch by exact marker; drift stops the migration.
create function pg_temp.patch_client_crm(p_signature text,p_old text,p_new text,p_expected integer default 1)
returns void language plpgsql as $$
declare body text; matches integer;
begin
  body:=replace(pg_get_functiondef(p_signature::regprocedure),E'\r','');
  matches:=(length(body)-length(replace(body,p_old,'')))/length(p_old);
  if matches<>p_expected then raise exception 'client CRM patch: expected % match(es) in %, found %',p_expected,p_signature,matches; end if;
  execute replace(body,p_old,p_new);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 1. One rule for "is this person a CRM or a salesperson" (department), shared with the roster.
-- ---------------------------------------------------------------------------------------------
create function crm_department_choice(p_name text,p_code text) returns text
language sql immutable set search_path=public as $$
  select case
    when upper(btrim(coalesce(p_code,'')))='CRM' or regexp_replace(lower(btrim(coalesce(p_name,''))),'[^a-z0-9]','','g') in ('crm','customerrelationshipmanagement','customerrelations') then 'crm'
    when regexp_replace(lower(btrim(coalesce(p_name,''))),'[^a-z0-9]','','g') in ('sales','salespeople','salesperson','salesdepartment') then 'sales'
    else 'other' end
$$;

-- The roster (0231, franchise branches from 0386 kept) now asks the same rule. Same results:
-- crm_department_choice normalizes the already-normalized name and code again.
select pg_temp.patch_client_crm('crm_sync.staff_roster_fields(uuid)',
  $o$if v_department_code='CRM' or v_department in ('crm', 'customerrelationshipmanagement', 'customerrelations') then v_choice := 'crm';$o$
    ||E'\n'||$o$  elsif v_department in ('sales', 'salespeople', 'salesperson', 'salesdepartment') then v_choice := 'sales'; end if;$o$,
  $n$v_choice := crm_department_choice(v_department, v_department_code);$n$);

-- ---------------------------------------------------------------------------------------------
-- 2. CRM events carry the client's CRM; CRM-started runs give the first step to that CRM.
-- ---------------------------------------------------------------------------------------------
-- The CRM is resolved inside this tenant only, like the salesperson (never by name).
select pg_temp.patch_client_crm('public.crm_sync_apply_submission_event(text,jsonb)',
  $o$v_answers:=(v_answers-'branch_id'-'staff_profile_id')||jsonb_strip_nulls(jsonb_build_object('branch_id',v_branch,'staff_profile_id',v_staff));$o$,
  $n$v_answers:=(v_answers-'branch_id'-'staff_profile_id'-'crm_profile_id')||jsonb_strip_nulls(jsonb_build_object('branch_id',v_branch,'staff_profile_id',v_staff,
        'crm_profile_id',(select p.id from user_profiles p where p.tenant_id=v_tenant
          and p.id=case when coalesce(p_payload->>'crm_jewelos_user_id','')~v_uuid then (p_payload->>'crm_jewelos_user_id')::uuid end)));$n$);

select pg_temp.patch_client_crm('public.fms_trigger_start_run(public.fms_flows,public.fms_trigger_events,text)',
  $o$if p_event.staff_profile_id is not null then staff:=fms_trigger_active_staff(p_event.tenant_id,p_event.staff_profile_id); end if;$o$,
  $n$-- CRM sources: the client's CRM first; the salesperson only when no active CRM is known.
  if p_event.source_type in ('crm_walkin','crm_queue','crm_lead','crm_linked_form')
    and coalesce(p_event.payload->>'crm_profile_id','')~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    staff:=fms_trigger_active_staff(p_event.tenant_id,(p_event.payload->>'crm_profile_id')::uuid);
  end if;
  if staff.id is null and p_event.staff_profile_id is not null then staff:=fms_trigger_active_staff(p_event.tenant_id,p_event.staff_profile_id); end if;$n$);

-- The builder's test panel previews the same person.
select pg_temp.patch_client_crm('public.test_fms_start_trigger(uuid,jsonb,jsonb)',
  $o$coalesce(v_answers->>'staff_profile_id',v_answers->>'submitted_by'$o$,
  $n$coalesce(case when coalesce(v_answers->>'crm_profile_id','')~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      case when (fms_trigger_active_staff(f.tenant_id,(v_answers->>'crm_profile_id')::uuid)).id is not null then v_answers->>'crm_profile_id' end end,
    v_answers->>'staff_profile_id',v_answers->>'submitted_by'$n$,2);

-- ---------------------------------------------------------------------------------------------
-- 3. Friendly name for work that nothing else names.
-- ---------------------------------------------------------------------------------------------
create function fms_run_display_name(p_instance_id uuid,p_stage_name text) returns text
language sql stable security definer set search_path=public as $$
  select coalesce(
    -- A run started from a CRM form: the customer's name.
    (select fms_normalize_record_name(e.payload->>'client_name') from fms_instance_trigger_sources src
      join fms_trigger_events e on e.id=src.event_id
      where src.fms_instance_id=i.id and src.source_type in ('crm_walkin','crm_queue','crm_linked_form') limit 1),
    -- A title somebody wrote (manual start, or a trigger title that adds a value).
    case when lower(btrim(i.title)) not in (lower(btrim(f.name)),lower(btrim(f.name||' · Form submission')))
      and i.title is distinct from i.reference_number then fms_normalize_record_name(i.title) end,
    left(f.name||' — '||coalesce(p_stage_name,'Step'),120))
  from fms_instances i join fms_flows f on f.id=i.fms_flow_id where i.id=p_instance_id
$$;

select pg_temp.patch_client_crm('public.fms_work_record_name_authorized(uuid)',
  $o$v_instance.reference_number,'Assigned work')$o$,
  $n$fms_run_display_name(v_instance.id,v_stage.name),'Assigned work')$n$);

-- ---------------------------------------------------------------------------------------------
-- 4. Hand over a CRM task: the person doing it passes it to another CRM or a salesperson.
-- ---------------------------------------------------------------------------------------------
create function fms_crm_handover_allowed(p_actor user_profiles,p_stage fms_instance_stages,p_instance fms_instances) returns boolean
language sql stable security definer set search_path=public as $$
  select p_actor.id is not null and p_stage.id is not null and p_instance.id is not null
    and p_instance.tenant_id=p_actor.tenant_id and current_profile_is_active()
    and p_instance.status in ('active','overdue') and p_stage.status in ('pending','in_progress','in_review','overdue')
    and p_actor.id=any(p_stage.assigned_to)
    and exists(select 1 from fms_instance_trigger_sources src where src.fms_instance_id=p_instance.id
      and src.source_type in ('crm_walkin','crm_queue','crm_lead','crm_linked_form'))
$$;

-- Who this step can go to. Empty when the viewer may not hand it over.
create function fms_crm_handover_candidates(p_instance_stage_id uuid)
returns table(id uuid,employee_name text,team text,branch_id uuid)
language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile(); s fms_instance_stages; i fms_instances;
begin
  perform assert_module_enabled('fms_builder');
  select * into s from fms_instance_stages w where w.id=p_instance_stage_id;
  select * into i from fms_instances x where x.id=s.fms_instance_id;
  if not coalesce(fms_crm_handover_allowed(a,s,i),false) then return; end if;
  return query
    select p.id,p.employee_name::text,c.team,p.branch_id
    from user_profiles p
    join departments d on d.id=p.department_id and d.tenant_id=p.tenant_id and d.is_active
    cross join lateral (select crm_department_choice(d.name,d.code) team) c
    where p.tenant_id=i.tenant_id and p.account_status='active' and p.working_status='active' and p.is_login_enabled
      and not p.id=any(s.assigned_to)
      and (c.team='crm' or (c.team='sales' and (i.branch_id is null or p.branch_id=i.branch_id)))
    order by c.team,p.employee_name,p.id;
end $$;

create function handover_fms_step_with_audit(p_instance_stage_id uuid,p_to_user_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile(); s fms_instance_stages; i fms_instances; t user_profiles; d fms_stages; f fms_flows;
  v_team text; v_reason text:=left(nullif(btrim(coalesce(p_reason,'')),''),1000);
begin
  perform assert_module_enabled('fms_builder');
  select * into s from fms_instance_stages w where w.id=p_instance_stage_id for update;
  select * into i from fms_instances x where x.id=s.fms_instance_id for update;
  if not coalesce(fms_crm_handover_allowed(a,s,i),false) then
    raise exception 'Only the person doing this task can hand it over' using errcode='42501';
  end if;
  if v_reason is null then raise exception 'Write why you are handing it over' using errcode='23514'; end if;
  t:=assert_direct_assignment_user(p_to_user_id,i.tenant_id,'FMS');
  if t.id=any(s.assigned_to) then raise exception 'This person already has this task' using errcode='23514'; end if;
  select crm_department_choice(dep.name,dep.code) into v_team
  from departments dep where dep.id=t.department_id and dep.tenant_id=t.tenant_id and dep.is_active;
  if coalesce(v_team,'other')='other' or (v_team='sales' and i.branch_id is not null and t.branch_id is distinct from i.branch_id) then
    raise exception 'Hand it over to a CRM, or to a salesperson of this branch' using errcode='23514';
  end if;

  update fms_instance_stage_assignees set is_active=false,status='reassigned'
    where fms_instance_stage_id=s.id and user_profile_id=a.id and is_active;
  insert into fms_instance_stage_assignees(tenant_id,fms_instance_stage_id,user_profile_id,assigned_by) values(i.tenant_id,s.id,t.id,a.id);
  update fms_instance_stages set assigned_to=array_replace(assigned_to,a.id,t.id),updated_at=now() where id=s.id;
  -- The task left this person's list, so their alert for it is closed (history kept).
  update notifications set is_read=true,read_at=coalesce(read_at,now())
    where tenant_id=i.tenant_id and user_profile_id=a.id and event_type='fms_stage_assigned' and source_module='fms' and source_record_id=s.id and not is_read;
  insert into fms_stage_logs(fms_instance_stage_id,actor_id,action,details)
    values(s.id,a.id,'reassigned',jsonb_build_object('from',a.id,'to',t.id,'handover',true,'team',v_team,'reason',v_reason));
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,old_value,new_value)
    values(i.tenant_id,a.id,'fms_stage_handed_over','fms_instance_stages',s.id,jsonb_build_object('assigned_to',a.id),
      jsonb_build_object('assigned_to',t.id,'team',v_team,'reason',v_reason));

  select * into d from fms_stages where id=s.fms_stage_id;
  select * into f from fms_flows where id=i.fms_flow_id;
  perform enqueue_notification_event(i.tenant_id,i.branch_id,i.department_id,'fms_stage_assigned','fms',s.id,a.id,
    jsonb_build_object('actor_name',a.employee_name,'assignee_name',t.employee_name,'flow_name',f.name,'stage_name',d.name,
      'reference',i.reference_number,'planned_datetime',coalesce(s.planned_datetime,now()),'priority',i.priority,
      '_assigned_user_ids',jsonb_build_array(t.id),'_instance_starter_id',i.started_by,
      '_link_url','/tasks/fms?instance='||i.id||'&stage='||s.id||coalesce('&form='||d.form_template_id,'')),
    'fms_stage_assigned:'||s.id||':handover:'||t.id||':'||(extract(epoch from clock_timestamp())*1000)::bigint,now());
  return jsonb_build_object('assigneeId',t.id,'assigneeName',t.employee_name,'team',v_team);
end $$;

drop function pg_temp.patch_client_crm(text,text,text,integer);

revoke all on function crm_department_choice(text,text),fms_run_display_name(uuid,text),
  fms_crm_handover_allowed(user_profiles,fms_instance_stages,fms_instances) from public,anon,authenticated,service_role;
revoke all on function fms_crm_handover_candidates(uuid),handover_fms_step_with_audit(uuid,uuid,text) from public,anon,service_role;
grant execute on function fms_crm_handover_candidates(uuid),handover_fms_step_with_audit(uuid,uuid,text) to authenticated;
notify pgrst,'reload schema';
