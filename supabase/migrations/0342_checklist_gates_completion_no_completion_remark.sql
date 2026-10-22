-- Owner decision 2026-10-22: a checklist is ticked by hand before its task can be
-- completed, and tasks no longer ask for a completion remark.
--
-- 1. Checklist gate. Migration 0143 made completion close any outstanding
--    checklist items, because the only item of an imported occurrence sat behind
--    "View details" and nobody could find it. The web card now leads with the
--    checklist, so the gate returns: completing a task through any path (the
--    Complete action, upload-and-complete, recurring image completion, or the
--    required-form trigger) is refused while a required, live checklist item is
--    unticked. Optional items are no longer closed on the doer's behalf either;
--    the checklist records exactly what was ticked.
--
-- 2. No completion remark. The `requires_remark` flag and the on-behalf remark
--    rule stop blocking completion. `p_remark` is still accepted and stored as
--    `completion_remark` when given, and the column and flag stay for history.
--    Remarks now live in the task's remark thread (In Loop participants).
--
-- The remark guards are removed by guarded text replacement of each function as
-- it is now defined (0143/0156/0238 layered edits), matching whitespace and line
-- endings loosely, and the migration fails if any guard is not found exactly once.
set search_path=public,extensions;

create or replace function public.complete_task_checklist_items(p_task_id uuid,p_actor_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from task_checklists
            where task_instance_id=p_task_id and deleted_at is null and is_required and not is_completed) then
    raise exception 'Tick every required checklist item before completing this task' using errcode='23514';
  end if;
end $$;
revoke all on function public.complete_task_checklist_items(uuid,uuid) from public,anon,authenticated,service_role;

do $remarks$
declare
  v_def text; v_new text; v_guard record; v_hits integer;
begin
  for v_guard in
    select * from (values
      ('public.update_task_with_audit(uuid,text,uuid,boolean,text)',
       $p$if v_old\.requires_remark and nullif\(btrim\(p_remark\),''\) is null then\s+raise exception 'A completion remark is required' using errcode = '23514';\s+end if;$p$),
      ('public.update_task_with_audit(uuid,text,uuid,boolean,text)',
       $p$if not v_own and nullif\(btrim\(p_remark\),''\) is null then\s+raise exception 'A remark is required when completing a task on behalf of the doer'\s+using errcode = '23514';\s+end if;$p$),
      ('public.complete_uploaded_task_with_audit(uuid,text)',
       $p$if v_old\.requires_remark or not v_own then\s+raise exception 'Upload evidence, then complete with a remark' using errcode='23514'; end if;$p$),
      ('public.complete_recurring_task_with_image_with_audit(uuid,text)',
       $p$if v_task\.requires_remark or not v_own then\s+raise exception 'Upload evidence, then complete with a remark' using errcode='23514'; end if;$p$)
    ) as guard(signature, pattern)
  loop
    v_def := pg_get_functiondef(v_guard.signature::regprocedure);
    select count(*) into v_hits from regexp_matches(v_def, v_guard.pattern, 'g');
    if v_hits <> 1 then
      raise exception '0342: expected one remark guard in %, found %', v_guard.signature, v_hits;
    end if;
    v_new := regexp_replace(v_def, v_guard.pattern, '-- 0342: no completion remark is required.');
    execute v_new;
  end loop;

  -- Belt and braces: none of the remark refusals may survive.
  foreach v_def in array array[
    pg_get_functiondef('public.update_task_with_audit(uuid,text,uuid,boolean,text)'::regprocedure),
    pg_get_functiondef('public.complete_uploaded_task_with_audit(uuid,text)'::regprocedure),
    pg_get_functiondef('public.complete_recurring_task_with_image_with_audit(uuid,text)'::regprocedure)
  ] loop
    if position('A completion remark is required' in v_def) > 0
       or position('on behalf of the doer' in v_def) > 0
       or position('then complete with a remark' in v_def) > 0 then
      raise exception '0342: a completion remark guard survived';
    end if;
  end loop;
end $remarks$;

-- The replaced functions keep their existing grants (create or replace preserves them).
