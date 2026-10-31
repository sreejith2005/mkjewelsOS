import type { FormAnswers } from "../forms/types.ts";
import type { FmsAssignedWorkTarget } from "./assignedWork.ts";
import type { FmsAssigneeRule } from "./types.ts";

export const FMS_ASSIGNMENT_MODES = ["previous_form", "fixed_employee", "hierarchy", "previous_stage_employee", "manual_handoff", "configured_fallback"] as const;
export type FmsAssignmentMode = typeof FMS_ASSIGNMENT_MODES[number];
export type FmsAssignmentSource = Readonly<{ sourceStageKey: string; formTemplateId: string; fieldKey: string; routeRuleId?: string | undefined }>;
export type FmsAssignmentConfig = Readonly<{ mode: FmsAssignmentMode; sources: readonly FmsAssignmentSource[]; allowHandoff: boolean; fallbackRule?: FmsAssigneeRule | undefined; followFormAssignee?: boolean | undefined }>;
export type FmsTaskDisplay = Readonly<{
  recordNaming?: Readonly<{ mode: "automatic" | "form_default" | "field"; source?: FmsAssignmentSource | undefined }> | undefined;
  titleTemplate?: string | undefined; shortDescription?: string | undefined; instructions?: string | undefined;
  expectedResult?: string | undefined; dueLabel?: string | undefined; referenceField?: FmsAssignmentSource | undefined;
  fields: readonly Readonly<FmsAssignmentSource & { priority?: boolean | undefined }>[];
}>;
export type FmsFollowUpSchedule = Readonly<{
  delay?: number | undefined; unit?: "days" | "hours" | undefined; time?: string | undefined;
  sourceStageKey?: string | undefined; dateFieldKey?: string | undefined; timeFieldKey?: string | undefined;
  workingDaysOnly?: boolean | undefined;
}>;
export type FmsFollowUp = Readonly<{ maxVisits: number; onLimit: "hold" | "escalate"; schedule?: FmsFollowUpSchedule | undefined }>;
export function validFmsFollowUpSchedule(schedule: FmsFollowUpSchedule): boolean {
  return Number.isInteger(schedule.delay ?? 1) && (schedule.delay ?? 1) >= 0 && (schedule.delay ?? 1) <= 3650
    && ["days", "hours"].includes(schedule.unit ?? "days")
    && /^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time ?? "11:00")
    && (schedule.workingDaysOnly === undefined || typeof schedule.workingDaysOnly === "boolean");
}
/** Preview/simulation of the server's existing stage activation deadline. */
export function fmsFollowUpDateTime(schedule: FmsFollowUpSchedule, answers: FormAnswers, now = new Date()): string {
  if (!validFmsFollowUpSchedule(schedule)) throw new Error("Invalid follow-up schedule");
  const dateAnswer = schedule.dateFieldKey ? answers[schedule.dateFieldKey] : undefined;
  const timeAnswer = schedule.timeFieldKey ? answers[schedule.timeFieldKey] : undefined;
  const requested = typeof dateAnswer === "string" && dateAnswer !== "";
  const requestedTime = typeof timeAnswer === "string" && timeAnswer !== "";
  let local = new Date(now.getTime() + 330 * 60_000);
  if (requested) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateAnswer) || !Number.isFinite(Date.parse(dateAnswer)) || new Date(dateAnswer).toISOString().slice(0, 10) !== dateAnswer) throw new Error("Invalid requested follow-up date");
    local = new Date(`${dateAnswer}T00:00:00Z`);
  } else if ((schedule.unit ?? "days") === "days") local.setUTCDate(local.getUTCDate() + (schedule.delay ?? 1));
  else local = new Date(local.getTime() + (schedule.delay ?? 1) * 3_600_000);
  if (requestedTime || requested || (schedule.unit ?? "days") === "days") {
    const clock = requestedTime ? timeAnswer : schedule.time ?? "11:00";
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock)) throw new Error("Invalid requested follow-up time");
    const [hour, minute] = clock.split(":").map(Number);
    local.setUTCHours(hour!, minute!, 0, 0);
  }
  if (!requested && schedule.workingDaysOnly) while ([0, 6].includes(local.getUTCDay())) local.setUTCDate(local.getUTCDate() + 1);
  return new Date(local.getTime() - 330 * 60_000).toISOString();
}
export type FmsHandoffChoice = Readonly<{ targetStageId: string; userProfileId: string }>;
export type FmsWorkState = "form_saved_pending_completion" | "awaiting_other_doers" | "awaiting_approval" | "successors_activated" | "workflow_completed" | "workflow_on_hold";
type StageCompletion = Readonly<{ instanceStageId: string; outcome: string; remark: string; checklist: Readonly<Record<string, boolean>>; nextAssigneeId?: string | undefined }>;
export type FmsTransitionRequest =
  | Readonly<StageCompletion & { kind: "stage_form"; formTemplateId: string; answers: FormAnswers }>
  | Readonly<StageCompletion & { kind: "complete" }>
  | Readonly<{ kind: "review"; instanceStageId: string; decision: "approved" | "rejected" | "revision_requested"; remark: string; nextAssigneeId?: string | undefined }>
  | Readonly<{ kind: "starter_form"; starterAssignmentId: string; formTemplateId: string; answers: FormAnswers }>
  | Readonly<{ kind: "flow_form"; flowId: string; formTemplateId: string; answers: FormAnswers }>;
export type FmsWorkDestination = Readonly<{
  targetStageId: string; stageName: string; formTemplateId: string | null;
  selectedUserId: string | null; effectiveUserId: string | null; employeeName: string | null;
  selectedEmployeeName?: string | null | undefined;
  assignmentMethod: string; locked: boolean; allowHandoff: boolean; issue: string | null;
}>;
/** The End Node a submission reaches (0358). It is never a destination to assign. */
export type FmsWorkTerminal = Readonly<{ stageName: string; outcome: "won" | "lost" | "do_not_contact" | "other" | "unspecified" }>;
export type FmsWorkPreview = Readonly<{ fingerprint: string; currentStageName: string; wouldDefer: boolean; requirements: readonly string[]; destinations: readonly FmsWorkDestination[]; terminal?: FmsWorkTerminal | null | undefined }>;
export type FmsHandoffDecision = Readonly<{ handoffs: readonly FmsHandoffChoice[]; preview: FmsWorkPreview }>;
export type FmsWorkResult = Readonly<{ state: FmsWorkState; submissionId: string | null; instanceId: string;
  workflowName?: string | undefined;
  sourceInstanceStageId: string | null; referenceNumber: string; destinations: readonly FmsWorkDestination[];
  ownWorkTargets: readonly FmsAssignedWorkTarget[]; terminal?: FmsWorkTerminal | null | undefined }>;
