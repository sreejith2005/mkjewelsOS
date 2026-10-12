/**
 * In-app CRM links in Kiara's answers (Phase 5).
 *
 * Every CRM client Kiara mentions carries a link to its `/crm` record, so staff
 * open the CRM for contact details instead of Kiara repeating them (owner
 * decision 2026-10-10). The web app routes every `/crm/...` path to the CRM
 * section (apps/web/src/App.tsx), but `getPageForPath` knows only section roots,
 * so the chat renderer accepts these exact CRM paths through this allowlist.
 * Nothing else under `/crm` is linkable from an answer.
 */
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const CRM_PATH = new RegExp(`^/crm(?:/clients/${UUID}|/clients|/followups|/referrals|/dashboard|/queue)?$`, "i");

/** The CRM client record page for a client id. */
export function crmClientPath(clientId: string): string {
  return `/crm/clients/${clientId}`;
}

export const CRM_FOLLOWUPS_PATH = "/crm/followups";
export const CRM_REFERRALS_PATH = "/crm/referrals";
export const CRM_DASHBOARD_PATH = "/crm/dashboard";

/** True for a CRM path Kiara may link to (a client record or a CRM list screen). */
export function isKiaraCrmPath(path: string): boolean {
  return CRM_PATH.test(path);
}
