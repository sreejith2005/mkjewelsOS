import { fmsStatusLabel } from "./engine";

export type FmsStageRequirementKey = "form" | "decision" | "checklist" | "evidence" | "remark" | "next_assignee";
export type FmsStageRequirement = Readonly<{ key: FmsStageRequirementKey; label: string; done: boolean }>;

export type FmsStageRequirementInput = Readonly<{
  formRequired: boolean; formSubmitted: boolean; formName?: string | null | undefined;
  decisionRequired: boolean; decisionChosen: boolean;
  requiredChecklistOpen: number; requiredChecklistTotal: number;
  evidenceRequired: boolean; evidenceCount: number;
  remarkRequired: boolean; remarkProvided: boolean;
  nextAssigneeRequired: boolean; nextAssigneeChosen: boolean;
}>;

/**
 * What an employee still has to do before completing a stage, in plain words.
 * Guidance only: the transition RPC remains the authority and rejects anything
 * incomplete, whatever this list shows.
 */
export function fmsStageCompletionChecklist(input: FmsStageRequirementInput): readonly FmsStageRequirement[] {
  const items: FmsStageRequirement[] = [];
  if (input.formRequired) items.push({ key: "form", label: input.formName ? `Fill and submit the form "${input.formName}"` : "Fill and submit the stage form", done: input.formSubmitted });
  if (input.requiredChecklistTotal > 0) items.push({ key: "checklist", label: input.requiredChecklistOpen > 0 ? `Tick the required checklist items (${input.requiredChecklistOpen} left)` : "Tick the required checklist items", done: input.requiredChecklistOpen === 0 });
  if (input.evidenceRequired) items.push({ key: "evidence", label: "Upload the evidence file (photo or PDF)", done: input.evidenceCount > 0 });
  if (input.decisionRequired) items.push({ key: "decision", label: "Choose a decision", done: input.decisionChosen });
  if (input.remarkRequired) items.push({ key: "remark", label: "Write a remark", done: input.remarkProvided });
  if (input.nextAssigneeRequired) items.push({ key: "next_assignee", label: "Choose who does the next step", done: input.nextAssigneeChosen });
  return items;
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  pending: "Not started", in_progress: "In progress", in_review: "Waiting for approval", overdue: "Overdue",
  completed: "Completed", approved: "Approved", rejected: "Rejected", skipped: "Skipped", cancelled: "Cancelled",
  waiting: "Waiting for earlier steps", on_hold: "On hold", active: "In progress", revision_requested: "Sent back for changes",
};

/** Employee wording for a stored FMS stage or workflow status; unknown codes fall back to the generic label. */
export function fmsEmployeeStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? (fmsStatusLabel(status).trim() || "Unknown");
}
