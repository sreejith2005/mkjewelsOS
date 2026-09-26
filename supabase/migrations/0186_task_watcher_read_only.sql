-- A named watcher who is not an active doer supervises the task through reads
-- and the audited comment RPC. Elevated section authority does not turn that
-- watcher assignment into permission to perform the work.
set search_path = public, extensions;

create or replace function public.reject_watcher_task_mutation()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_task_id uuid;
  v_actor_id uuid;
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'task_instances' then
    v_task_id := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_task_id := case when tg_op = 'DELETE' then old.task_instance_id else new.task_instance_id end;
  end if;
  select id into v_actor_id from public.current_profile();
  if v_actor_id is not null
     and exists (
       select 1 from public.task_watchers w
       where w.task_instance_id = v_task_id and w.user_profile_id = v_actor_id
     )
     and not exists (
       select 1 from public.task_assignees a
       where a.task_instance_id = v_task_id and a.user_profile_id = v_actor_id
         and a.role_at_task = 'doer' and a.is_active
     ) then
    raise exception 'In Loop participants may only view and comment on this task' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function public.reject_watcher_task_mutation() from public, anon, authenticated, service_role;

create trigger task_instances_watcher_read_only before update or delete on public.task_instances
  for each row execute function public.reject_watcher_task_mutation();
create trigger task_assignees_watcher_read_only before insert or update or delete on public.task_assignees
  for each row execute function public.reject_watcher_task_mutation();
create trigger task_checklists_watcher_read_only before insert or update or delete on public.task_checklists
  for each row execute function public.reject_watcher_task_mutation();
create trigger task_attachments_watcher_read_only before insert or update or delete on public.task_attachments
  for each row execute function public.reject_watcher_task_mutation();
create trigger task_revisions_watcher_read_only before insert or update or delete on public.task_revisions
  for each row execute function public.reject_watcher_task_mutation();
create trigger task_watchers_watcher_read_only before insert or update or delete on public.task_watchers
  for each row execute function public.reject_watcher_task_mutation();

-- Reject Storage writes before an object can become unregistered evidence.
create or replace function public.can_write_task_attachment_object(p_name text)
returns boolean language plpgsql stable security definer set search_path = public, storage as $$
declare
  v_task_id uuid;
  v_task_tenant uuid;
begin
  if not current_profile_is_active()
     or (storage.foldername(p_name))[1] <> current_tenant_id()::text then
    return false;
  end if;
  v_task_id := (storage.foldername(p_name))[2]::uuid;
  select tenant_id into v_task_tenant from task_instances where id = v_task_id;
  if v_task_tenant is distinct from current_tenant_id() then return false; end if;
  if is_task_watcher(v_task_id) and not is_task_participant(v_task_id) then return false; end if;
  return current_role_level() in ('super_admin', 'admin', 'manager')
    or is_task_participant(v_task_id);
exception when invalid_text_representation or array_subscript_error then
  return false;
end;
$$;

notify pgrst, 'reload schema';
