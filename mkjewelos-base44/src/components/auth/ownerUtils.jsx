/**
 * Owner / Platform Admin Utilities
 *
 * The app owner logs in with role='admin' (platform role) and should see
 * ALL data across all tenants and branches — no filters applied.
 *
 * Usage:
 *   import { ownerFilter, makeOwnerProfile } from '@/components/auth/ownerUtils';
 *   const filter = ownerFilter(isOwner, { tenant_id: profile.tenant_id });
 *   // → {} if owner (fetch all), or { tenant_id: '...' } otherwise
 */

/**
 * Returns {} for owners (→ fetch all records), or the provided filter for normal users.
 */
export function ownerFilter(isOwner, filter) {
  if (isOwner) return {};
  return filter;
}

/**
 * Synthetic UserProfile for the platform owner so analytics / role logic works.
 */
export function makeOwnerProfile(user) {
  return {
    user_id: user?.id,
    tenant_id: null,
    branch_id: null,
    department_id: null,
    role_level: 'super_admin',
    designation: 'Platform Owner',
    is_active: true,
    permissions: ['*'],
  };
}