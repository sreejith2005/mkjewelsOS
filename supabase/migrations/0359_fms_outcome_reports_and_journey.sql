-- Read-only FMS reporting for the unified workflow workspace:
--   get_fms_flow_report        cohort KPIs, End Node counts and stage reach for one workflow family
--   get_fms_library_outcomes   concise counts for every workflow card in the FMS library
--   get_fms_flow_records       one paginated, filtered row per workflow instance
--   get_fms_instance_journey   the persisted history of one instance, with its outcome
-- Every read is server-side, tenant-scoped and limited to instances the caller may
-- read under the same rule as fms_instances RLS (can_read_fms_instance). Counts come
-- from fms_instances and fms_instance_outcomes, never from a browser-side list.
set search_path=public,extensions;

create index fms_instance_stages_report on fms_instance_stages(fms_instance_id,fms_stage_id);

create function fms_report_validate(p_filter jsonb,p_keys text[]) returns void
language plpgsql stable security definer set search_path=public as $$
declare v_from date; v_to date; selector text;
begin
  perform assert_module_enabled('fms_builder');
  if not current_profile_is_active() or (current_profile()).id is null then raise exception 'FMS report access denied' using errcode='42501'; end if;
  if p_filter is null or jsonb_typeof(p_filter)<>'object'
    or exists(select 1 from jsonb_each(p_filter) e where not (e.key=any(p_keys)) or jsonb_typeof(e.value)<>'string')
    or length(coalesce(p_filter->>'query',''))>200 then raise exception 'Invalid FMS report filters' using errcode='22023'; end if;
  foreach selector in array array[nullif(p_filter->>'flowId',''),nullif(p_filter->>'branchId',''),nullif(p_filter->>'assigneeId','')] loop
    if selector is not null and selector !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then raise exception 'Invalid FMS report selector' using errcode='22023'; end if;
  end loop;
  if coalesce(p_filter->>'outcome','') not in ('','won','lost','do_not_contact','other','unspecified') then raise exception 'Invalid FMS outcome filter' using errcode='22023'; end if;
  begin
    v_from:=nullif(p_filter->>'from','')::date; v_to:=nullif(p_filter->>'to','')::date;
    if v_from>v_to then raise exception 'Invalid range'; end if;
  exception when others then raise exception 'Invalid FMS report period' using errcode='22023'; end;
end $$;

-- Instances of one family the caller may read, with their recorded outcome.
-- "outcome" is the End Node class, or "unspecified" for a completion without an End Node.
create function fms_report_instances(p_family_id uuid,p_filter jsonb)
returns table(id uuid,status text,started_at timestamptz,completed_at timestamptz,fms_flow_id uuid,flow_version integer,branch_id uuid,
  outcome text,end_stage_key text,end_stage_name text,closed_at timestamptz)
language sql stable security definer set search_path=public as $$
  select i.id,i.status::text,i.started_at,i.completed_at,i.fms_flow_id,i.flow_version,i.branch_id,
    case when i.status='completed' then coalesce(o.outcome,'unspecified') end,o.end_stage_key,o.end_stage_name,coalesce(o.closed_at,i.completed_at)
  from fms_instances i left join fms_instance_outcomes o on o.fms_instance_id=i.id
  where i.tenant_id=current_tenant_id() and i.flow_family_id=p_family_id
    and (nullif(p_filter->>'flowId','') is null or i.fms_flow_id=(p_filter->>'flowId')::uuid)
    and (nullif(p_filter->>'branchId','') is null or i.branch_id=(p_filter->>'branchId')::uuid)
    and can_read_fms_instance(i.id)
$$;

create function fms_report_in_period(p_at timestamptz,p_filter jsonb) returns boolean
language sql stable set search_path=public as $$
  select p_at is not null
    and (nullif(p_filter->>'from','') is null or p_at>=(p_filter->>'from')::date::timestamp at time zone 'Asia/Kolkata')
    and (nullif(p_filter->>'to','') is null or p_at<((p_filter->>'to')::date+1)::timestamp at time zone 'Asia/Kolkata')
$$;

create function get_fms_flow_report(p_family_id uuid,p_filter jsonb default '{}') returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare result jsonb;
begin
  perform fms_report_validate(p_filter,array['from','to','flowId','branchId','outcome']);
  if p_family_id is null then raise exception 'Choose a workflow' using errcode='22023'; end if;
  with visible as materialized (select * from fms_report_instances(p_family_id,p_filter)),
  -- Cohort: instances started in the period, with their current or final state.
  cohort as materialized (select * from visible v where fms_report_in_period(v.started_at,p_filter)
    and (nullif(p_filter->>'outcome','') is null or v.outcome=p_filter->>'outcome')),
  definitions as (
    select distinct on (s.stage_key) s.stage_key,s.name,s.step_type::text step_type,s.sort_order,fms_end_node_outcome(s.planned_time_rule) end_outcome
    from fms_stages s join fms_flows f on f.id=s.fms_flow_id
    where f.tenant_id=current_tenant_id() and coalesce(f.family_id,f.id)=p_family_id and f.status<>'draft'
      and (nullif(p_filter->>'flowId','') is null or f.id=(p_filter->>'flowId')::uuid)
    order by s.stage_key,f.version desc
  ),
  reach as (
    select s.stage_key,count(distinct w.fms_instance_id) instances,count(*) visits
    from cohort c join fms_instance_stages w on w.fms_instance_id=c.id join fms_stages s on s.id=w.fms_stage_id
    where coalesce(w.outcome,'') not in ('condition_skipped') group by s.stage_key
  ),
  ends as (select end_stage_key,count(distinct id) instances from cohort where end_stage_key is not null group by end_stage_key),
  totals as (select count(*) started,
      count(*) filter(where status in ('active','overdue')) running,count(*) filter(where status='on_hold') on_hold,
      count(*) filter(where status='completed') completed,count(*) filter(where status='cancelled') cancelled,
      count(*) filter(where outcome='won') won,count(*) filter(where outcome='lost') lost,count(*) filter(where outcome='do_not_contact') do_not_contact,
      count(*) filter(where outcome='other') other,count(*) filter(where outcome='unspecified') unspecified from cohort),
  closed_in_period as (select count(*) completed,count(*) filter(where outcome='won') won,count(*) filter(where outcome='lost') lost,
      count(*) filter(where outcome='do_not_contact') do_not_contact,count(*) filter(where outcome='other') other,count(*) filter(where outcome='unspecified') unspecified
    from visible where status='completed' and fms_report_in_period(closed_at,p_filter)
      and (nullif(p_filter->>'outcome','') is null or outcome=p_filter->>'outcome'))
  select jsonb_build_object(
    'period',jsonb_build_object('from',nullif(p_filter->>'from',''),'to',nullif(p_filter->>'to',''),'timeZone','Asia/Kolkata'),
    'started',t.started,'running',t.running,'onHold',t.on_hold,'completed',t.completed,'cancelled',t.cancelled,
    'won',t.won,'lost',t.lost,'doNotContact',t.do_not_contact,'other',t.other,'unspecified',t.unspecified,
    'conversionPercent',case when t.started=0 then 0 else round(t.won*100.0/t.started,1) end,
    'endNodes',coalesce((select jsonb_agg(jsonb_build_object('stageKey',d.stage_key,'name',d.name,'outcome',coalesce(d.end_outcome,'unspecified'),'instances',coalesce(e.instances,0)) order by d.sort_order,d.stage_key)
      from definitions d left join ends e on e.end_stage_key=d.stage_key where d.step_type='end'),'[]'),
    'stages',coalesce((select jsonb_agg(jsonb_build_object('stageKey',d.stage_key,'name',d.name,'type',d.step_type,'instances',coalesce(r.instances,0),'visits',coalesce(r.visits,0)) order by d.sort_order,d.stage_key)
      from definitions d left join reach r on r.stage_key=d.stage_key where d.step_type not in ('branch','parallel_start','parallel_join','notification')),'[]'),
    'completedInPeriod',(select jsonb_build_object('completed',c.completed,'won',c.won,'lost',c.lost,'doNotContact',c.do_not_contact,'other',c.other,'unspecified',c.unspecified) from closed_in_period c)
  ) into result from totals t;
  return result;
end $$;

create function get_fms_library_outcomes() returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=(current_profile()).id; result jsonb;
begin
  perform fms_report_validate('{}',array[]::text[]);
  select coalesce(jsonb_agg(jsonb_build_object('familyId',family_id,'started',started,'running',running,'onHold',on_hold,'completed',completed,'cancelled',cancelled,
    'won',won,'lost',lost,'doNotContact',do_not_contact,'other',other,'unspecified',unspecified,'mine',mine) order by family_id),'[]') into result
  from (
    select i.flow_family_id family_id,count(*) started,count(*) filter(where i.status in ('active','overdue')) running,count(*) filter(where i.status='on_hold') on_hold,
      count(*) filter(where i.status='completed') completed,count(*) filter(where i.status='cancelled') cancelled,
      count(*) filter(where o.outcome='won') won,count(*) filter(where o.outcome='lost') lost,count(*) filter(where o.outcome='do_not_contact') do_not_contact,
      count(*) filter(where o.outcome='other') other,count(*) filter(where i.status='completed' and o.id is null) unspecified,
      count(*) filter(where i.status in ('active','overdue') and exists(select 1 from fms_instance_stages w where w.fms_instance_id=i.id and actor=any(w.assigned_to) and w.status in ('pending','in_progress','in_review','overdue'))) mine
    from fms_instances i left join fms_instance_outcomes o on o.fms_instance_id=i.id
    where i.tenant_id=current_tenant_id() and can_read_fms_instance(i.id)
    group by i.flow_family_id
  ) counts;
  return result;
end $$;

create function get_fms_flow_records(p_family_id uuid,p_filter jsonb default '{}',p_offset integer default 0,p_limit integer default 25) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare actor uuid:=(current_profile()).id; result jsonb; q text:=lower(btrim(coalesce(p_filter->>'query',''))); status_filter text:=coalesce(nullif(p_filter->>'status',''),'all');
begin
  perform fms_report_validate(p_filter,array['query','status','stageKey','assigneeId','from','to','flowId','branchId','outcome','scope']);
  if p_family_id is null or p_offset is null or p_offset<0 or p_limit is null or p_limit not between 1 and 50 then raise exception 'Invalid FMS record page' using errcode='22023'; end if;
  if status_filter not in ('all','running','overdue','on_hold','completed','won','lost','do_not_contact','other','unspecified','cancelled')
    or coalesce(nullif(p_filter->>'scope',''),'all') not in ('all','mine') or length(coalesce(p_filter->>'stageKey',''))>64 then raise exception 'Invalid FMS record filters' using errcode='22023'; end if;
  with base as materialized (
    select v.*,i.reference_number,i.title,i.started_by,i.updated_at,i.cancelled_at,
      (select w.id from fms_instance_stages w where w.fms_instance_id=v.id order by w.created_at desc,cardinality(w.execution_path) desc,w.id desc limit 1) latest_visit
    from fms_report_instances(p_family_id,p_filter) v join fms_instances i on i.id=v.id
    where fms_report_in_period(v.started_at,p_filter) or (nullif(p_filter->>'from','') is null and nullif(p_filter->>'to','') is null)
  ), open_work as materialized (
    select w.fms_instance_id,w.id visit_id,s.stage_key,s.name stage_name,w.status::text status,w.planned_datetime due_at,w.assigned_to,s.form_template_id,w.visit_number,
      (w.status='overdue' or w.planned_datetime<now()) late
    from base b join fms_instance_stages w on w.fms_instance_id=b.id join fms_stages s on s.id=w.fms_stage_id
    where b.status in ('active','overdue','on_hold') and w.status in ('pending','in_progress','in_review','overdue') and s.step_type<>'end'
  ), rows as materialized (
    select b.*,
      exists(select 1 from open_work o where o.fms_instance_id=b.id and o.late) is_overdue,
      exists(select 1 from open_work o where o.fms_instance_id=b.id and actor=any(o.assigned_to)) is_mine
    from base b
  ), filtered as materialized (
    select r.* from rows r
    where case status_filter when 'all' then true when 'running' then r.status in ('active','overdue') when 'overdue' then r.status in ('active','overdue') and r.is_overdue
      when 'on_hold' then r.status='on_hold' when 'completed' then r.status='completed' when 'cancelled' then r.status='cancelled' else r.outcome=status_filter end
      and (nullif(p_filter->>'outcome','') is null or r.outcome=p_filter->>'outcome')
      and (coalesce(nullif(p_filter->>'scope',''),'all')='all' or r.is_mine or r.started_by=actor)
      and (nullif(p_filter->>'stageKey','') is null or exists(select 1 from open_work o where o.fms_instance_id=r.id and o.stage_key=p_filter->>'stageKey')
        or r.end_stage_key=p_filter->>'stageKey')
      and (nullif(p_filter->>'assigneeId','') is null or exists(select 1 from open_work o where o.fms_instance_id=r.id and (p_filter->>'assigneeId')::uuid=any(o.assigned_to)))
      and (q='' or strpos(lower(concat_ws(' ',r.reference_number,r.title)),q)>0 or strpos(lower(coalesce(fms_work_record_name(r.latest_visit),'')),q)>0)
  ), page as (select * from filtered order by (status in ('active','overdue','on_hold')) desc,is_overdue desc,started_at desc,id limit p_limit offset p_offset)
  select jsonb_build_object('total',(select count(*) from filtered),'records',coalesce((select jsonb_agg(jsonb_build_object(
      'id',p.id,'reference',p.reference_number,'title',p.title,'name',coalesce(fms_work_record_name(p.latest_visit),p.title),
      'status',p.status,'outcome',p.outcome,'endStageName',p.end_stage_name,'closedAt',p.closed_at,'cancelledAt',p.cancelled_at,
      'startedAt',p.started_at,'version',p.flow_version,'overdue',p.is_overdue,
      'updatedAt',greatest(p.updated_at,(select max(w.updated_at) from fms_instance_stages w where w.fms_instance_id=p.id)),
      'current',coalesce((select jsonb_agg(jsonb_build_object('visitId',o.visit_id,'stageKey',o.stage_key,'stageName',o.stage_name,'status',o.status,'dueAt',o.due_at,'overdue',o.late,
          'visitNumber',o.visit_number,'assignees',(select coalesce(jsonb_agg(u.employee_name order by u.employee_name),'[]') from user_profiles u where u.id=any(o.assigned_to) and u.tenant_id=current_tenant_id()),
          'mine',actor=any(o.assigned_to),'formTemplateId',o.form_template_id) order by o.due_at nulls last,o.visit_id)
        from open_work o where o.fms_instance_id=p.id),'[]')
    ) order by (p.status in ('active','overdue','on_hold')) desc,p.is_overdue desc,p.started_at desc,p.id) from page p),'[]')) into result;
  return result;
end $$;

/*
 * The journey of one instance from its persisted visits, logs and outcome: what
 * actually ran, in order, with repeated visits numbered. Nothing is inferred
 * from the workflow definition. Route answers are limited to the questions the
 * step's routes read, so a reader never receives a whole private form.
 */
create function get_fms_instance_journey(p_instance_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare i fms_instances; result jsonb;
begin
  perform assert_module_enabled('fms_builder');
  if not current_profile_is_active() or p_instance_id is null or not can_read_fms_instance(p_instance_id) then raise exception 'Workflow history is not available' using errcode='42501'; end if;
  select * into i from fms_instances where id=p_instance_id;
  -- Visits written in one transaction share a timestamp; their causal depth keeps the real order.
  with recursive causal(id,depth) as (
    select w.id,0 from fms_instance_stages w where w.fms_instance_id=i.id
      and not exists(select 1 from fms_instance_stages p where p.id=w.previous_instance_stage_id and p.fms_instance_id=i.id)
    union all
    select w.id,c.depth+1 from causal c join fms_instance_stages w on w.previous_instance_stage_id=c.id and w.fms_instance_id=i.id where c.depth<5000
  )
  select jsonb_build_object(
    'instance',jsonb_build_object('id',i.id,'reference',i.reference_number,'title',i.title,'status',i.status,'version',i.flow_version,
      'workflowName',(select name from fms_flows where id=i.fms_flow_id),'startedAt',i.started_at,'completedAt',i.completed_at,
      'startedBy',(select employee_name from user_profiles where id=i.started_by),'cancelledAt',i.cancelled_at,'cancelReason',i.cancel_reason,'holdReason',i.hold_reason,
      'name',coalesce(fms_work_record_name((select w.id from fms_instance_stages w where w.fms_instance_id=i.id order by w.created_at desc,cardinality(w.execution_path) desc,w.id desc limit 1)),i.title)),
    'outcome',(select jsonb_build_object('stageName',o.end_stage_name,'outcome',o.outcome,'reasonCode',o.reason_code,'closedAt',o.closed_at,'routeLabel',o.route_label,
        'sourceStageName',(select name from fms_stages where id=o.source_stage_id),
        'sourceQuestion',(select f.field_name from form_fields f join form_submissions fs on fs.form_template_id=f.form_template_id where fs.id=o.source_submission_id and f.field_key=o.source_question_key limit 1),
        'sourceValue',o.source_value#>>'{}','stoppedCount',o.stopped_visit_count,'closedBy',(select employee_name from user_profiles where id=o.finalized_by))
      from fms_instance_outcomes o where o.fms_instance_id=i.id),
    'visits',coalesce((select jsonb_agg(v.item order by v.created_at,v.depth,v.id) from (
      select w.id,w.created_at,coalesce((select min(c.depth) from causal c where c.id=w.id),0) depth,jsonb_build_object(
        'id',w.id,'stageKey',s.stage_key,'stageName',s.name,'stageType',s.step_type,'visitNumber',w.visit_number,'status',w.status,
        'outcome',case when w.outcome in ('workflow_closed','condition_skipped') then null else w.outcome end,'remark',w.remark,
        'stopped',w.outcome='workflow_closed','skipped',w.outcome='condition_skipped',
        'activatedAt',w.activated_at,'completedAt',w.actual_datetime,'dueAt',w.planned_datetime,
        'completedBy',(select employee_name from user_profiles where id=w.completed_by and tenant_id=i.tenant_id),
        'assignees',(select coalesce(jsonb_agg(u.employee_name order by u.employee_name),'[]') from user_profiles u where u.id=any(w.assigned_to) and u.tenant_id=i.tenant_id),
        'formName',(select name from form_templates where id=s.form_template_id),'submittedAt',(select submitted_at from form_submissions where id=w.form_submission_id),
        'routeLabel',(select coalesce(nullif(r.label,''),'Route '||(r.sort_order+1)) from fms_branch_rules r where r.id=w.branch_rule_id),
        'nextStages',(select coalesce(jsonb_agg(t.name order by t.sort_order),'[]') from fms_visit_transitions vt join fms_stages t on t.id=vt.target_stage_id where vt.source_instance_stage_id=w.id),
        'answers',(select coalesce(jsonb_agg(jsonb_build_object('label',f.field_name,'value',fs.data->>f.field_key) order by f.sort_order),'[]')
          from form_submissions fs join form_fields f on f.form_template_id=fs.form_template_id
          where fs.id=w.form_submission_id and fs.data ? f.field_key
            and exists(select 1 from fms_branch_rules r where r.fms_stage_id=s.id and r.source_type='form_answer' and r.source_key=f.field_key)),
        'events',(select coalesce(jsonb_agg(jsonb_build_object('action',l.action,'at',l.created_at,'by',(select employee_name from user_profiles where id=l.actor_id and tenant_id=i.tenant_id),
            'reason',coalesce(l.details->>'reason',l.details->>'remark')) order by l.created_at,l.id),'[]')
          from fms_stage_logs l where l.fms_instance_stage_id=w.id and l.action not in ('activated','assignment_resolved','actor_completed','automatic_completed','route_taken','branch_taken','workflow_ended','condition_skipped'))
      ) item from fms_instance_stages w join fms_stages s on s.id=w.fms_stage_id where w.fms_instance_id=i.id) v),'[]')
  ) into result;
  return result;
end $$;

revoke all on function fms_report_validate(jsonb,text[]),fms_report_instances(uuid,jsonb),fms_report_in_period(timestamptz,jsonb),
  get_fms_flow_report(uuid,jsonb),get_fms_library_outcomes(),get_fms_flow_records(uuid,jsonb,integer,integer),get_fms_instance_journey(uuid)
  from public,anon,authenticated,service_role;
grant execute on function get_fms_flow_report(uuid,jsonb),get_fms_library_outcomes(),get_fms_flow_records(uuid,jsonb,integer,integer),get_fms_instance_journey(uuid) to authenticated;
notify pgrst,'reload schema';
