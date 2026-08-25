-- Tenant-scoped, payload-free wake-up events for Supabase Realtime clients.
-- Clients refetch through their existing RLS/RPC contracts; these rows are
-- deliberately not a second data API and contain no business-record payload.

set search_path = public, extensions;

create table tenant_realtime_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  topic text not null check (topic in ('tasks', 'fms', 'crm', 'forms', 'organization', 'settings')),
  occurred_at timestamptz not null default now()
);

create index idx_tenant_realtime_events_tenant_id_id
  on tenant_realtime_events(tenant_id, id desc);

alter table tenant_realtime_events enable row level security;
revoke all on tenant_realtime_events from public, anon, authenticated, service_role;
grant select on tenant_realtime_events to authenticated;

create policy tenant_realtime_events_receive_own_tenant
  on tenant_realtime_events for select to authenticated
  using (tenant_id = current_tenant_id() and current_profile_is_active());

create function emit_tenant_realtime_event(p_tenant_id uuid, p_topic text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tenant_id is null then return; end if;
  if p_topic not in ('tasks', 'fms', 'crm', 'forms', 'organization', 'settings') then
    raise exception 'Realtime event topic is invalid' using errcode = '22023';
  end if;
  insert into tenant_realtime_events(tenant_id, topic) values (p_tenant_id, p_topic);
end;
$$;

create function emit_realtime_direct_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_row jsonb; v_tenant_id uuid;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_tenant_id := coalesce((v_row ->> 'tenant_id')::uuid, case when tg_table_name = 'tenants' then (v_row ->> 'id')::uuid end);
  perform emit_tenant_realtime_event(v_tenant_id, tg_argv[0]);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function emit_realtime_task_child_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_row jsonb; v_tenant_id uuid;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  select tenant_id into v_tenant_id from task_instances where id = (v_row ->> 'task_instance_id')::uuid;
  perform emit_tenant_realtime_event(v_tenant_id, 'tasks');
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function emit_realtime_fms_runtime_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_row jsonb; v_tenant_id uuid; v_stage_id uuid;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name = 'fms_instance_stages' then
    select tenant_id into v_tenant_id from fms_instances where id = (v_row ->> 'fms_instance_id')::uuid;
  else
    v_stage_id := (v_row ->> 'fms_instance_stage_id')::uuid;
    select i.tenant_id into v_tenant_id
      from fms_instance_stages s join fms_instances i on i.id = s.fms_instance_id
      where s.id = v_stage_id;
  end if;
  perform emit_tenant_realtime_event(v_tenant_id, 'fms');
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function emit_realtime_fms_definition_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_row jsonb; v_tenant_id uuid; v_stage_id uuid;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  if tg_table_name = 'fms_flows' then
    v_tenant_id := (v_row ->> 'tenant_id')::uuid;
  elsif tg_table_name = 'fms_stages' then
    select tenant_id into v_tenant_id from fms_flows where id = (v_row ->> 'fms_flow_id')::uuid;
  else
    v_stage_id := (v_row ->> 'fms_stage_id')::uuid;
    select f.tenant_id into v_tenant_id from fms_stages s join fms_flows f on f.id = s.fms_flow_id where s.id = v_stage_id;
  end if;
  perform emit_tenant_realtime_event(v_tenant_id, 'fms');
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function emit_realtime_form_definition_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_row jsonb; v_tenant_id uuid;
begin
  v_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  select tenant_id into v_tenant_id from form_templates where id = (v_row ->> 'form_template_id')::uuid;
  perform emit_tenant_realtime_event(v_tenant_id, 'forms');
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger tenant_realtime_tasks_direct after insert or update or delete on task_instances
  for each row execute function emit_realtime_direct_event('tasks');
create trigger tenant_realtime_tasks_assignees after insert or update or delete on task_assignees
  for each row execute function emit_realtime_task_child_event();
create trigger tenant_realtime_tasks_watchers after insert or update or delete on task_watchers
  for each row execute function emit_realtime_task_child_event();
create trigger tenant_realtime_tasks_checklists after insert or update or delete on task_checklists
  for each row execute function emit_realtime_task_child_event();
create trigger tenant_realtime_tasks_attachments after insert or update or delete on task_attachments
  for each row execute function emit_realtime_task_child_event();
create trigger tenant_realtime_tasks_comments after insert or update or delete on task_comments
  for each row execute function emit_realtime_task_child_event();
create trigger tenant_realtime_tasks_revisions after insert or update or delete on task_revisions
  for each row execute function emit_realtime_task_child_event();

create trigger tenant_realtime_fms_instances after insert or update or delete on fms_instances
  for each row execute function emit_realtime_direct_event('fms');
create trigger tenant_realtime_fms_stages_runtime after insert or update or delete on fms_instance_stages
  for each row execute function emit_realtime_fms_runtime_event();
create trigger tenant_realtime_fms_checklists after insert or update or delete on fms_instance_checklist_items
  for each row execute function emit_realtime_fms_runtime_event();
create trigger tenant_realtime_fms_evidence after insert or update or delete on fms_evidence
  for each row execute function emit_realtime_fms_runtime_event();
create trigger tenant_realtime_fms_logs after insert or update or delete on fms_stage_logs
  for each row execute function emit_realtime_fms_runtime_event();
create trigger tenant_realtime_fms_flows after insert or update or delete on fms_flows
  for each row execute function emit_realtime_fms_definition_event();
create trigger tenant_realtime_fms_definitions after insert or update or delete on fms_stages
  for each row execute function emit_realtime_fms_definition_event();
create trigger tenant_realtime_fms_assignees after insert or update or delete on fms_stage_assignees
  for each row execute function emit_realtime_fms_definition_event();
create trigger tenant_realtime_fms_branch_rules after insert or update or delete on fms_branch_rules
  for each row execute function emit_realtime_fms_definition_event();

create trigger tenant_realtime_crm_clients after insert or update or delete on clients
  for each row execute function emit_realtime_direct_event('crm');
create trigger tenant_realtime_crm_walkins after insert or update or delete on walkin_entries
  for each row execute function emit_realtime_direct_event('crm');
create trigger tenant_realtime_crm_timeline after insert or update or delete on client_timeline
  for each row execute function emit_realtime_direct_event('crm');
create trigger tenant_realtime_crm_followups after insert or update or delete on client_followups
  for each row execute function emit_realtime_direct_event('crm');
create trigger tenant_realtime_crm_assignments after insert or update or delete on client_assignments
  for each row execute function emit_realtime_direct_event('crm');
create trigger tenant_realtime_crm_aliases after insert or update or delete on client_contact_aliases
  for each row execute function emit_realtime_direct_event('crm');
create trigger tenant_realtime_crm_documents after insert or update or delete on crm_documents
  for each row execute function emit_realtime_direct_event('crm');

create trigger tenant_realtime_forms_templates after insert or update or delete on form_templates
  for each row execute function emit_realtime_direct_event('forms');
create trigger tenant_realtime_forms_submissions after insert or update or delete on form_submissions
  for each row execute function emit_realtime_direct_event('forms');
create trigger tenant_realtime_forms_fields after insert or update or delete on form_fields
  for each row execute function emit_realtime_form_definition_event();
create trigger tenant_realtime_forms_links after insert or update or delete on form_links
  for each row execute function emit_realtime_form_definition_event();

create trigger tenant_realtime_organization_availability after insert or update or delete on user_availability
  for each row execute function emit_realtime_direct_event('organization');
create trigger tenant_realtime_organization_profiles after insert or update or delete on user_profiles
  for each row execute function emit_realtime_direct_event('organization');
create trigger tenant_realtime_organization_branches after insert or update or delete on branches
  for each row execute function emit_realtime_direct_event('organization');
create trigger tenant_realtime_organization_departments after insert or update or delete on departments
  for each row execute function emit_realtime_direct_event('organization');
create trigger tenant_realtime_organization_dropdowns after insert or update or delete on dropdown_masters
  for each row execute function emit_realtime_direct_event('organization');

create trigger tenant_realtime_settings_tenants after insert or update or delete on tenants
  for each row execute function emit_realtime_direct_event('settings');
create trigger tenant_realtime_settings_preferences after insert or update or delete on user_preferences
  for each row execute function emit_realtime_direct_event('settings');
create trigger tenant_realtime_settings_sections after insert or update or delete on tenant_section_controls
  for each row execute function emit_realtime_direct_event('settings');

do $$
declare f record;
begin
  for f in select p.oid::regprocedure identity from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'emit_tenant_realtime_event', 'emit_realtime_direct_event', 'emit_realtime_task_child_event',
      'emit_realtime_fms_runtime_event', 'emit_realtime_fms_definition_event', 'emit_realtime_form_definition_event'
    )
  loop
    execute format('alter function %s owner to postgres', f.identity);
    execute format('revoke all on function %s from public, anon, authenticated, service_role', f.identity);
  end loop;
end $$;

alter publication supabase_realtime add table tenant_realtime_events;
notify pgrst, 'reload schema';
