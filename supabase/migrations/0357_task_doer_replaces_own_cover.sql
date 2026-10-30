-- A person chosen as a doer can already be on the task as leave cover for
-- another chosen doer: inserting doer A (on leave) makes the coverage trigger
-- add A's buddy B, and the creator's next insert of B as an original doer then
-- hit idx_task_assignees_one_active_doer ("duplicate key value violates unique
-- constraint"). Task creation, editing and every other doer path insert this way.
--
-- Fix it once at the table: when someone becomes an active original doer, end
-- their active cover row on that task first. They stay on the task exactly once,
-- as an original doer, so they keep the task when the absent colleague returns
-- (restore paths end only cover rows). Task coverage fields and
-- buddy_assignments still record that they cover the absent colleague.
set search_path = public, extensions;

create function public.task_assignee_original_replaces_cover()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_cover_completed_at timestamptz;
begin
  if new.role_at_task = 'doer' and new.is_active and new.is_original then
    update task_assignees
       set is_active = false
     where task_instance_id = new.task_instance_id
       and user_profile_id = new.user_profile_id
       and role_at_task = 'doer'
       and is_active
       and not is_original
    returning completed_at into v_cover_completed_at;
    -- Work the person already finished as cover stays finished.
    new.completed_at := coalesce(new.completed_at, v_cover_completed_at);
  end if;
  return new;
end;
$$;

revoke all on function public.task_assignee_original_replaces_cover() from public, anon, authenticated, service_role;

create trigger task_assignees_original_replaces_cover
before insert on public.task_assignees
for each row execute function public.task_assignee_original_replaces_cover();

notify pgrst, 'reload schema';
