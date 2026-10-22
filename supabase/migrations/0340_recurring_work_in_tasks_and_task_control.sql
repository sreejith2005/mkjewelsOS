-- Recurring / To-Do retires as a page (2026-10-21). Recurring work is created
-- from Create Task and managed in Task Control; nothing about the data changes.
--
-- 1. Verification and follow-ups move into Task Control's Review tab, so they
--    follow Task Control's section switch instead of the retired one. The role
--    and verifier checks inside each function are unchanged.
-- 2. Their notifications open the exact task in Tasks instead of the retired
--    page. Existing notification rows keep their old link; the web app
--    redirects /recurring-todo by role.
-- 3. An as-needed duty created by hand keeps its trigger wording
--    ("Per Customer"), as imported duties already do (0293).
-- 4. Creating an as-needed duty no longer also creates an ordinary task for
--    that day; it runs only when started or assigned now (0293, 0297).
--
-- Every change is a guarded text replacement of the function as it is
-- currently defined, so the migration fails loudly rather than silently
-- installing an older body if a definition has drifted. No table, column, row,
-- grant or RLS policy is touched.

do $migration$
declare
  v_def text;
  v_new text;
begin
  -- 1 + 2: verification.
  v_def := pg_get_functiondef('public.verify_recurring_task_with_audit(uuid,text,text)'::regprocedure);
  if (length(v_def) - length(replace(v_def, $q$perform public.assert_module_enabled('recurring_todo');$q$, ''))) = 0
     or (length(v_def) - length(replace(v_def, $q$'/recurring-todo'$q$, ''))) <> length($q$'/recurring-todo'$q$) then
    raise exception '0340: verify_recurring_task_with_audit is not the expected function body';
  end if;
  v_new := replace(v_def, $q$perform public.assert_module_enabled('recurring_todo');$q$,
                          $q$perform public.assert_module_enabled('task_templates');$q$);
  v_new := replace(v_new, $q$'/recurring-todo'$q$, $q$'/tasks?task_id='||p_task_id::text$q$);
  execute v_new;

  -- 1 + 2: follow-ups.
  v_def := pg_get_functiondef('public.send_recurring_followup_with_audit(uuid,text)'::regprocedure);
  if (length(v_def) - length(replace(v_def, $q$perform public.assert_module_enabled('recurring_todo');$q$, ''))) = 0
     or (length(v_def) - length(replace(v_def, $q$'/recurring-todo'$q$, ''))) <> length($q$'/recurring-todo'$q$) then
    raise exception '0340: send_recurring_followup_with_audit is not the expected function body';
  end if;
  v_new := replace(v_def, $q$perform public.assert_module_enabled('recurring_todo');$q$,
                          $q$perform public.assert_module_enabled('task_templates');$q$);
  v_new := replace(v_new, $q$'/recurring-todo'$q$, $q$'/tasks?task_id='||p_task_id::text$q$);
  execute v_new;

  -- 3: trigger wording on a hand-made as-needed duty.
  v_def := pg_get_functiondef('public.save_recurring_todo_template_with_audit(uuid,jsonb)'::regprocedure);
  if position($q$'verifier_user_profile_id'];$q$ in v_def) = 0
     or position(E'    due_time=v_due_time,\n' in v_def) = 0
     or position('trigger_label' in v_def) > 0 then
    raise exception '0340: save_recurring_todo_template_with_audit is not the expected function body';
  end if;
  -- The delegate rejects unknown keys, so the wording is taken out of the
  -- payload it receives and written here instead.
  v_new := replace(v_def, $q$'verifier_user_profile_id'];$q$, $q$'verifier_user_profile_id','trigger_label'];$q$);
  -- Only an as-needed duty has trigger wording. An edit that does not send the
  -- key keeps the wording it has (older clients); a calendar schedule has none.
  v_new := replace(v_new, E'    due_time=v_due_time,\n',
    E'    due_time=v_due_time,\n'
    || E'    trigger_label=case when v_kind<>''as_required'' then null\n'
    || E'      when p_payload ? ''trigger_label'' then left(nullif(btrim(p_payload->>''trigger_label''),''''),80)\n'
    || E'      else trigger_label end,\n');
  execute v_new;

  -- 4: a new template saved inactive gets no first occurrence. Only an
  -- as-needed duty is created inactive (the save RPC above forces it), and it
  -- must run on demand rather than appear as an ordinary task on the day it is
  -- made. The importer passes its own active start and is unaffected.
  v_def := pg_get_functiondef('public.save_task_template_with_audit(uuid,jsonb)'::regprocedure);
  -- The guard sits on the insert itself, so the default-datetime branch that
  -- test 0069 checks keeps its text.
  if (length(v_def) - length(replace(v_def, E'    if v_initial_planned_datetime is not null then\n', '')))
     <> length(E'    if v_initial_planned_datetime is not null then\n') then
    raise exception '0340: save_task_template_with_audit is not the expected function body';
  end if;
  v_new := replace(v_def, E'    if v_initial_planned_datetime is not null then\n',
    E'    if v_initial_planned_datetime is not null\n'
    || E'       and coalesce((p_payload->>''is_active'')::boolean, true) then\n');
  execute v_new;
end
$migration$;

notify pgrst, 'reload schema';
