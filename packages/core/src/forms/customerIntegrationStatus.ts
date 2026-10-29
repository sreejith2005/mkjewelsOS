/**
 * Plain-language meaning of the customer integration states returned by migration 0356
 * (`customer_integration_overview`, `get_fms_customer_sync_status`) and of CRM record types.
 * One definition for JewelOS Settings, the FMS stage runner, Form Builder and the CRM.
 */

export const CUSTOMER_SETUP_STATES = ["not_configured", "draft", "awaiting_crm_approval", "active", "form_changed", "blocked", "disabled"] as const;
export type CustomerSetupState = typeof CUSTOMER_SETUP_STATES[number];

export const CUSTOMER_SYNC_STATES = ["not_configured", "queued", "delivering", "retrying", "waiting_authorization", "awaiting_identity_review", "linked", "failed", "rejected"] as const;
export type CustomerSyncState = typeof CUSTOMER_SYNC_STATES[number];

export type StatusTone = "neutral" | "pending" | "success" | "warning" | "danger";
export type StatusText = Readonly<{ label: string; tone: StatusTone; action: string | null }>;

const SETUP: Readonly<Record<CustomerSetupState, StatusText>> = {
  not_configured: { label: "Not configured", tone: "neutral", action: "If this form collects customer details, open it in Form Builder → Customer Data Integration and map the customer questions." },
  draft: { label: "Draft mapping", tone: "neutral", action: "Tick “Enable CRM data integration” and save the mapping." },
  awaiting_crm_approval: { label: "Saved, awaiting CRM approval", tone: "pending", action: "A CRM super admin approves it in CRM → Dashboard → Customer Integration Administration." },
  active: { label: "Approved and active", tone: "success", action: null },
  form_changed: { label: "Form changed, re-approval required", tone: "warning", action: "Open the form in Form Builder, review the carried-over mapping and save it; the CRM then approves the new version." },
  blocked: { label: "Blocked", tone: "danger", action: "The CRM could not register this mapping. Check that both projects are deployed, then wait for the next check (10 minutes)." },
  disabled: { label: "Disabled", tone: "neutral", action: null },
};

const SYNC: Readonly<Record<CustomerSyncState, StatusText>> = {
  not_configured: { label: "Not linked to CRM", tone: "neutral", action: null },
  queued: { label: "Customer sync queued", tone: "pending", action: null },
  delivering: { label: "Sending to CRM", tone: "pending", action: null },
  retrying: { label: "CRM sync delayed, retrying", tone: "pending", action: null },
  waiting_authorization: { label: "Waiting for CRM authorization", tone: "warning", action: "An administrator approves the form or the employee's CRM access." },
  awaiting_identity_review: { label: "Awaiting customer identity review", tone: "warning", action: "A CRM administrator confirms which customer this is." },
  linked: { label: "Linked to CRM customer", tone: "success", action: null },
  failed: { label: "CRM sync failed", tone: "danger", action: "An administrator retries it from Settings → Customer Integration." },
  rejected: { label: "Rejected by CRM review", tone: "neutral", action: null },
};

export function customerSetupStatus(state: string): StatusText {
  return (CUSTOMER_SETUP_STATES as readonly string[]).includes(state) ? SETUP[state as CustomerSetupState] : { label: "Unknown", tone: "neutral", action: null };
}

export function customerSyncStatus(state: string): StatusText {
  return (CUSTOMER_SYNC_STATES as readonly string[]).includes(state) ? SYNC[state as CustomerSyncState] : { label: "Unknown", tone: "neutral", action: null };
}

/** Readable reason codes from either project. Codes only; never customer values. */
const REASONS: Readonly<Record<string, string>> = {
  mapping_unapproved: "the form mapping is not approved in the CRM yet",
  source_unapproved: "JewelOS is not yet approved as a customer source in the CRM",
  actor_or_branch_denied: "the employee has no CRM access for this branch (or the branch is not mapped)",
  customer_branch_denied: "the customer belongs to another branch",
  ambiguous_phone: "the phone number matches more than one customer",
  ambiguous_identity: "the identity matches more than one customer",
  unverified_identity: "the identity matches an unverified customer link",
  missing_customer_name: "no customer name was collected",
  invalid_external_identity: "the Instagram ID or email is not valid",
  journey_identity_conflict: "this workflow is already linked to a different customer",
  mapping_snapshot_changed: "the form changed after the mapping was approved",
  dependency_pending: "waiting for the workflow's starting form to be linked first",
  network: "the CRM could not be reached",
  reviewer_rejected: "a CRM reviewer rejected it",
};

export function customerReasonText(code: string | null | undefined): string | null {
  if (!code) return null;
  if (REASONS[code]) return REASONS[code];
  if (/^(mapping_)?http_\d{3}$/.test(code)) return "the CRM returned an error";
  return code.replaceAll("_", " ");
}

/**
 * Mirrors the CRM browse rule (`20261008000600_crm_lead_continuity.sql`): a person is a Lead only
 * while their stage is lead/engaged and no store visit is recorded; otherwise a Client.
 * Purchase evidence is separate and never changes this.
 */
export type CrmRecordType = "lead" | "client";
export function crmRecordType(input: Readonly<{ lifecycleStage: string | null | undefined; totalVisits: number | null | undefined }>): CrmRecordType {
  return (input.lifecycleStage === "lead" || input.lifecycleStage === "engaged") && (input.totalVisits ?? 0) === 0 ? "lead" : "client";
}
