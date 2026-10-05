import type { CrmProjectConfig } from "@jewelos/crm-ui";

/**
 * The CRM Supabase project the /crm screens read and write (two-project design, 2026-10-01:
 * docs/superpowers/specs/2026-10-01-crm-two-project-client-database-design.md).
 *
 * Only its public URL and anon key reach the browser. That is safe because the CRM project
 * enforces RLS and grants no anon access. A session comes only from the login bridge
 * (crm-session-exchange), in exchange for the JewelOS login.
 */
export const crmProjectConfig: CrmProjectConfig = {
  url: import.meta.env.VITE_CRM_SUPABASE_URL ?? "",
  anonKey: import.meta.env.VITE_CRM_SUPABASE_ANON_KEY ?? "",
};
