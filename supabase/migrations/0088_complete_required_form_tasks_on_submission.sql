-- A required task form is the sole completion action for its task. Keep the
-- form submission, task transition, assignee completion, and audit log in one transaction.
-- Lock task-linked submissions before validation so concurrent assignees do not
-- deadlock while the completion trigger upgrades a shared task lock.
alter function public.submit_form_with_audit(uuid, jsonb, text, uuid)
rename to submit_form_locked_with_audit;

create function public.submit_form_with_audit(
  p_form_template_id uuid,
  p_answers jsonb,
  p_linked_module text default null,
  p_linked_record_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_actor public.user_profiles;
begin
  if p_linked_module in ('checklist_task', 'delegation_task') then
    select * into v_actor from public.current_profile();
    if v_actor.id is not null and public.current_profile_is_active() then
      perform 1 from public.task_instances
      where id = p_linked_record_id and tenant_id = v_actor.tenant_id
      for update;
    end if;
  end if;
  return public.submit_form_locked_with_audit(p_form_template_id, p_answers, p_linked_module, p_linked_record_id);
end;
$$;

alter function public.submit_form_with_audit(uuid, jsonb, text, uuid) owner to postgres;
revoke all on function public.submit_form_locked_with_audit(uuid, jsonb, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.submit_form_with_audit(uuid, jsonb, text, uuid) from public, anon, service_role;
grant execute on function public.submit_form_with_audit(uuid, jsonb, text, uuid) to authenticated;

create or replace function public.complete_task_from_required_form_submission()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old public.task_instances; v_new public.task_instances;
begin
  if new.linked_module not in ('checklist_task', 'delegation_task') then return new; end if;
  select * into v_old from public.task_instances where id = new.linked_record_id for update;
  if v_old.id is null or v_old.status = 'completed' or v_old.coverage_status = 'coverage_required' or not v_old.requires_form or v_old.form_template_id is distinct from new.form_template_id then return new; end if;
  update public.task_instances set status = 'completed', actual_datetime = now(), updated_by = new.submitted_by, updated_at = now()
  where id = v_old.id returning * into v_new;
  update public.task_assignees set completed_at = now() where task_instance_id = v_old.id and is_active;
  insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (v_old.tenant_id, new.submitted_by, 'task_form_submitted_and_completed', 'tasks', v_old.id, to_jsonb(v_old),
    jsonb_build_object('task', to_jsonb(v_new), 'form_submission_id', new.id, 'form_template_id', new.form_template_id));
  return new;
end;
$$;

alter function public.complete_task_from_required_form_submission() owner to postgres;
revoke all on function public.complete_task_from_required_form_submission() from public, anon, authenticated, service_role;
drop trigger if exists complete_required_task_from_form_submission on public.form_submissions;
create trigger complete_required_task_from_form_submission after insert on public.form_submissions for each row execute function public.complete_task_from_required_form_submission();
notify pgrst, 'reload schema';
