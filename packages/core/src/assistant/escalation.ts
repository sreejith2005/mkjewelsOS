/**
 * Human step-in (spec 5.4, 12 rule 6): when Kiara offers to pass a question to
 * a person. The model asks through the `offer_escalation` tool; the worker
 * decides here whether the offer is allowed, from facts about the turn that
 * the model cannot change. The database re-checks the stored offer when the
 * employee confirms it.
 */

export const KIARA_ESCALATION_REASONS = ["no_kb_match", "conflicting_policy", "needs_judgment"] as const;
export type KiaraEscalationReason = (typeof KIARA_ESCALATION_REASONS)[number];

export const KIARA_ESCALATION_SUMMARY_MAX = 300;

/** Stored on Kiara's answer (`kiara_messages.escalation_offer`) and sent to the client. */
export type KiaraEscalationOffer = Readonly<{ offer_id: string; reason: KiaraEscalationReason; summary_en: string }>;

export const KIARA_ESCALATION_REASON_LABELS: Readonly<Record<KiaraEscalationReason, string>> = {
  no_kb_match: "Not in the SOPs",
  conflicting_policy: "The SOPs disagree",
  needs_judgment: "Needs a manager's decision",
};

/** What the worker knows about the turn when the model asks to offer. */
export type KiaraEscalationTurnState = Readonly<{
  /** Knowledge searches run in this turn. */
  knowledgeSearches: number;
  /** A tool in this turn answered `access: denied`. */
  accessDenied: boolean;
  /** An offer was already accepted in this turn. */
  alreadyOffered: boolean;
}>;

export type KiaraEscalationDecision =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: "already_offered" | "access_denied" | "not_a_procedure_question" | "search_again"; message: string }>;

/**
 * The offer rules. Offers are only for company-procedure questions Kiara
 * looked up in the knowledge base and could not answer confidently, never as
 * a way around missing access (that would carry a manager-level question up
 * the step-in path) and never for requests to do something.
 */
export function decideEscalationOffer(reason: KiaraEscalationReason, state: KiaraEscalationTurnState): KiaraEscalationDecision {
  if (state.alreadyOffered) {
    return { ok: false, code: "already_offered", message: "The offer was already made for this question." };
  }
  if (state.accessDenied) {
    return { ok: false, code: "access_denied", message: "Not allowed: the user does not have access to that information. Tell them they do not have access in JewelOS. Do not offer a person." };
  }
  if (state.knowledgeSearches === 0) {
    return { ok: false, code: "not_a_procedure_question", message: "Not allowed: offers are only for company procedure or policy questions after searching the knowledge base. Answer the user without offering a person." };
  }
  if (reason === "no_kb_match" && state.knowledgeSearches < 2) {
    return { ok: false, code: "search_again", message: "Search the knowledge base once more with different words before offering a person." };
  }
  return { ok: true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A stored or streamed offer, or null when the value is not one. */
export function parseKiaraEscalationOffer(value: unknown): KiaraEscalationOffer | null {
  if (!isRecord(value) || typeof value.offer_id !== "string" || !UUID.test(value.offer_id)) return null;
  if (typeof value.reason !== "string" || !(KIARA_ESCALATION_REASONS as readonly string[]).includes(value.reason)) return null;
  const summary = typeof value.summary_en === "string" ? value.summary_en.slice(0, KIARA_ESCALATION_SUMMARY_MAX) : "";
  return { offer_id: value.offer_id, reason: value.reason as KiaraEscalationReason, summary_en: summary };
}
