set search_path=public,extensions;

-- An employee opens one assignment; a long-running flow never downloads every
-- loop visit or every submission merely to render that assignment.
create function get_fms_assigned_stage(p_instance_id uuid,p_instance_stage_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare actor user_profiles:=current_profile(); work fms_instance_stages; i fms_instances;
  visits jsonb; definitions jsonb; people jsonb; checklist jsonb; evidence jsonb;
begin
  perform assert_module_enabled('fms_builder');
  if not current_profile_is_active() then raise exception 'FMS work is not available to your account' using errcode='42501'; end if;
  select * into i from fms_instances where id=p_instance_id and tenant_id=actor.tenant_id;
  if p_instance_stage_id is not null then
    select * into work from fms_instance_stages where id=p_instance_stage_id and fms_instance_id=i.id;
  else
    select * into work from fms_instance_stages where fms_instance_id=i.id and actor.id=any(assigned_to)
      and status in ('pending','in_progress','in_review','overdue') order by created_at desc,id desc limit 1;
  end if;
  if work.id is null or not can_read_fms_work_context(work.id) then raise exception 'FMS work is not available to your account' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.created_at,item.id),'[]') into visits from (
    select latest.* from (
      select distinct on(fms_stage_id) * from fms_instance_stages where fms_instance_id=i.id order by fms_stage_id,visit_number desc,created_at desc,id desc
    ) latest
    union all select * from fms_instance_stages where id=work.id and not exists(
      select 1 from fms_instance_stages newer where newer.fms_instance_id=i.id and newer.fms_stage_id=work.fms_stage_id and newer.visit_number>work.visit_number
    ) is false
    limit 201
  ) item;
  select coalesce(jsonb_agg(to_jsonb(item) order by item.sort_order,item.id),'[]') into definitions from (
    select * from fms_stages where fms_flow_id=i.fms_flow_id order by sort_order,id limit 200
  ) item;
  select coalesce(jsonb_agg(to_jsonb(item)),'[]') into checklist from (
    select * from fms_instance_checklist_items where fms_instance_stage_id=work.id order by sort_order,id
  ) item;
  select coalesce(jsonb_agg(to_jsonb(item)),'[]') into evidence from (
    select * from fms_evidence where fms_instance_stage_id=work.id and removed_at is null order by created_at,id limit 100
  ) item;
  select coalesce(jsonb_agg(to_jsonb(item)),'[]') into people from (
    select id,employee_name,user_role,branch_id,department_id,working_status,is_login_enabled,account_status
    from user_profiles where tenant_id=actor.tenant_id and (
      id=any(work.assigned_to) or id=actor.id or has_permission('fms.manage')
      or has_permission('tasks.view_all') or has_permission('tasks.manage_team') and branch_id=i.branch_id
    ) order by employee_name,id limit 500
  ) item;
  return jsonb_build_object('instance',to_jsonb(i)||jsonb_build_object('context','{}'::jsonb),
    'instanceStages',visits,'definitions',definitions,'checklist',checklist,'evidence',evidence,'users',people);
end $$;
revoke all on function get_fms_assigned_stage(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function get_fms_assigned_stage(uuid,uuid) to authenticated;
notify pgrst,'reload schema';
