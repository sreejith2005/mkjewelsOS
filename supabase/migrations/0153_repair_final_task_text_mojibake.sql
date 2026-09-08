-- Repair the final observed malformed punctuation signature from the
-- post-deploy scan. This remains an explicit byte-signature mapping only.
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
    ),
    convert_from(decode('c3a2c280c29d', 'hex'), 'UTF8'),
    U&'\201D'
  )
$$;

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

alter function public.repair_known_task_mojibake(text) owner to postgres;
revoke all on function public.repair_known_task_mojibake(text) from public;
