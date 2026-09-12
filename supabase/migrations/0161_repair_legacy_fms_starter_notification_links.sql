-- Repair starter-assignment notifications created before 0160.
--
-- The original `queue_fms_starter_assignments` (migration 0063) hardcoded
-- `link_url = '/forms'` and recorded no source identity, so an assignee opening
-- their notification landed on the Forms Library and had to find the form
-- themselves. Migration 0160 fixed the function, but only for notifications
-- written after it — the rows already in the table still point at `/forms`.
--
-- Old rows carry no assignment id, so the recipient's pending starter
-- assignment is the only thing that can identify the work. That is unambiguous
-- exactly when the recipient has one pending assignment; where it is not, the
-- row is left alone rather than guessed at. `fms_starter_assignments` is unique
-- on (fms_flow_id, user_profile_id), so a second pending row means a genuinely
-- different flow and a genuinely ambiguous notification.
--
-- Backfilling `source_module`/`source_record_id` also lets the completion
-- trigger added in 0160 close these notifications, which it cannot do while
-- they carry no source record.
set search_path = public, extensions;

update public.notifications n
set link_url = '/tasks/fms?starter=' || s.id || '&form=' || s.form_template_id,
    source_module = 'fms',
    source_record_id = s.id
from public.fms_starter_assignments s
where n.event_type = 'fms_starter_assigned'
  and n.link_url = '/forms'
  and n.source_record_id is null
  and s.tenant_id = n.tenant_id
  and s.user_profile_id = n.user_profile_id
  and s.status = 'pending'
  and (
    select count(*) from public.fms_starter_assignments other
    where other.tenant_id = n.tenant_id
      and other.user_profile_id = n.user_profile_id
      and other.status = 'pending'
  ) = 1;

notify pgrst, 'reload schema';
