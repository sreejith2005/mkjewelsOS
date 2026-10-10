import { getSupabase as db } from "@jewelos/api-client/client";
import { KIARA_ESCALATION_REASONS, type KiaraEscalationReason } from "@jewelos/core";

/**
 * Human step-in (spec 5.4). The asker confirms Kiara's offer or withdraws it;
 * answerers (assistant.answer_escalations, within the approved hierarchy rule)
 * list, count, and answer. Every rule is enforced by the database RPCs.
 */

export type KiaraEscalationStatus = "open" | "answered" | "withdrawn";

export type KiaraEscalationItem = Readonly<{
  id: string;
  status: KiaraEscalationStatus;
  reason: KiaraEscalationReason;
  question: string;
  summary: string | null;
  created_at: string;
  asker_name: string;
  asker_designation: string | null;
  department: string | null;
  branch: string | null;
  answered_by: string | null;
  answered_at: string | null;
  answer: string | null;
  saved_document_id: string | null;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

type RpcError = { code?: string; message: string; details?: string | null } | null;

/** Turns the documented RPC failures into sentences for the screen. */
export function escalationErrorMessage(error: NonNullable<RpcError>): string {
  if (error.message === "kiara_escalation_already_answered") return `This question was already answered by ${error.details || "someone else"}.`;
  if (error.message === "kiara_escalation_withdrawn") return "The employee withdrew this question.";
  if (error.message === "kiara_escalation_exists") return "This question was already sent to a person.";
  if (error.code === "42501") return "You cannot do that for this question.";
  return error.message || "That did not work. Please try again.";
}

function unwrap(result: Readonly<{ data: unknown; error: RpcError }>): unknown {
  if (result.error) throw new Error(escalationErrorMessage(result.error));
  return result.data;
}

export function asEscalationItem(value: unknown): KiaraEscalationItem | null {
  if (!isRecord(value) || !str(value.id) || !str(value.question) || !str(value.created_at)) return null;
  const status = value.status === "answered" || value.status === "withdrawn" ? value.status : "open";
  const reason = (KIARA_ESCALATION_REASONS as readonly unknown[]).includes(value.reason) ? value.reason as KiaraEscalationReason : "no_kb_match";
  return {
    id: value.id as string,
    status,
    reason,
    question: value.question as string,
    summary: str(value.summary),
    created_at: value.created_at as string,
    asker_name: str(value.asker_name) ?? "A colleague",
    asker_designation: str(value.asker_designation),
    department: str(value.department),
    branch: str(value.branch),
    answered_by: str(value.answered_by),
    answered_at: str(value.answered_at),
    answer: str(value.answer),
    saved_document_id: str(value.saved_document_id),
  };
}

/** The asker confirms Kiara's offer on this answer. Never uses a daily question. */
export async function createKiaraEscalation(messageId: string): Promise<Readonly<{ escalationId: string; recipients: number }>> {
  const data = unwrap(await db().rpc("create_kiara_escalation", { p_message_id: messageId }));
  if (!isRecord(data) || !str(data.escalation_id)) throw new Error("The question could not be sent.");
  return { escalationId: data.escalation_id as string, recipients: typeof data.recipients_count === "number" ? data.recipients_count : 0 };
}

export async function withdrawMyKiaraEscalation(escalationId: string): Promise<void> {
  unwrap(await db().rpc("withdraw_my_kiara_escalation", { p_escalation_id: escalationId }));
}

export async function listKiaraEscalations(status: KiaraEscalationStatus | "all" = "open", limit = 50): Promise<KiaraEscalationItem[]> {
  const data = unwrap(await db().rpc("list_kiara_escalations", { p_status: status, p_limit: limit }));
  return (Array.isArray(data) ? data : []).flatMap((row) => {
    const item = asEscalationItem(row);
    return item ? [item] : [];
  });
}

/** Open questions the signed-in user may answer (0 without the permission). */
export async function getKiaraEscalationBadge(): Promise<number> {
  const data = unwrap(await db().rpc("get_kiara_escalation_badge"));
  return typeof data === "number" && Number.isFinite(data) ? data : 0;
}

export const KIARA_ANSWER_MAX_LENGTH = 4000;

export async function answerKiaraEscalation(input: Readonly<{ escalationId: string; answer: string; saveToKnowledgeBase: boolean; knowledgeTitle?: string | undefined }>): Promise<Readonly<{ savedDocumentId: string | null }>> {
  const data = unwrap(await db().rpc("answer_kiara_escalation_with_audit", {
    p_escalation_id: input.escalationId,
    p_answer: input.answer.trim().slice(0, KIARA_ANSWER_MAX_LENGTH),
    p_save_to_kb: input.saveToKnowledgeBase,
    // Null keeps the default title (generated types mark SQL args non-null).
    p_kb_title: (input.saveToKnowledgeBase && input.knowledgeTitle?.trim() ? input.knowledgeTitle.trim().slice(0, 200) : null) as string,
  }));
  return { savedDocumentId: isRecord(data) ? str(data.saved_document_id) : null };
}
