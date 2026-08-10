-- Allow authenticated sessions to load the organization/profile records that
-- their existing RLS policies authorize. Mutations remain RPC-only.

set search_path = public, extensions;

revoke all privileges on table
  tenants,
  branches,
  departments,
  user_profiles
from anon, authenticated;

grant select on table
  tenants,
  branches,
  departments,
  user_profiles
to authenticated;
