-- The existing RLS policy can authorize dropdown rows only after this narrow
-- table-level read privilege is present. Direct mutations remain RPC-only.
set search_path = public, extensions;

revoke all privileges on table dropdown_masters from anon, authenticated;
grant select on table dropdown_masters to authenticated;

notify pgrst, 'reload schema';
