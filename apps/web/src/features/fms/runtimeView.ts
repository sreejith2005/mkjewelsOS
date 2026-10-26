import type { FmsData, FmsInstance, FmsInstanceStage, FmsStageRow } from "./api";

export function eligibleFmsUsers(users: FmsData["users"], instance: Pick<FmsInstance, "branch_id" | "department_id">) {
  void instance;
  return users.filter((user) => user.working_status === "active" && user.account_status !== "inactive" && user.account_status !== "suspended" && user.is_login_enabled);
}

export function priorFmsDefinitions(definitions: FmsStageRow[], instanceStages: FmsInstanceStage[], flowId: string, current: FmsStageRow) {
  return definitions.filter((item) => item.fms_flow_id === flowId && item.sort_order < current.sort_order && instanceStages.some((runtime) => runtime.fms_stage_id === item.id));
}

export function isInitialFmsDefinition(definitions: FmsStageRow[], current: FmsStageRow) {
  return definitions
    .filter((item) => item.fms_flow_id === current.fms_flow_id)
    .sort((left, right) => left.sort_order - right.sort_order || left.id.localeCompare(right.id))[0]?.id === current.id;
}

export function shouldOpenInitialFmsForm(definitions: FmsStageRow[], current: FmsStageRow, runtime: Pick<FmsInstanceStage, "status" | "form_submission_id">) {
  return isInitialFmsDefinition(definitions, current)
    && !!current.form_template_id
    && !runtime.form_submission_id
    && ["pending", "in_progress", "in_review", "overdue"].includes(runtime.status);
}

export function shouldOpenFmsForm(definitions: FmsStageRow[], current: FmsStageRow, runtime: Pick<FmsInstanceStage, "status" | "form_submission_id">, requestedFormTemplateId?: string) {
  return !runtime.form_submission_id && !!current.form_template_id && ["pending", "in_progress", "in_review", "overdue"].includes(runtime.status)
    && (shouldOpenInitialFmsForm(definitions, current, runtime) || current.form_template_id === requestedFormTemplateId);
}

export function parseFmsContext(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Context must be a JSON object");
  if (Object.keys(parsed).length > 50) throw new Error("Context supports at most 50 keys");
  return parsed;
}
