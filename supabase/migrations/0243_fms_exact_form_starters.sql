set search_path=public,extensions;
-- Existing instances stay version 1. This only constrains newly opted-in starts.
create unique index fms_assignment_v2_start_submission_once on fms_instances(tenant_id,(context->>'form_submission_id'))
  where assignment_version=2 and context ? 'form_submission_id';

do $$
declare f text; n text;
begin
  f:=pg_get_functiondef('start_fms_from_form_submission_with_audit(uuid)'::regprocedure);
  n:=replace(f,'FUNCTION public.start_fms_from_form_submission_with_audit(p_submission_id uuid)',
    'FUNCTION public.start_fms_from_exact_form_submission(p_submission_id uuid, p_flow_id uuid)');
  if n=f then raise exception 'Starting form function signature changed'; end if; f:=n;
  n:=replace(f,'where f.tenant_id=v_actor.tenant_id','where f.id=p_flow_id and f.tenant_id=v_actor.tenant_id');
  if n=f then raise exception 'Exact starting flow selectors changed'; end if; f:=n;
  n:=replace(f,'if v_instance.id is not null then', 'if v_instance.id is not null then if v_instance.fms_flow_id<>p_flow_id then raise exception ''This form submission already belongs to another workflow'' using errcode=''23514''; end if;');
  execute n;
end $$;

create function get_fms_work_mutation_result(p_idempotency_key uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile();
begin
  perform assert_module_enabled('fms_builder');
  if a.id is null or not current_profile_is_active() then raise exception 'An active profile is required to recover workflow work' using errcode='42501'; end if;
  return (select response from fms_workflow_mutation_keys where tenant_id=a.tenant_id and actor_id=a.id and mutation_key=p_idempotency_key and completed_at is not null);
end $$;

create function list_fms_form_starters(p_form_template_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare a user_profiles:=current_profile(); result jsonb;
begin
  perform assert_module_enabled('fms_builder');
  if a.id is null or not current_profile_is_active() then raise exception 'An active profile is required to open workflow forms' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('flowId',f.id,'name',f.name,'version',f.version,'formTemplateId',first_stage.form_template_id) order by f.name,f.version),'[]') into result
  from fms_flows f join lateral (select form_template_id from fms_stages where fms_flow_id=f.id order by sort_order,id limit 1) first_stage on true
  where f.tenant_id=a.tenant_id and f.status='published' and f.is_active and first_stage.form_template_id=p_form_template_id
    and can_start_fms_flow(f.id,coalesce(f.branch_id,a.branch_id),coalesce(f.department_id,a.department_id));
  return result;
end $$;

create function submit_form_and_start_fms_idempotent(p_form_template_id uuid,p_answers jsonb,p_idempotency_key uuid,p_flow_id uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare a user_profiles:=current_profile(); cached fms_workflow_mutation_keys; hash text; raw jsonb;
  submission_id uuid; instance_id uuid; reference_number text; flow_name text; own_targets jsonb; summary jsonb;
begin
  perform assert_module_enabled('forms_library');
  if a.id is null or not current_profile_is_active() then raise exception 'An active profile is required to submit a form' using errcode='42501'; end if;
  if p_idempotency_key is null or p_form_template_id is null or jsonb_typeof(p_answers) is distinct from 'object' or pg_column_size(p_answers)>65536 then raise exception 'Invalid starting form request' using errcode='22023'; end if;
  hash:=md5(jsonb_build_object('form',p_form_template_id,'answers',p_answers,'flow',p_flow_id)::text);
  insert into fms_workflow_mutation_keys(tenant_id,actor_id,mutation_key,linked_module,linked_record_id,request_hash)
    values(a.tenant_id,a.id,p_idempotency_key,'fms_entry',p_form_template_id,hash) on conflict(tenant_id,actor_id,mutation_key) do nothing;
  select * into cached from fms_workflow_mutation_keys where tenant_id=a.tenant_id and actor_id=a.id and mutation_key=p_idempotency_key for update;
  if cached.linked_record_id<>p_form_template_id or cached.linked_module<>'fms_entry' or cached.request_hash is distinct from hash then raise exception 'Workflow submission key cannot be reused for a different request' using errcode='23514'; end if;
  if cached.completed_at is not null then return cached.response; end if;
  if p_flow_id is null then
    raw:=submit_form_and_start_fms_with_audit(p_form_template_id,p_answers);
    submission_id:=(raw->>'submission_id')::uuid; instance_id:=(raw->>'instance_id')::uuid; reference_number:=raw->>'reference_number';
  else
    if not exists(select 1 from jsonb_array_elements(list_fms_form_starters(p_form_template_id)) flow where flow->>'flowId'=p_flow_id::text) then raise exception 'This exact published workflow is not available for the form' using errcode='42501'; end if;
    submission_id:=submit_form_with_audit(p_form_template_id,p_answers,null,null);
    select started.instance_id,started.reference_number into instance_id,reference_number from start_fms_from_exact_form_submission(submission_id,p_flow_id) started;
    if instance_id is null then raise exception 'The selected workflow cannot start from this form version' using errcode='23514'; end if;
  end if;
  select f.name into flow_name from fms_instances i join fms_flows f on f.id=i.fms_flow_id where i.id=instance_id;
  select coalesce(jsonb_agg(jsonb_build_object('kind',case when s.form_template_id is null then 'stage' else 'stage_form' end,'instanceId',work.fms_instance_id,'instanceStageId',work.id,'formTemplateId',s.form_template_id)),'[]') into own_targets
    from fms_instance_stages work join fms_stages s on s.id=work.fms_stage_id where work.fms_instance_id=instance_id and a.id=any(work.assigned_to) and work.status in ('pending','in_progress','in_review','overdue');
  select coalesce(jsonb_agg(jsonb_build_object('stageName',s.name,'employeeName',coalesce((select string_agg(employee_name,', ' order by employee_name) from user_profiles where tenant_id=a.tenant_id and id=any(work.assigned_to)),'Automatic'))),'[]') into summary
    from fms_instance_stages work join fms_stages s on s.id=work.fms_stage_id where work.fms_instance_id=instance_id and work.status in ('pending','in_progress','in_review','overdue');
  raw:=jsonb_build_object('submission_id',submission_id,'instance_id',instance_id,'reference_number',reference_number,'flow_name',flow_name,'ownWorkTargets',own_targets,'assignmentSummary',summary);
  update fms_workflow_mutation_keys set response=raw,completed_at=now() where id=cached.id;
  return raw;
end $$;

-- Complete the already-defined flow_form branch of the common work protocol.
do $$
declare f text; n text; marker text;
begin
  f:=pg_get_functiondef('transition_fms_work_with_audit(jsonb,uuid,jsonb,text)'::regprocedure);
  marker:=E'  else\n    raise exception ''Use the exact workflow starter assignment for this form'' using errcode=''23514'';\n  end if;';
  n:=replace(f,marker,$branch$  else
    submission_id:=submit_form_with_audit((p_request->>'formTemplateId')::uuid,p_request->'answers',null,null);
    select instance.* into i from start_fms_from_exact_form_submission(submission_id,(p_request->>'flowId')::uuid) started join fms_instances instance on instance.id=started.instance_id;
    if i.id is null then raise exception 'The exact workflow could not start from this form' using errcode='23514'; end if;
    select * into work from fms_instance_stages where fms_instance_id=i.id and form_submission_id=submission_id;
  end if;$branch$);
  if n=f then raise exception 'Common exact starter dispatch changed'; end if;
  execute n;
end $$;
revoke all on function start_fms_from_exact_form_submission(uuid,uuid),get_fms_work_mutation_result(uuid),list_fms_form_starters(uuid),submit_form_and_start_fms_idempotent(uuid,jsonb,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function get_fms_work_mutation_result(uuid),list_fms_form_starters(uuid),submit_form_and_start_fms_idempotent(uuid,jsonb,uuid,uuid) to authenticated;
notify pgrst,'reload schema';
