-- Correct a known UTF-8-as-Windows-1252 corruption introduced by an earlier
-- task import. The byte signatures are deliberately explicit: valid Unicode
-- text is never re-decoded or otherwise transformed.
create or replace function public.repair_known_task_mojibake(p_value text)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select replace(
    replace(
      p_value,
      convert_from(decode('c3a2c280c293', 'hex'), 'UTF8'),
      U&'\2013'
    ),
    convert_from(decode('c3a2c280c299', 'hex'), 'UTF8'),
    U&'\2019'
  )
$$;

create or replace function public.repair_task_text_mojibake_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.title := public.repair_known_task_mojibake(new.title);
  new.description := public.repair_known_task_mojibake(new.description);
  new.core_task_label := public.repair_known_task_mojibake(new.core_task_label);
  return new;
end;
$$;

create or replace function public.repair_task_checklist_mojibake_before_write()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.item_text := public.repair_known_task_mojibake(new.item_text);
  return new;
end;
$$;

drop trigger if exists task_instances_repair_known_mojibake on public.task_instances;
create trigger task_instances_repair_known_mojibake
before insert or update of title, description, core_task_label on public.task_instances
for each row execute function public.repair_task_text_mojibake_before_write();

drop trigger if exists task_templates_repair_known_mojibake on public.task_templates;
create trigger task_templates_repair_known_mojibake
before insert or update of title, description, core_task_label on public.task_templates
for each row execute function public.repair_task_text_mojibake_before_write();

drop trigger if exists task_checklists_repair_known_mojibake on public.task_checklists;
create trigger task_checklists_repair_known_mojibake
before insert or update of item_text on public.task_checklists
for each row execute function public.repair_task_checklist_mojibake_before_write();

do $$
declare
  v_task public.task_instances;
  v_template public.task_templates;
  v_item public.task_checklists;
  v_old jsonb;
  v_new jsonb;
begin
  for v_task in
    select * from public.task_instances
    where (title, description, core_task_label) is distinct from (
      public.repair_known_task_mojibake(title),
      public.repair_known_task_mojibake(description),
      public.repair_known_task_mojibake(core_task_label)
    )
    for update
  loop
    v_old := jsonb_build_object('title', v_task.title, 'description', v_task.description, 'core_task_label', v_task.core_task_label);
    update public.task_instances
    set title = public.repair_known_task_mojibake(v_task.title),
        description = public.repair_known_task_mojibake(v_task.description),
        core_task_label = public.repair_known_task_mojibake(v_task.core_task_label),
        updated_at = now()
    where id = v_task.id;
    v_new := jsonb_build_object('title', public.repair_known_task_mojibake(v_task.title), 'description', public.repair_known_task_mojibake(v_task.description), 'core_task_label', public.repair_known_task_mojibake(v_task.core_task_label));
    insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (v_task.tenant_id, coalesce(v_task.updated_by, v_task.created_by), 'task_text_mojibake_repaired', 'tasks', v_task.id, v_old, v_new);
  end loop;

  for v_template in
    select * from public.task_templates
    where (title, description, core_task_label) is distinct from (
      public.repair_known_task_mojibake(title),
      public.repair_known_task_mojibake(description),
      public.repair_known_task_mojibake(core_task_label)
    )
    for update
  loop
    v_old := jsonb_build_object('title', v_template.title, 'description', v_template.description, 'core_task_label', v_template.core_task_label);
    update public.task_templates
    set title = public.repair_known_task_mojibake(v_template.title),
        description = public.repair_known_task_mojibake(v_template.description),
        core_task_label = public.repair_known_task_mojibake(v_template.core_task_label),
        updated_at = now()
    where id = v_template.id;
    v_new := jsonb_build_object('title', public.repair_known_task_mojibake(v_template.title), 'description', public.repair_known_task_mojibake(v_template.description), 'core_task_label', public.repair_known_task_mojibake(v_template.core_task_label));
    insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    values (v_template.tenant_id, coalesce(v_template.updated_by, v_template.created_by), 'task_text_mojibake_repaired', 'task_templates', v_template.id, v_old, v_new);
  end loop;

  for v_item in
    select checklist.*
    from public.task_checklists checklist
    join public.task_instances task on task.id = checklist.task_instance_id
    where checklist.item_text is distinct from public.repair_known_task_mojibake(checklist.item_text)
    for update of checklist
  loop
    update public.task_checklists
    set item_text = public.repair_known_task_mojibake(v_item.item_text)
    where id = v_item.id;
    select jsonb_build_object('item_text', v_item.item_text), jsonb_build_object('item_text', public.repair_known_task_mojibake(v_item.item_text))
    into v_old, v_new;
    insert into public.audit_logs(tenant_id, actor_user_id, action, module, record_id, old_value, new_value)
    select task.tenant_id, coalesce(task.updated_by, task.created_by), 'task_text_mojibake_repaired', 'task_checklists', v_item.id, v_old, v_new
    from public.task_instances task where task.id = v_item.task_instance_id;
  end loop;
end;
$$;

alter function public.repair_known_task_mojibake(text) owner to postgres;
alter function public.repair_task_text_mojibake_before_write() owner to postgres;
alter function public.repair_task_checklist_mojibake_before_write() owner to postgres;

revoke all on function public.repair_known_task_mojibake(text) from public;
revoke all on function public.repair_task_text_mojibake_before_write() from public;
revoke all on function public.repair_task_checklist_mojibake_before_write() from public;
