-- Hosted default privileges can grant more than a clean local installation.
-- Make the builder configuration contract explicit on both environments.
revoke all on table public.fms_context_assignee_defaults from public, anon, authenticated;
grant select on table public.fms_context_assignee_defaults to authenticated;
-- Existing RLS and the audited SECURITY DEFINER writer remain unchanged.
