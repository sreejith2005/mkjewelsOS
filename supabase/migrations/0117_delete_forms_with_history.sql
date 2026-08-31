-- Deleting a form no longer depends on whether anyone has used it.
--
-- Until now a form could only be removed while nothing referenced it, so any
-- form that had ever been filled in was permanent. Authors asked for the
-- opposite: the library is theirs to curate, and a form they no longer want
-- should go. Deletion now detaches every reference instead of refusing.
--
-- Nothing that records real work is destroyed. Submissions survive the form
-- they were filled on: each one keeps a snapshot of the exact template and
-- fields it was answered against, so the answers stay readable forever. Tasks
-- keep their history and simply stop demanding a form.
--
-- A workflow is the one reference that cannot silently carry on. A published
-- flow whose stage collected this form is taken off the air and handed back as
-- a draft, so nobody is asked to run a step whose form no longer exists. The
-- author picks a replacement form and publishes it again. `form_deletion_impact`
-- reports all of this up front, so the warning shown before deleting and the
-- follow-up shown afterwards describe the same thing.

-- A submission outlives its template, so it can no longer insist on one.
alter table form_submissions
  alter column form_template_id drop not null,
  add column if not exists template_snapshot jsonb;

comment on column form_submissions.template_snapshot is
  'The form_templates row and form_fields rows this submission was answered against, captured when the form was deleted. Null while the form still exists.';

do $$ begin
  alter table form_submissions
    add constraint form_submissions_snapshot_object
      check (template_snapshot is null or jsonb_typeof(template_snapshot) = 'object');
exception when duplicate_object then null; end $$;

-- Detaching a stage from a deleted form is the one definition edit a published
-- flow accepts: the form is gone either way, and refusing the edit would only
-- leave the stage pointing at a row that no longer exists. Nothing but that
-- single column may change, and only while a form deletion is running.
create or replace function enforce_fms_definition_immutability()
returns trigger language plpgsql set search_path=public as $$
begin
  if tg_table_name='fms_flows' then
    if tg_op='DELETE' and (old.status<>'draft' or exists(select 1 from fms_instances where fms_flow_id=old.id)) then raise exception 'Published or used flows cannot be deleted' using errcode='23514'; end if;
    if tg_op='UPDATE' and old.status in ('published','archived') and row(new.name,new.description,new.branch_id,new.department_id,new.family_id,new.version,new.trigger_type,new.scope_type) is distinct from row(old.name,old.description,old.branch_id,old.department_id,old.family_id,old.version,old.trigger_type,old.scope_type) then raise exception 'Published flow definitions are immutable' using errcode='23514'; end if;
  else
    if tg_op='UPDATE'
       and current_setting('jewelos.allow_form_deletion', true) = 'on'
       and old.form_template_id is not null
       and new.form_template_id is null
       and to_jsonb(new) - 'form_template_id' = to_jsonb(old) - 'form_template_id' then
      return new;
    end if;
    if exists(select 1 from fms_flows where id=coalesce(new.fms_flow_id,old.fms_flow_id) and status in ('published','archived')) then raise exception 'Published stage definitions are immutable' using errcode='23514'; end if;
  end if;
  return coalesce(new,old);
end $$;

-- What deleting this form would take with it. The warning shown before the
-- author confirms and the summary shown afterwards both read this, so they can
-- never disagree about what happened.
create or replace function form_deletion_impact(p_template_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_template form_templates;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active()
     or not can_manage_form_template(p_template_id) then
    raise exception 'Only authorized active form authors can delete this form' using errcode = '42501';
  end if;
  select * into v_template from form_templates where id = p_template_id;
  if v_template.id is null or v_template.tenant_id <> v_actor.tenant_id then
    raise exception 'Form to delete was not found' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'form', jsonb_build_object('id', v_template.id, 'name', v_template.name,
                               'version', v_template.version, 'lifecycle', v_template.lifecycle),
    'submissions', (select count(*) from form_submissions where form_template_id = v_template.id),
    'taskTemplates', (select count(*) from task_templates where form_template_id = v_template.id),
    'tasks', (select count(*) from task_instances where form_template_id = v_template.id),
    'starterAssignments', (select count(*) from fms_starter_assignments where form_template_id = v_template.id),
    'flows', coalesce((
      select jsonb_agg(entry order by entry->>'name')
      from (
        select jsonb_build_object(
          'id', f.id, 'name', f.name, 'version', f.version, 'status', f.status,
          'stages', (select jsonb_agg(s2.name order by s2.sort_order)
                     from fms_stages s2 where s2.fms_flow_id = f.id and s2.form_template_id = v_template.id),
          'activeInstances', (select count(*) from fms_instances i
                              where i.fms_flow_id = f.id and i.status in ('active','overdue','on_hold')),
          -- Only one draft may exist per workflow family, so a published flow
          -- whose family is already being edited is archived instead.
          'action', case
            when f.status <> 'published' then 'unchanged'
            when exists (select 1 from fms_flows d
                         where d.tenant_id = f.tenant_id and d.family_id = f.family_id
                           and d.status = 'draft' and d.id <> f.id) then 'archived'
            else 'reverted_to_draft' end
        ) as entry
        from fms_flows f
        where exists (select 1 from fms_stages s where s.fms_flow_id = f.id and s.form_template_id = v_template.id)
      ) flows
    ), '[]'::jsonb)
  );
end;
$$;

drop function if exists delete_form_with_audit(uuid);
create function delete_form_with_audit(p_template_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor user_profiles;
  v_template form_templates;
  v_impact jsonb;
  v_snapshot jsonb;
  v_flow jsonb;
  v_field_count integer;
begin
  select * into v_actor from current_profile();
  if v_actor.id is null or not current_profile_is_active()
     or not can_manage_form_template(p_template_id) then
    raise exception 'Only authorized active form authors can delete this form' using errcode = '42501';
  end if;

  select * into v_template from form_templates where id = p_template_id for update;
  if v_template.id is null or v_template.tenant_id <> v_actor.tenant_id then
    raise exception 'Form to delete was not found' using errcode = '42501';
  end if;

  v_impact := form_deletion_impact(v_template.id);

  -- Everything the client needs to read an old submission once the live rows
  -- are gone: the same template and field rows `toDefinition` already reads.
  select count(*) into v_field_count from form_fields where form_template_id = v_template.id;
  v_snapshot := jsonb_build_object(
    'template', to_jsonb(v_template),
    'fields', coalesce((select jsonb_agg(to_jsonb(ff) order by ff.sort_order, ff.id)
                        from form_fields ff where ff.form_template_id = v_template.id), '[]'::jsonb)
  );

  perform set_config('jewelos.allow_form_deletion', 'on', true);

  update form_submissions
     set template_snapshot = coalesce(template_snapshot, v_snapshot), form_template_id = null
   where form_template_id = v_template.id;

  -- A task that required this form must stop requiring it, or it could never
  -- be completed again.
  update task_templates set form_template_id = null, requires_form = false
   where form_template_id = v_template.id;
  update task_instances set form_template_id = null, requires_form = false
   where form_template_id = v_template.id;

  -- Nobody should be handed the opening form of a workflow that is about to
  -- come off the air.
  delete from fms_starter_assignments where form_template_id = v_template.id;

  -- Take every affected workflow off the air before its stage loses the form,
  -- so no live run can reach a step whose form no longer exists.
  for v_flow in select * from jsonb_array_elements(v_impact->'flows') loop
    if v_flow->>'action' = 'reverted_to_draft' then
      update fms_flows set status = 'draft', published_by = null, updated_at = now()
       where id = (v_flow->>'id')::uuid;
    elsif v_flow->>'action' = 'archived' then
      update fms_flows set status = 'archived', updated_at = now()
       where id = (v_flow->>'id')::uuid;
    end if;
  end loop;

  update fms_stages set form_template_id = null where form_template_id = v_template.id;

  -- form_fields and form_links cascade with the template.
  delete from form_templates where id = v_template.id;

  insert into audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
  values (
    v_actor.tenant_id, v_actor.id, 'form_deleted', 'forms', v_template.id,
    jsonb_build_object('template', to_jsonb(v_template), 'field_count', v_field_count),
    jsonb_build_object('deleted', true, 'impact', v_impact)
  );
  return v_impact;
end;
$$;

revoke all privileges on function form_deletion_impact(uuid) from public, anon, authenticated, service_role;
revoke all privileges on function delete_form_with_audit(uuid) from public, anon, authenticated, service_role;
grant execute on function form_deletion_impact(uuid) to authenticated;
grant execute on function delete_form_with_audit(uuid) to authenticated;

notify pgrst, 'reload schema';
