import type { UserRole } from "../roleMenu";

export const FMS_STAGE_TYPES = ["task", "approval", "form", "notification", "branch", "parallel_start", "parallel_join", "end"] as const;
export const FMS_ASSIGNEE_TYPES = ["specific_user", "role", "manager", "department_head", "previous_step_doer", "reporter"] as const;
export const FMS_BRANCH_OPERATORS = ["equals", "not_equals", "contains", "greater_than", "greater_than_or_equal", "less_than", "less_than_or_equal", "in", "not_empty", "default"] as const;

export type FmsStageType = typeof FMS_STAGE_TYPES[number];
export type FmsAssigneeType = typeof FMS_ASSIGNEE_TYPES[number];
export type FmsBranchOperator = typeof FMS_BRANCH_OPERATORS[number];
export type FmsCompletionRule = "all_doers" | "any_doer" | "manager_approval";
export type FmsJoinRule = "all" | "any" | "specific";
export type FmsLifecycle = "draft" | "published" | "archived";
export type FmsInstanceStatus = "active" | "completed" | "cancelled" | "on_hold" | "overdue";
export type FmsStageStatus = "pending" | "in_progress" | "in_review" | "completed" | "rejected" | "blocked" | "overdue";

export type FmsAssigneeRule = Readonly<{
  type: FmsAssigneeType;
  userProfileId?: string | undefined;
  fallbackUserProfileId?: string | undefined;
  role?: UserRole | undefined;
  allowNextSelection?: boolean | undefined;
}>;

export type FmsChecklistItemDefinition = Readonly<{ key: string; label: string; required: boolean }>;
export type FmsSlaRule = Readonly<{ minutes: number; escalateAfterMinutes?: number | undefined; businessHoursOnly?: boolean | undefined; excludeWeekOffs?: boolean | undefined }>;
export type FmsBranchRule = Readonly<{
  id: string;
  source: "outcome" | "context" | "form_answer";
  sourceKey?: string | undefined;
  operator: FmsBranchOperator;
  value?: unknown;
  nextStageKey?: string | undefined;
  nextFlowId?: string | undefined;
  order: number;
  label?: string | undefined;
}>;

export type FmsStageDefinition = Readonly<{
  key: string;
  name: string;
  method?: string | undefined;
  type: FmsStageType;
  order: number;
  required: boolean;
  completionRule: FmsCompletionRule;
  allowMultipleDoers: boolean;
  requiresUpload: boolean;
  requiresRemark: boolean;
  checklist: readonly FmsChecklistItemDefinition[];
  formTemplateId?: string | undefined;
  assigneeRules: readonly FmsAssigneeRule[];
  requiresNextDoerHandoff: boolean;
  canMoveBackward: boolean;
  canReject: boolean;
  canRequestRevision: boolean;
  canEscalate: boolean;
  defaultNextStageKey?: string | undefined;
  branchRules: readonly FmsBranchRule[];
  parallelTargetStageKeys: readonly string[];
  joinRule?: FmsJoinRule | undefined;
  joinRequiredStageKeys: readonly string[];
  splitToFlowId?: string | undefined;
  sla: FmsSlaRule;
}>;

export type FmsFlowDefinition = Readonly<{
  id?: string | undefined;
  familyId?: string | undefined;
  version?: number | undefined;
  lifecycle?: FmsLifecycle | undefined;
  name: string;
  description?: string | undefined;
  scope: "tenant" | "branch" | "department";
  branchId?: string | undefined;
  departmentId?: string | undefined;
  manualTrigger: true;
  stages: readonly FmsStageDefinition[];
}>;

export type FmsValidationIssue = Readonly<{ code: string; message: string; stageKey?: string | undefined }>;
export type FmsAssignmentCandidate = Readonly<{ id: string; tenantId: string; branchId: string | null; departmentId: string | null; role: UserRole; active: boolean; loginEnabled: boolean }>;

export type FmsStageActorState = Readonly<{ actorId: string; completed: boolean; outcome?: string | undefined }>;
export type FmsTransitionCapability = Readonly<{
  canComplete: boolean;
  canApprove: boolean;
  canReject: boolean;
  canRequestRevision: boolean;
  canReassign: boolean;
  canMoveBackward: boolean;
  canEscalate: boolean;
  reason?: string | undefined;
}>;
