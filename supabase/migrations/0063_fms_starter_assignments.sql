-- Publishing a workflow assigns its opening form immediately.  This is a
-- real, durable work item; completing it is what creates the runtime flow.

create table fms_starter_assignments (
  id uuid primary key default extensions.uuid_generate_v4(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  fms_flow_id uuid not null references fms_flows(id) on delete cascade,
  fms_stage_id uuid not null references fms_stages(id) on delete cascade,
  form_template_id uuid not null references form_templates(id),
  user_profile_id uuid not null references user_profiles(id),
  assigned_by uuid references user_profiles(id),
  status text not null default 'pending' check(status in ('pending','completed','cancelled')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references user_profiles(id),
  unique(fms_flow_id,user_profile_id)
);
create index idx_fms_starter_assignee on fms_starter_assignments(tenant_id,user_profile_id,status,created_at desc);
alter table fms_starter_assignments enable row level security;
create policy fms_starter_assignments_select on fms_starter_assignments for select to authenticated using(
  tenant_id=current_tenant_id() and current_profile_is_active() and (
    user_profile_id=(select id from current_profile()) or current_role_level() in ('super_admin','admin')
  )
);
revoke all on table fms_starter_assignments from public,anon,authenticated,service_role;
grant select on table fms_starter_assignments to authenticated;

create or replace function queue_fms_starter_assignments(p_flow_id uuid,p_assigned_by uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_flow fms_flows; v_stage fms_stages; v_assignment fms_starter_assignments;
begin
  select * into v_flow from fms_flows where id=p_flow_id for share;
  select * into v_stage from fms_stages where fms_flow_id=p_flow_id order by sort_order,id limit 1;
  if v_flow.id is null or v_stage.id is null or v_stage.step_type<>'form' or v_stage.form_template_id is null then
    raise exception 'Published workflow needs an initial linked Form' using errcode='23514';
  end if;
  for v_assignment in
    insert into fms_starter_assignments(tenant_id,fms_flow_id,fms_stage_id,form_template_id,user_profile_id,assigned_by)
    select v_flow.tenant_id,v_flow.id,v_stage.id,v_stage.form_template_id,a.user_profile_id,p_assigned_by
    from fms_stage_assignees a join user_profiles u on u.id=a.user_profile_id
    where a.fms_stage_id=v_stage.id and a.assignee_type='specific_user'
      and u.tenant_id=v_flow.tenant_id and u.working_status not in ('inactive','resigned') and u.is_login_enabled
    on conflict(fms_flow_id,user_profile_id) do nothing
    returning *
  loop
    insert into notifications(tenant_id,user_profile_id,event_type,title,message,link_url,channel,delivered_status)
    values(v_assignment.tenant_id,v_assignment.user_profile_id,'fms_starter_assigned',
      'New workflow form assigned',
      'Complete the starting form for '||v_flow.name||' to begin the process.',
      '/forms','in_app','delivered');
  end loop;
end;
$$;

create or replace function publish_fms_flow_with_audit(p_flow_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_actor user_profiles; v_flow fms_flows;
begin
  select * into v_actor from current_profile();
  if not can_manage_fms_flow(p_flow_id) then raise exception 'FMS builder access denied' using errcode='42501'; end if;
  perform assert_fms_flow_publishable(p_flow_id);
  select * into v_flow from fms_flows where id=p_flow_id for update;
  update fms_starter_assignments starter set status='cancelled'
  from fms_flows previous
  where starter.fms_flow_id=previous.id and previous.tenant_id=v_flow.tenant_id and previous.family_id=v_flow.family_id and previous.status='published' and starter.status='pending';
  update fms_flows set status='archived',is_active=false,archived_at=now(),archived_by=v_actor.id,updated_at=now() where tenant_id=v_flow.tenant_id and family_id=v_flow.family_id and status='published';
  update fms_flows set status='published',is_active=true,published_by=v_actor.id,updated_by=v_actor.id,updated_at=now() where id=p_flow_id;
  perform queue_fms_starter_assignments(p_flow_id,v_actor.id);
  insert into audit_logs(tenant_id,actor_user_id,action,module,record_id,new_value)
  values(v_actor.tenant_id,v_actor.id,'fms_flow_published','fms_flows',p_flow_id,jsonb_build_object('version',v_flow.version,'starter_assignments_queued',true));
end;
$$;

create or replace function get_my_fms_starter_assignments()
returns table(id uuid,fms_flow_id uuid,form_template_id uuid,flow_name text,stage_name text,assigned_at timestamptz)
language sql stable security definer set search_path=public as $$
  select starter.id,starter.fms_flow_id,starter.form_template_id,flow.name,stage.name,starter.created_at
  from fms_starter_assignments starter
  join fms_flows flow on flow.id=starter.fms_flow_id
  join fms_stages stage on stage.id=starter.fms_stage_id
  join user_profiles actor on actor.auth_user_id=auth.uid()
  where starter.tenant_id=actor.tenant_id and starter.user_profile_id=actor.id and starter.status='pending'
    and actor.working_status not in ('inactive','resigned') and actor.is_login_enabled
    and flow.status='published' and flow.is_active
  order by starter.created_at desc,starter.id;
$$;

-- Existing published flows receive the same durable opening-form work items.
do $$ declare flow_row record; begin
  for flow_row in select id,published_by,created_by from fms_flows where status='published' and is_active loop
    perform queue_fms_starter_assignments(flow_row.id,coalesce(flow_row.published_by,flow_row.created_by));
  end loop;
end $$;

alter function queue_fms_starter_assignments(uuid,uuid) owner to postgres;
alter function publish_fms_flow_with_audit(uuid) owner to postgres;
alter function get_my_fms_starter_assignments() owner to postgres;
revoke all on function queue_fms_starter_assignments(uuid,uuid),get_my_fms_starter_assignments() from public,anon,authenticated,service_role;
grant execute on function publish_fms_flow_with_audit(uuid),get_my_fms_starter_assignments() to authenticated;
notify pgrst,'reload schema';
