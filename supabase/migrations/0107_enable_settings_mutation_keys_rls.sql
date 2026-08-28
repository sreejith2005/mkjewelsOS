-- This table is private state used only by SECURITY DEFINER settings RPCs.
-- RLS is enabled to uphold the tenant-table invariant; it deliberately has no
-- client policy because anon/authenticated/service_role retain no table grants.
alter table public.settings_mutation_keys enable row level security;

notify pgrst, 'reload schema';
