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
export type FmsFollowUp = Readonly<{ maxVisits: number; onLimit: "hold" | "escalate" }>;
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
