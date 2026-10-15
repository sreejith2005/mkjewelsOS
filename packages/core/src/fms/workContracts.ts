import type { FormAnswers } from "../forms/types";
import type { FmsAssignedWorkTarget } from "./assignedWork";
import type { FmsAssigneeRule } from "./types";

export const FMS_ASSIGNMENT_MODES = ["previous_form", "fixed_employee", "hierarchy", "previous_stage_employee", "manual_handoff", "configured_fallback"] as const;
export type FmsAssignmentMode = typeof FMS_ASSIGNMENT_MODES[number];
export type FmsAssignmentSource = Readonly<{ sourceStageKey: string; formTemplateId: string; fieldKey: string; routeRuleId?: string | undefined }>;
export type FmsAssignmentConfig = Readonly<{ mode: FmsAssignmentMode; sources: readonly FmsAssignmentSource[]; allowHandoff: boolean; fallbackRule?: FmsAssigneeRule | undefined }>;
export type FmsTaskDisplay = Readonly<{
  titleTemplate?: string | undefined; shortDescription?: string | undefined; instructions?: string | undefined;
  expectedResult?: string | undefined; dueLabel?: string | undefined; referenceField?: FmsAssignmentSource | undefined;
  fields: readonly Readonly<FmsAssignmentSource & { priority?: boolean | undefined }>[];
}>;
export type FmsFollowUp = Readonly<{ maxVisits: number; onLimit: "hold" | "escalate" }>;
export type FmsHandoffChoice = Readonly<{ targetStageId: string; userProfileId: string }>;
export type FmsWorkState = "form_saved_pending_completion" | "awaiting_other_doers" | "awaiting_approval" | "successors_activated" | "workflow_completed";
type StageCompletion = Readonly<{ instanceStageId: string; outcome: string; remark: string; checklist: Readonly<Record<string, boolean>>; nextAssigneeId?: string | undefined }>;
export type FmsTransitionRequest =
  | Readonly<StageCompletion & { kind: "stage_form"; formTemplateId: string; answers: FormAnswers }>
  | Readonly<StageCompletion & { kind: "complete" }>
  | Readonly<{ kind: "review"; instanceStageId: string; decision: "approved" | "rejected" | "revision_requested"; remark: string }>
  | Readonly<{ kind: "starter_form"; starterAssignmentId: string; formTemplateId: string; answers: FormAnswers }>
  | Readonly<{ kind: "flow_form"; flowId: string; formTemplateId: string; answers: FormAnswers }>;
export type FmsWorkDestination = Readonly<{
  targetStageId: string; stageName: string; formTemplateId: string | null;
  selectedUserId: string | null; effectiveUserId: string | null; employeeName: string | null;
  assignmentMethod: string; locked: boolean; allowHandoff: boolean; issue: string | null;
}>;
export type FmsWorkPreview = Readonly<{ fingerprint: string; currentStageName: string; wouldDefer: boolean; requirements: readonly string[]; destinations: readonly FmsWorkDestination[] }>;
export type FmsWorkResult = Readonly<{ state: FmsWorkState; submissionId: string | null; instanceId: string;
  sourceInstanceStageId: string | null; referenceNumber: string; destinations: readonly FmsWorkDestination[];
  ownWorkTargets: readonly FmsAssignedWorkTarget[] }>;
