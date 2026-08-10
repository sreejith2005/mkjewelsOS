import { calculateFmsDelay } from "@jewelos/core";
import type { FmsData, FmsInstance, FmsInstanceStage, FmsStageRow } from "./api";

export function eligibleFmsUsers(users: FmsData["users"], instance: Pick<FmsInstance, "branch_id" | "department_id">) {
  return users.filter((user) => user.working_status !== "inactive" && user.working_status !== "resigned" && user.is_login_enabled && (!instance.branch_id || user.branch_id === instance.branch_id) && (!instance.department_id || user.department_id === instance.department_id));
}

export function priorFmsDefinitions(definitions: FmsStageRow[], instanceStages: FmsInstanceStage[], flowId: string, current: FmsStageRow) {
  return definitions.filter((item) => item.fms_flow_id === flowId && item.sort_order < current.sort_order && instanceStages.some((runtime) => runtime.fms_stage_id === item.id));
}

export function filterFmsInstances(input: { instances: FmsInstance[]; stages: FmsInstanceStage[]; profileId: string; tab: "mine" | "started" | "branch"; query: string; status: string; priority: string; overdueOnly: boolean; now?: string }) {
  return input.instances.filter((instance) => {
    const stages = input.stages.filter((stage) => stage.fms_instance_id === instance.id);
    const mine = stages.some((stage) => stage.assigned_to?.includes(input.profileId));
    const inTab = input.tab === "mine" ? mine : input.tab === "started" ? instance.started_by === input.profileId : true;
    const late = stages.some((stage) => calculateFmsDelay(stage.planned_datetime, stage.actual_datetime, input.now).overdue);
    return inTab && `${instance.reference_number} ${instance.title}`.toLowerCase().includes(input.query.trim().toLowerCase()) && (input.status === "all" || instance.status === input.status) && (input.priority === "all" || instance.priority === input.priority) && (!input.overdueOnly || late);
  });
}

export function parseFmsContext(value: string) {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Context must be a JSON object");
  if (Object.keys(parsed).length > 50) throw new Error("Context supports at most 50 keys");
  return parsed;
}
