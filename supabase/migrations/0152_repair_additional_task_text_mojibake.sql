-- Extend the precise repair in 0151 for the two additional malformed
-- punctuation signatures found by its post-deploy scan. Do not decode entire
-- strings: valid Unicode text must remain untouched.
create or replace function public.repair_known_task_mojibake(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select replace(
    replace(
      replace(
        replace(
          p_value,
          convert_from(decode('c3a2c280c293', 'hex'), 'UTF8'),
          U&'\2013'
        ),
        convert_from(decode('c3a2c280c294', 'hex'), 'UTF8'),
        U&'\2014'
      ),
      convert_from(decode('c3a2c280c299', 'hex'), 'UTF8'),
      U&'\2019'
    ),
    convert_from(decode('c3a2c280c29c', 'hex'), 'UTF8'),
    U&'\201C'
  )
$$;

with candidates as (
  select
    task.id,
    task.tenant_id,
    coalesce(task.updated_by, task.created_by) as actor_user_id,
    jsonb_build_object('title', task.title, 'description', task.description, 'core_task_label', task.core_task_label) as old_value,
    jsonb_build_object(
      'title', public.repair_known_task_mojibake(task.title),
      'description', public.repair_known_task_mojibake(task.description),
      'core_task_label', public.repair_known_task_mojibake(task.core_task_label)
    ) as new_value,
    public.repair_known_task_mojibake(task.title) as title,
    public.repair_known_task_mojibake(task.description) as description,
    public.repair_known_task_mojibake(task.core_task_label) as core_task_label
  from public.task_instances task
  where (task.title, task.description, task.core_task_label) is distinct from (
    public.repair_known_task_mojibake(task.title),
    public.repair_known_task_mojibake(task.description),
    public.repair_known_task_mojibake(task.core_task_label)
  )
), updated as (
  update public.task_instances task
  set title = candidate.title,
      description = candidate.description,
      core_task_label = candidate.core_task_label,
      updated_at = now()
  from candidates candidate
  where task.id = candidate.id
  returning task.id
)
insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
select candidate.tenant_id, candidate.actor_user_id, 'task_text_mojibake_repaired', 'tasks', candidate.id, candidate.old_value, candidate.new_value
from candidates candidate
join updated on updated.id = candidate.id;

with candidates as (
  select
    template.id,
    template.tenant_id,
    coalesce(template.updated_by, template.created_by) as actor_user_id,
    jsonb_build_object('title', template.title, 'description', template.description, 'core_task_label', template.core_task_label) as old_value,
    jsonb_build_object(
      'title', public.repair_known_task_mojibake(template.title),
      'description', public.repair_known_task_mojibake(template.description),
      'core_task_label', public.repair_known_task_mojibake(template.core_task_label)
    ) as new_value,
    public.repair_known_task_mojibake(template.title) as title,
    public.repair_known_task_mojibake(template.description) as description,
    public.repair_known_task_mojibake(template.core_task_label) as core_task_label
  from public.task_templates template
  where (template.title, template.description, template.core_task_label) is distinct from (
    public.repair_known_task_mojibake(template.title),
    public.repair_known_task_mojibake(template.description),
    public.repair_known_task_mojibake(template.core_task_label)
  )
), updated as (
  update public.task_templates template
  set title = candidate.title,
      description = candidate.description,
      core_task_label = candidate.core_task_label,
      updated_at = now()
  from candidates candidate
  where template.id = candidate.id
  returning template.id
)
insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
select candidate.tenant_id, candidate.actor_user_id, 'task_text_mojibake_repaired', 'task_templates', candidate.id, candidate.old_value, candidate.new_value
from candidates candidate
join updated on updated.id = candidate.id;

with candidates as (
  select
    checklist.id,
    task.tenant_id,
    coalesce(task.updated_by, task.created_by) as actor_user_id,
    jsonb_build_object('item_text', checklist.item_text) as old_value,
    jsonb_build_object('item_text', public.repair_known_task_mojibake(checklist.item_text)) as new_value,
    public.repair_known_task_mojibake(checklist.item_text) as item_text
  from public.task_checklists checklist
  join public.task_instances task on task.id = checklist.task_instance_id
  where checklist.item_text is distinct from public.repair_known_task_mojibake(checklist.item_text)
), updated as (
  update public.task_checklists checklist
  set item_text = candidate.item_text
  from candidates candidate
  where checklist.id = candidate.id
  returning checklist.id
)
insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
select candidate.tenant_id, candidate.actor_user_id, 'task_text_mojibake_repaired', 'task_checklists', candidate.id, candidate.old_value, candidate.new_value
from candidates candidate
join updated on updated.id = candidate.id;

alter function public.repair_known_task_mojibake(text) owner to postgres;
revoke all on function public.repair_known_task_mojibake(text) from public;
