-- Half-day deadline safety net for FMS steps (2026-11-03, follows 0371).
--
-- 0371 gives every person step its deadline inside activate_fms_stage_v2_internal. Two other
-- paths still create open person steps without going through that resolver:
--   * move_fms_stage_backward_with_audit ("send back") inserts the step with no deadline;
--   * activate_fms_stage_v1_internal (runs started on execution version 1) uses only the old
--     timing rule, which is empty when "Set deadline" is off.
-- This trigger fills ONLY an empty deadline on an open person step (form/task/approval), from
-- the moment the step became actionable, with the same day_half_deadline() rule. A deadline that
-- any path resolved (form answer, schedule, timing rule) is never touched; completed or skipped
-- steps and End/branch/notification/parallel nodes are never dated. No data is rewritten.
set search_path=public,extensions;

create function fms_visit_day_half_due() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.status in ('pending','in_progress','in_review','overdue')
     and coalesce(new.outcome,'') not in ('condition_skipped','workflow_closed')
     and exists(select 1 from fms_stages s where s.id=new.fms_stage_id and s.step_type::text in ('form','task','approval')) then
    new.planned_datetime:=day_half_deadline(coalesce(new.activated_at,now()));
  end if;
  return new;
end $$;

-- Named to fire after fms_prepare_visit (BEFORE INSERT triggers run in name order).
create trigger fms_visit_day_half_due before insert on fms_instance_stages
  for each row when (new.planned_datetime is null) execute function fms_visit_day_half_due();

revoke all on function fms_visit_day_half_due() from public,anon,authenticated,service_role;
