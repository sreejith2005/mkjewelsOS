/**
 * Customer Journey (2026-10-29): the existing `crm_client_activity` view already unions every
 * authoritative CRM source (leads, calls, store visits, follow-ups, contacts, edits and FMS
 * evidence). These groups only filter and label it; the underlying tables are unchanged.
 */
import type { Json } from "@/lib/supabase/database.types";

export const JOURNEY_GROUPS = {
  visits: { label: "Store visits", sources: ["client_timeline", "entry_queue"] },
  enquiries: { label: "Enquiries & leads", sources: ["leads", "lead_stage_history"] },
  calls: { label: "Calls & follow-ups", sources: ["lead_call_history", "not_bought_history", "referral_calling_history", "crm_contacts"] },
  fms: { label: "FMS work", sources: ["crm_customer_workflow_events"] },
  engagement: { label: "Engagement asks", sources: ["visit_forms"] },
  edits: { label: "Profile edits", sources: ["client_edit_log"] },
} as const;
export type JourneyGroup = keyof typeof JOURNEY_GROUPS;

export function journeyGroup(value: string | null | undefined): JourneyGroup | null {
  return value && Object.prototype.hasOwnProperty.call(JOURNEY_GROUPS, value) ? value as JourneyGroup : null;
}

export function journeySources(group: JourneyGroup | null): readonly string[] | null {
  return group ? JOURNEY_GROUPS[group].sources : null;
}

/** A readable title for one journey entry. Store visits keep their recorded event type. */
export function journeyTitle(kind: string | null, sourceTable: string | null, stageName: string | null): string {
  if (sourceTable === "crm_customer_workflow_events") return stageName ? `FMS · ${stageName}` : "FMS · Customer enquiry";
  if (sourceTable === "client_timeline") return `Store visit · ${(kind ?? "Visit").replaceAll("_", " ")}`;
  if (sourceTable === "entry_queue") return "Walk-in registered";
  if (kind === "LEAD_REGISTERED") return "Enquiry registered";
  if (kind === "LEAD_CALL") return "Lead call";
  if (kind === "LEAD_STAGE_CHANGED") return "Lead stage changed";
  if (kind === "FOLLOWUP") return "Not-bought follow-up";
  if (kind === "REFERRAL_FOLLOWUP") return "Referral follow-up";
  if (kind === "ENGAGEMENT_ASK") return "Engagement ask";
  if (kind === "PROFILE_EDIT") return "Profile edit";
  return (kind ?? "Activity").replaceAll("_", " ");
}

export type JourneyFmsAnswer = { key: string; label: string; value: Json; labels: string[] };
export type JourneyFmsDetails = { stageName: string | null; actorName: string | null; assigned: string; instanceId: string | null; instanceStageId: string | null; reference: string | null; answers: JourneyFmsAnswer[] };

function record(value: Json | undefined): { [key: string]: Json | undefined } | null { return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value) ? value : null; }
const text = (value: Json | undefined): string | null => typeof value === "string" && value.trim() ? value : null;

/** Reads the FMS evidence row of `crm_client_activity` ({workflow, answers}). Option labels win over raw tokens. */
export function journeyFmsDetails(details: Json | null): JourneyFmsDetails | null {
  const row = record(details); const workflow = record(row?.workflow);
  if (!row || !workflow) return null;
  const assigned = Array.isArray(workflow.assignedEmployees) ? workflow.assignedEmployees.map(item => text(record(item)?.name)).filter((name): name is string => name !== null).join(", ") : "";
  const answers = Array.isArray(row.answers) ? row.answers.map(raw => {
    const answer = record(raw) ?? {};
    return { key: text(answer.fieldKey) ?? "", label: text(answer.label) ?? "Saved answer", value: answer.original ?? null,
      labels: Array.isArray(answer.optionLabels) ? answer.optionLabels.filter((v): v is string => typeof v === "string") : [] };
  }) : [];
  return { stageName: text(workflow.stageName), actorName: text(workflow.actorName), assigned, instanceId: text(workflow.instanceId),
    instanceStageId: text(workflow.instanceStageId), reference: text(workflow.referenceNumber), answers };
}
