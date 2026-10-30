import type { UserRole } from "../roleMenu.ts";
import type { FmsAssignmentConfig, FmsTaskDisplay, FmsFollowUp } from "./workContracts.ts";

export const FMS_STAGE_TYPES = ["task", "approval", "form", "notification", "branch", "parallel_start", "parallel_join", "end"] as const;
/**
 * Stage types an author may add. `end` is an explicit End Node (0358): reaching it
 * closes the whole workflow automatically with a classified business outcome. A
 * step without an outgoing route still finishes its path implicitly, as before.
 */
export const FMS_AUTHORING_STAGE_TYPES = ["form", "task", "approval", "branch", "parallel_start", "parallel_join", "notification", "end"] as const;
/** Stable outcome codes of an End Node. Labels are display only and may be renamed. */
export const FMS_TERMINAL_OUTCOMES = ["won", "lost", "do_not_contact", "other"] as const;
export type FmsTerminalOutcome = typeof FMS_TERMINAL_OUTCOMES[number];
/** An instance that finished without an End Node (legacy or implicit completion). */
export type FmsRecordedOutcome = FmsTerminalOutcome | "unspecified";
/** End Node settings. `reasonCode` is an optional stable business reason such as `price_too_high`. */
export type FmsTerminalConfig = Readonly<{ outcome: FmsTerminalOutcome; reasonCode?: string | undefined }>;
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
export type FmsTimingMethod = "completion_date" | "tat_hours" | "days_before_date" | "specific_time";
export type FmsDecisionMode = "normal" | "yes_no" | "decision";
export type FmsDecisionOption = Readonly<{ key: string; label: string }>;
/** A conditional step activates only for one configured option of an earlier Decision Step. */
export type FmsConditionalRule = Readonly<{ decisionStageKey: string; outcome: string } | { decisionStageKey: string; decisionOptionKey: string }>;
/**
 * `stage`: the Form family was created for this stage, so an edit publishes the
 * next version of the same family. `copied`: the stage was pasted or imported
 * from another workflow, so the first edit makes this stage its own copy and
 * two workflows never share one editable questionnaire. `draftFormId` is an
 * unpublished draft of the next version, kept so the work survives a reload.
 */
export type FmsStageQuestionnaire = Readonly<{ origin: "stage" | "copied"; draftFormId?: string | undefined }>;
export type FmsSlaRule = Readonly<{
  pipelineName?: string | undefined;
  assignment?: FmsAssignmentConfig | undefined;
  completionFormRequired?: boolean | undefined;
  taskDisplay?: FmsTaskDisplay | undefined;
  followUp?: FmsFollowUp | undefined;
  /** User question on this stage's linked Form that sets the default for later steps. */
  assignmentFieldKey?: string | undefined;
  /**
   * Stable key of the one Section of the linked Form this stage asks for. Absent
   * means the Entire Form (every workflow published before sections existed).
   * The server validates a stage submission against exactly this section.
   */
  formSectionKey?: string | undefined;
  /**
   * Authoring metadata for a questionnaire built inside the FMS builder. The
   * runtime never reads it: the stage still runs the exact published Form in
   * `formTemplateId`. Absent means the Form is linked from the Forms Library.
   */
  questionnaire?: FmsStageQuestionnaire | undefined;
  timingMethod?: FmsTimingMethod | undefined;
  deadlineEnabled?: boolean | undefined;
  dueDate: string;
  tatHours?: number | undefined;
  tatMinutes?: number | undefined;
  tatUnit?: "hours" | "minutes" | undefined;
  futureDate?: string | undefined;
  daysBefore?: number | undefined;
  clockTime?: string | undefined;
  triggerStageKey?: string | undefined;
  decisionMode?: FmsDecisionMode | undefined;
  decisionOptions?: readonly FmsDecisionOption[] | undefined;
  conditional?: FmsConditionalRule | undefined;
  /** End Nodes only: the terminal business outcome recorded when the workflow reaches this node. */
  terminal?: FmsTerminalConfig | undefined;
}>;
/**
 * An ordered outgoing route. `branch` stages have always used these rules; since
 * stage-level routing landed, any step may also carry them, and the runtime
 * evaluates them on completion before falling back to `defaultNextStageKey`.
 * A stage with no rules keeps the historical single-successor behaviour.
 */
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
  /** Editor-only canvas coordinates. Absent means "use the computed layout"; the runtime never reads this. */
  position?: Readonly<{ x: number; y: number }> | undefined;
  sla: FmsSlaRule;
}>;

export type FmsFlowDefinition = Readonly<{
  assignmentVersion?: 1 | 2 | undefined;
  id?: string | undefined;
  familyId?: string | undefined;
  version?: number | undefined;
  lifecycle?: FmsLifecycle | undefined;
  name: string;
  description?: string | undefined;
  scope: "tenant" | "branch" | "department";
  branchId?: string | undefined;
  departmentId?: string | undefined;
  moduleContext?: string | undefined;
  manualTrigger: true;
  stages: readonly FmsStageDefinition[];
}>;

/** A selectable answer of a linked form question: a stable `value` with a renameable `label`. */
export type FmsFormFieldOption = Readonly<{ value: string; label: string }>;
/**
 * A linked form question, reduced to what FMS route configuration and validation
 * need. `optionValues` stays the matched identity; `options` adds the labels the
 * builder and the canvas display, so a renamed option never changes a route.
 */
export type FmsFormFieldRef = Readonly<{ key: string; label: string; type?: string | undefined; required?: boolean | undefined; shown?: boolean | undefined; hasCondition?: boolean | undefined; optionValues?: readonly string[] | undefined; options?: readonly FmsFormFieldOption[] | undefined;
  /** Section the question belongs to. Absent when the Form defines no sections. */
  sectionKey?: string | undefined;
  /** Question keys its visibility condition reads, so a section that cannot resolve them is reported. */
  dependsOn?: readonly string[] | undefined }>;
/** A Section of a linked Form, in the Form's own order, for stage scoping. */
export type FmsFormSectionRef = Readonly<{ key: string; title: string; questionCount: number }>;
/** Optional Forms knowledge so route validation can catch a removed form, question, or option. */
export type FmsValidationContext = Readonly<{
  formFields?: Readonly<Record<string, readonly FmsFormFieldRef[]>> | undefined;
  /** Sections per Form version. Absent skips the section checks that need it. */
  formSections?: Readonly<Record<string, readonly FmsFormSectionRef[]>> | undefined;
  availableFormIds?: readonly string[] | undefined;
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
