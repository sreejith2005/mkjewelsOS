-- 0404: a skipped recurring task is recorded once per template and day.
--
-- Finding (production, 2026-11-13): audit_logs held 1.34 million rows / 900 MB.
-- 157,127 of the last 7 days' rows were `recurring_task_skipped`: the 5-minute
-- generator re-skips the same template for the same day on every run and wrote
-- a new identical row each time (about 22,000 a day).
--
-- This migration:
--   1. keeps the EARLIEST skip row per (template, scheduled date) and deletes
--      the later identical repeats. No distinct fact is lost: template, date
--      and reason are the same on every repeat;
--   2. adds a unique partial index so the fact can exist only once;
--   3. patches create_recurring_todo_instance so a repeat is ignored
--      (ON CONFLICT DO NOTHING). Nothing else in generation changes.
--
-- No other audit action is touched. The patch fails the migration if the
-- expected text is not found exactly once (production bodies can differ).

-- 1. Remove repeats, keep the first record of each skip ------------------------
delete from public.audit_logs a
using (
  select id,
         row_number() over (
           partition by record_id, new_value->>'scheduled_date'
           order by created_at, id
         ) as rn
  from public.audit_logs
  where action = 'recurring_task_skipped' and module = 'tasks'
) d
where a.id = d.id and d.rn > 1;

-- 2. One skip row per template and day ----------------------------------------
create unique index audit_logs_recurring_skip_once_idx
  on public.audit_logs (record_id, (new_value->>'scheduled_date'))
  where action = 'recurring_task_skipped' and module = 'tasks';

-- 3. Generation ignores a repeat ----------------------------------------------
do $skip_once$
declare body text; found integer;
  old_text constant text := $o$'reason','weekly_off_or_out_of_scope'));$o$;
  new_text constant text := $n$'reason','weekly_off_or_out_of_scope'))
    on conflict (record_id, (new_value->>'scheduled_date'))
      where action = 'recurring_task_skipped' and module = 'tasks' do nothing;$n$;
begin
  body := replace(pg_get_functiondef('public.create_recurring_todo_instance(uuid,date,uuid[])'::regprocedure), E'\r', '');
  found := (length(body) - length(replace(body, old_text, ''))) / length(old_text);
  if found <> 1 then
    raise exception '0404: expected 1 match in create_recurring_todo_instance, found %', found;
  end if;
  execute replace(body, old_text, new_text);
end $skip_once$;

analyze public.audit_logs;
