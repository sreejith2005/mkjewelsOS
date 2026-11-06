import { crmClientPath } from "../assistant/crmLinks";
import { DAY_HALF_DUE_TIMES, type DayHalf } from "../dayHalfDeadline";
import type { SalesOutcome } from "./analysis";

/**
 * Store Intelligence integration contracts (JewelOS migration 0384, CRM migration
 * 20261106000200) and the plain words the screens use for them.
 *
 * Three things are kept apart on purpose:
 *  - what the AI heard in the conversation (a suggestion),
 *  - which CRM customer a person chose, and whether the CRM has confirmed that link,
 *  - what the CRM records as a verified purchase (docs/REPORTS.md rule).
 */

const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";
const str = (value: unknown): string | null => (isString(value) && value.trim() ? value : null);
const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number.isFinite(Number(value)) ? Number(value) : null);
const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null => values.find((item) => item === value) ?? null;

// ---------------------------------------------------------------------------
// Finding the customer: exact identifiers only (mirrors crm_store_conversation_candidates).
export const CANDIDATE_QUERY_KINDS = ["client_code", "visit_reference", "phone", "invalid"] as const;
export type CandidateQueryKind = (typeof CANDIDATE_QUERY_KINDS)[number];

/** What the CRM will treat the typed text as. A name alone is never a search. */
export function candidateQueryKind(query: string): CandidateQueryKind {
  const q = query.replace(/\s+/g, "").toUpperCase();
  if (q.length < 4 || q.length > 40) return "invalid";
  if (/^MKC-?\d{1,12}$/.test(q)) return "client_code";
  if (/^MKREF-[A-Z0-9-]{1,40}$/.test(q)) return "visit_reference";
  const digits = q.replace(/^\+/, "").replace(/[-()]/g, "");
  return /^\d{8,15}$/.test(digits) ? "phone" : "invalid";
}

export type CrmCandidate = Readonly<{
  kind: "client" | "lead" | "visit"; target_id: string; client_id: string | null; client_code: string | null; name: string;
  phone_hint: string | null; last_visit_at: string | null; total_visits: number; visit_at: string | null; visit_reference: string | null;
}>;
export type CrmCandidateResult = Readonly<{ query_kind: CandidateQueryKind; candidates: readonly CrmCandidate[] }>;

export function parseCrmCandidates(raw: unknown): CrmCandidateResult {
  if (!isObject(raw) || !Array.isArray(raw.candidates)) throw new Error("invalid_candidates");
  return {
    query_kind: oneOf(CANDIDATE_QUERY_KINDS, raw.query_kind) ?? "invalid",
    candidates: raw.candidates.flatMap((item) => {
      const kind = isObject(item) ? oneOf(["client", "lead", "visit"] as const, item.kind) : null;
      if (!isObject(item) || !kind || !isString(item.target_id)) return [];
      return [{ kind, target_id: item.target_id, client_id: str(item.client_id), client_code: str(item.client_code), name: str(item.name) ?? "Name not recorded",
        phone_hint: str(item.phone_hint), last_visit_at: str(item.last_visit_at), total_visits: num(item.total_visits) ?? 0,
        visit_at: str(item.visit_at), visit_reference: str(item.visit_reference) }];
    }),
  };
}

export type CustomerLinkTarget = Readonly<{
  kind: "client" | "lead" | "visit"; target_id: string; match_basis: "client_code" | "visit_reference" | "phone";
  candidate_count: number; display_code: string | null; display_name: string;
}>;
/** The link payload for the candidate a person picked out of `result`. */
export function linkTargetFor(result: CrmCandidateResult, chosen: CrmCandidate): CustomerLinkTarget {
  if (result.query_kind === "invalid" || !result.candidates.includes(chosen)) throw new Error("candidate_not_offered");
  return {
    kind: chosen.kind, target_id: chosen.target_id,
    match_basis: result.query_kind === "client_code" ? "client_code" : result.query_kind === "visit_reference" ? "visit_reference" : "phone",
    candidate_count: Math.min(Math.max(result.candidates.length, 1), 20), display_code: chosen.client_code?.slice(0, 40) ?? null, display_name: chosen.name.slice(0, 160),
  };
}

// ---------------------------------------------------------------------------
// Link, sync and outcome states, in words for the screen.
export const LINK_STATES = ["pending", "verified", "rejected"] as const;
export type LinkState = (typeof LINK_STATES)[number];
export const LINK_STATE_LABEL: Readonly<Record<LinkState, string>> = {
  pending: "Waiting for CRM to confirm", verified: "Confirmed by CRM", rejected: "CRM did not accept this link",
};
export const SYNC_STATES = ["not_queued", "queued", "retrying", "waiting_for_crm_approval", "synced", "refused", "failed"] as const;
export type SyncState = (typeof SYNC_STATES)[number];
/** Never says "synced" unless the CRM acknowledged the entry. */
export const SYNC_LABEL: Readonly<Record<SyncState, string>> = {
  not_queued: "Not sent to CRM", queued: "Sending to CRM", retrying: "Could not reach CRM yet, retrying",
  waiting_for_crm_approval: "Waiting for a CRM administrator to allow JewelOS", synced: "Shown in the CRM history",
  refused: "The CRM refused this entry", failed: "Sending to CRM failed",
};
export const CRM_REFUSAL_REASON: Readonly<Record<string, string>> = {
  actor_not_crm_user: "The person who linked it has no CRM access.",
  target_not_found: "The CRM could not find this customer.",
  invalid_target: "The chosen record is not a CRM customer.",
  crm_refused: "The CRM refused it.",
};

export const CRM_RESULT_STATES = ["pending_crm_confirmation", "crm_confirmed_purchase", "purchase_credited_elsewhere", "no_crm_purchase_yet", "no_crm_purchase_in_window"] as const;
export type CrmResultState = (typeof CRM_RESULT_STATES)[number];
export const CRM_RESULT_LABEL: Readonly<Record<CrmResultState, string>> = {
  pending_crm_confirmation: "Pending CRM confirmation",
  crm_confirmed_purchase: "Purchase confirmed in CRM",
  purchase_credited_elsewhere: "Purchase confirmed in CRM (credited to a later conversation)",
  no_crm_purchase_yet: "No purchase in CRM yet",
  no_crm_purchase_in_window: "No purchase recorded in CRM",
};

export const AI_INTENTS = ["converted", "not_converted", "follow_up", "unknown"] as const;
export type AiIntent = (typeof AI_INTENTS)[number];
/** What the AI heard. Always shown as a suggestion, never as the result. */
export const AI_INTENT_LABEL: Readonly<Record<AiIntent, string>> = {
  converted: "Converted (AI-suggested)", not_converted: "Not converted (AI-suggested)", follow_up: "Follow up (AI-suggested)", unknown: "Unknown (AI-suggested)",
};
export function aiIntentOf(outcome: SalesOutcome | null | undefined): AiIntent {
  return outcome === "reported_purchase" ? "converted" : outcome === "no_purchase" ? "not_converted" : outcome === "follow_up" ? "follow_up" : "unknown";
}

// ---------------------------------------------------------------------------
// Follow-ups.
export const FOLLOW_UP_CHANNELS = ["call", "whatsapp", "visit", "other"] as const;
export type FollowUpChannel = (typeof FOLLOW_UP_CHANNELS)[number];
/** Recommendations only: nothing is ever sent to the customer from here. */
export const FOLLOW_UP_CHANNEL_LABEL: Readonly<Record<FollowUpChannel, string>> = {
  call: "Phone call", whatsapp: "WhatsApp message", visit: "Invite for a store visit", other: "Other follow-up",
};

/** The stored deadline for a chosen India day and half (mirrors migration 0384 / 0371). */
export function dueAtForDayHalf(date: string, half: DayHalf): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))) throw new Error("invalid_due_date");
  return new Date(`${date}T${DAY_HALF_DUE_TIMES[half]}:00+05:30`).toISOString();
}

export type FollowUpInput = Readonly<{
  analysisId: string; actionIndex: number; requestKey: string; title: string; note: string; channel: FollowUpChannel;
  ownerId: string | null; supervisorId: string | null; dueDate: string | null; dueHalf: DayHalf | null; fmsFlowId: string | null;
}>;
/** The RPC payload. Empty optional fields are left out so the server applies its defaults. */
export function followUpPayload(input: FollowUpInput): Record<string, string | number> {
  const payload: Record<string, string | number> = { analysis_id: input.analysisId, action_index: input.actionIndex, request_key: input.requestKey, channel: input.channel };
  if (input.title.trim()) payload.title = input.title.trim().slice(0, 200);
  if (input.note.trim()) payload.note = input.note.trim().slice(0, 1000);
  if (input.ownerId) payload.owner_id = input.ownerId;
  if (input.supervisorId) payload.supervisor_id = input.supervisorId;
  if (input.dueDate && input.dueHalf) { payload.due_date = input.dueDate; payload.due_half = input.dueHalf; }
  if (input.fmsFlowId) payload.fms_flow_id = input.fmsFlowId;
  return payload;
}

// ---------------------------------------------------------------------------
// Conversation integration read (recording_session_integration).
export type CustomerLinkView = Readonly<{
  link_id: string; kind: string; target_id: string; crm_client_id: string | null; code: string | null; name: string | null;
  display_source: "crm_search" | "walkin_task" | "crm_ack"; display_stale: boolean; match_basis: string; candidate_count: number;
  state: LinkState; state_reason: string | null; verified_at: string | null; linked_at: string; linked_by_name: string | null;
  sync: SyncState; sync_error: string | null; sync_attempts: number;
}>;
export type LinkHistoryItem = Readonly<{ link_id: string; name: string | null; code: string | null; state: LinkState; linked_at: string; linked_by_name: string | null;
  ended_at: string | null; end_kind: "unlinked" | "corrected" | null; end_reason: string | null; ended_by_name: string | null; withdrawal_sync: string | null }>;
export type ExistingFollowUp = Readonly<{ follow_up_id: string | null; task_id: string | null; fms_instance_id: string | null; fms_reference: string | null }>;
export type Suggestion = Readonly<{ analysis_id: string; action_index: number; action: string; reason: string | null; evidence: unknown; existing: ExistingFollowUp | null }>;
export type FollowUpView = Readonly<{
  follow_up_id: string | null; action_index: number; source_text: string | null; title: string; note: string | null; channel: FollowUpChannel;
  owner_name: string | null; supervisor_name: string | null; due_at: string | null; due_half: DayHalf | null; task_id: string | null;
  fms_instance_id: string | null; fms_reference: string | null; fms_stage_id: string | null; status: string; created_at: string; created_by_name: string | null;
  customer: Readonly<{ name: string | null; code: string | null; state: LinkState }> | null;
  notification: Readonly<{ state: "delivered" | "pending" | "failed"; channel: string | null }> | null;
}>;
export const READINESS_KEYS = ["client_match", "crm_sync", "work", "notifications"] as const;
export type Readiness = Readonly<{ client_match: string; crm_sync: string; crm_outcome: string; work: string; notifications: string }>;
export type ConversationIntegration = Readonly<{
  can_link: boolean; can_create_follow_up: boolean; is_reviewer: boolean;
  customer: CustomerLinkView | null; history: readonly LinkHistoryItem[];
  outcome: Readonly<{ ai: AiIntent; crm: Readonly<{ state: CrmResultState; reason: string | null; checked_at: string | null; window_until: string | null; purchase_visit_at: string | null; visits: number | null }> }>;
  follow_ups: readonly FollowUpView[]; suggestions: readonly Suggestion[]; readiness: Readiness; outcome_window_days: number;
}>;

function parseExisting(raw: unknown): ExistingFollowUp | null {
  if (!isObject(raw)) return null;
  return { follow_up_id: str(raw.follow_up_id), task_id: str(raw.task_id), fms_instance_id: str(raw.fms_instance_id), fms_reference: str(raw.fms_reference) };
}

export function parseConversationIntegration(raw: unknown): ConversationIntegration {
  if (!isObject(raw) || !isObject(raw.outcome) || !isObject(raw.readiness)) throw new Error("invalid_integration");
  const c = raw.customer;
  let customer: CustomerLinkView | null = null;
  if (isObject(c)) {
    const state = oneOf(LINK_STATES, c.state); const sync = oneOf(SYNC_STATES, c.sync); const source = oneOf(["crm_search", "walkin_task", "crm_ack"] as const, c.display_source);
    if (!state || !sync || !source || !isString(c.link_id) || !isString(c.linked_at)) throw new Error("invalid_customer_link");
    customer = { link_id: c.link_id, kind: String(c.kind), target_id: String(c.target_id), crm_client_id: str(c.crm_client_id), code: str(c.code), name: str(c.name),
      display_source: source, display_stale: c.display_stale === true, match_basis: String(c.match_basis), candidate_count: num(c.candidate_count) ?? 1,
      state, state_reason: str(c.state_reason), verified_at: str(c.verified_at), linked_at: c.linked_at, linked_by_name: str(c.linked_by_name),
      sync, sync_error: str(c.sync_error), sync_attempts: num(c.sync_attempts) ?? 0 };
  }
  const crm = isObject(raw.outcome.crm) ? raw.outcome.crm : {};
  const r = raw.readiness;
  return {
    can_link: raw.can_link === true, can_create_follow_up: raw.can_create_follow_up === true, is_reviewer: raw.is_reviewer === true, customer,
    history: (Array.isArray(raw.history) ? raw.history : []).flatMap((h) => isObject(h) && isString(h.link_id) && isString(h.linked_at) ? [{
      link_id: h.link_id, name: str(h.name), code: str(h.code), state: oneOf(LINK_STATES, h.state) ?? "pending", linked_at: h.linked_at, linked_by_name: str(h.linked_by_name),
      ended_at: str(h.ended_at), end_kind: oneOf(["unlinked", "corrected"] as const, h.end_kind), end_reason: str(h.end_reason), ended_by_name: str(h.ended_by_name),
      withdrawal_sync: str(h.withdrawal_sync) }] : []),
    outcome: {
      ai: oneOf(AI_INTENTS, raw.outcome.ai_label) ?? "unknown",
      crm: { state: oneOf(CRM_RESULT_STATES, crm.state) ?? "pending_crm_confirmation", reason: str(crm.reason), checked_at: str(crm.checked_at),
        window_until: str(crm.window_until), purchase_visit_at: str(crm.purchase_visit_at), visits: num(crm.visits) },
    },
    follow_ups: (Array.isArray(raw.follow_ups) ? raw.follow_ups : []).flatMap((f) => isObject(f) && isString(f.title) && isString(f.created_at) ? [{
      follow_up_id: str(f.follow_up_id), action_index: num(f.action_index) ?? 0, source_text: str(f.source_text), title: f.title, note: str(f.note),
      channel: oneOf(FOLLOW_UP_CHANNELS, f.channel) ?? "other", owner_name: str(f.owner_name), supervisor_name: str(f.supervisor_name), due_at: str(f.due_at),
      due_half: oneOf(["first_half", "second_half"] as const, f.due_half), task_id: str(f.task_id), fms_instance_id: str(f.fms_instance_id), fms_reference: str(f.fms_reference),
      fms_stage_id: str(f.fms_stage_id), status: str(f.status) ?? "pending", created_at: f.created_at, created_by_name: str(f.created_by_name),
      customer: isObject(f.customer) ? { name: str(f.customer.name), code: str(f.customer.code), state: oneOf(LINK_STATES, f.customer.state) ?? "pending" } : null,
      notification: isObject(f.notification) && oneOf(["delivered", "pending", "failed"] as const, f.notification.state)
        ? { state: oneOf(["delivered", "pending", "failed"] as const, f.notification.state)!, channel: str(f.notification.channel) } : null, // Checked in the condition.
    }] : []),
    suggestions: (Array.isArray(raw.suggestions) ? raw.suggestions : []).flatMap((s) => isObject(s) && isString(s.analysis_id) && num(s.action_index) !== null && isString(s.action) ? [{
      analysis_id: s.analysis_id, action_index: Number(s.action_index), action: s.action, reason: str(s.reason), evidence: s.evidence ?? [], existing: parseExisting(s.existing) }] : []),
    readiness: { client_match: String(r.client_match ?? "not_linked"), crm_sync: String(r.crm_sync ?? "not_linked"), crm_outcome: String(r.crm_outcome ?? "pending_crm_confirmation"),
      work: String(r.work ?? "none"), notifications: String(r.notifications ?? "none") },
    outcome_window_days: num(raw.outcome_window_days) ?? 30,
  };
}

export type ReadinessTone = "ok" | "waiting" | "problem" | "idle";
export type ReadinessItem = Readonly<{ key: (typeof READINESS_KEYS)[number]; label: string; value: string; tone: ReadinessTone }>;
/** One line per integration: client match, CRM activity sync, task/FMS creation, notification outcome. */
export function readinessItems(r: Readiness): readonly ReadinessItem[] {
  const match: Record<string, [string, ReadinessTone]> = {
    not_linked: ["No customer linked", "idle"], legacy_walkin: ["CRM walk-in (earlier link)", "ok"], pending: ["Waiting for CRM to confirm", "waiting"],
    verified: ["Confirmed by CRM", "ok"], rejected: ["CRM did not accept", "problem"],
  };
  const sync: Record<string, [string, ReadinessTone]> = {
    not_linked: ["Nothing to send", "idle"], not_queued: ["Not sent", "problem"], queued: ["Sending", "waiting"], retrying: ["Retrying", "waiting"],
    waiting_for_crm_approval: ["Waiting for CRM approval", "waiting"], synced: ["In CRM history", "ok"], refused: ["Refused by CRM", "problem"], failed: ["Failed", "problem"],
  };
  const work: Record<string, [string, ReadinessTone]> = { none: ["No follow-up yet", "idle"], created: ["Follow-up created", "ok"] };
  const notes: Record<string, [string, ReadinessTone]> = {
    none: ["Nothing sent", "idle"], pending: ["Waiting to be delivered", "waiting"], delivered: ["Delivered", "ok"], failed: ["Delivery failed", "problem"],
  };
  const pick = (table: Record<string, [string, ReadinessTone]>, value: string): [string, ReadinessTone] => table[value] ?? ["Unknown", "waiting"];
  const [m, mt] = pick(match, r.client_match); const [s, st] = pick(sync, r.crm_sync); const [w, wt] = pick(work, r.work); const [n, nt] = pick(notes, r.notifications);
  return [
    { key: "client_match", label: "Client match", value: m, tone: mt },
    { key: "crm_sync", label: "CRM activity", value: s, tone: st },
    { key: "work", label: "Task / FMS", value: w, tone: wt },
    { key: "notifications", label: "Notification", value: n, tone: nt },
  ];
}

/** The CRM record page, only once the CRM has confirmed which client it is. */
export function crmProfilePathFor(link: CustomerLinkView | null): string | null {
  return link && link.state === "verified" && link.crm_client_id ? crmClientPath(link.crm_client_id) : null;
}

// ---------------------------------------------------------------------------
// Options for the follow-up form, and branch readiness.
export type FollowUpOptions = Readonly<{
  owners: readonly Readonly<{ id: string; name: string; is_salesperson: boolean }>[];
  supervisors: readonly Readonly<{ id: string; name: string }>[];
  flows: readonly Readonly<{ id: string; name: string }>[];
  default_due: string | null;
}>;
export function parseFollowUpOptions(raw: unknown): FollowUpOptions {
  if (!isObject(raw)) throw new Error("invalid_follow_up_options");
  const people = (value: unknown) => (Array.isArray(value) ? value : []).flatMap((p) => isObject(p) && isString(p.id) && isString(p.name) ? [{ id: p.id, name: p.name, is_salesperson: p.is_salesperson === true }] : []);
  return { owners: people(raw.owners), supervisors: people(raw.supervisors).map(({ id, name }) => ({ id, name })),
    flows: (Array.isArray(raw.flows) ? raw.flows : []).flatMap((f) => isObject(f) && isString(f.id) && isString(f.name) ? [{ id: f.id, name: f.name }] : []),
    default_due: str(raw.default_due) };
}

export type IntegrationHealth = Readonly<Record<"client_match" | "crm_sync" | "crm_outcomes" | "work" | "notifications", Readonly<Record<string, number | string | null>>>>;
export function parseIntegrationHealth(raw: unknown): IntegrationHealth {
  if (!isObject(raw)) throw new Error("invalid_integration_health");
  const section = (value: unknown): Readonly<Record<string, number | string | null>> => isObject(value)
    ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, typeof v === "number" ? v : isString(v) ? (num(v) ?? v) : null])) : {};
  return { client_match: section(raw.client_match), crm_sync: section(raw.crm_sync), crm_outcomes: section(raw.crm_outcomes), work: section(raw.work), notifications: section(raw.notifications) };
}

// ---------------------------------------------------------------------------
// Insights: CRM-confirmed results next to AI suggestions.
export type CrmInsights = Readonly<{
  ai_suggested: Readonly<Record<AiIntent, number>>;
  crm: Readonly<{ linked: number; confirmed_purchases: number; pending_confirmation: number; no_purchase_yet: number; no_purchase_in_window: number;
    credited_elsewhere: number; ai_converted_confirmed: number; ai_converted_not_confirmed: number }>;
  revenue: Readonly<{ verified: number | null; verified_note: string; estimated: number | null; ticket_inr: number | null; formula: string }>;
  window_days: number;
}>;
export function parseCrmInsights(raw: unknown): CrmInsights | null {
  if (!isObject(raw) || !isObject(raw.ai_suggested) || !isObject(raw.crm) || !isObject(raw.revenue)) return null;
  const a = raw.ai_suggested; const c = raw.crm; const v = raw.revenue;
  return {
    ai_suggested: { converted: num(a.converted) ?? 0, not_converted: num(a.not_converted) ?? 0, follow_up: num(a.follow_up) ?? 0, unknown: num(a.unknown) ?? 0 },
    crm: { linked: num(c.linked) ?? 0, confirmed_purchases: num(c.confirmed_purchases) ?? 0, pending_confirmation: num(c.pending_confirmation) ?? 0,
      no_purchase_yet: num(c.no_purchase_yet) ?? 0, no_purchase_in_window: num(c.no_purchase_in_window) ?? 0, credited_elsewhere: num(c.credited_elsewhere) ?? 0,
      ai_converted_confirmed: num(c.ai_converted_confirmed) ?? 0, ai_converted_not_confirmed: num(c.ai_converted_not_confirmed) ?? 0 },
    revenue: { verified: num(v.verified), verified_note: str(v.verified_note) ?? "", estimated: num(v.estimated), ticket_inr: num(v.ticket_inr), formula: str(v.formula) ?? "" },
    window_days: num(raw.window_days) ?? 30,
  };
}

/** Mirrors recording_crm_insights: each CRM purchase visit once × the configured ticket; no ticket, no estimate. */
export function estimatedRevenue(confirmedPurchaseVisits: number, ticketInr: number | null): number | null {
  if (ticketInr === null || !(ticketInr > 0) || !Number.isInteger(confirmedPurchaseVisits) || confirmedPurchaseVisits < 0) return null;
  return Math.round(confirmedPurchaseVisits * ticketInr * 100) / 100;
}
