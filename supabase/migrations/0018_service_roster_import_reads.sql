-- The server-side roster importer needs lookup reads only. Browser clients do
-- not receive these grants; direct profile mutation remains RPC-only.
set search_path = public;
grant select on table branches, departments, dropdown_masters, user_profiles to service_role;
grant insert, update on table departments, dropdown_masters to service_role;
notify pgrst, 'reload schema';
