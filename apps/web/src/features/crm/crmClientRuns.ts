// FMS runs started for a CRM client (JewelOS get_crm_client_fms_runs, migration 0378), shown on the
// CRM client profile. Read as the signed-in person: the RPC checks crm.view, the CRM module and
// per-run FMS visibility. The response is validated before CRM renders it.
import { supabase } from "@jewelos/api-client";
import type { CrmClientRun } from "@jewelos/crm-ui";

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const nullableText = (value: unknown): string | null => (typeof value === "string" ? value : null);

export function parseCrmClientRuns(data: unknown): CrmClientRun[] {
  if (!Array.isArray(data)) throw new Error("FMS workflows could not be read.");
  return data.filter(isObject).map((run) => ({
    instanceId: text(run.instanceId), referenceNumber: text(run.referenceNumber), title: text(run.title), status: text(run.status),
    workflowName: text(run.workflowName), sourceType: text(run.sourceType), crmCaseId: nullableText(run.crmCaseId), caseOpen: run.caseOpen === true,
    startedAt: nullableText(run.startedAt), completedAt: nullableText(run.completedAt),
    openSteps: (Array.isArray(run.openSteps) ? run.openSteps : []).filter(isObject).map((step) => ({
      instanceStageId: text(step.instanceStageId), stageName: text(step.stageName), status: text(step.status),
      visitNumber: typeof step.visitNumber === "number" ? step.visitNumber : 1, dueAt: nullableText(step.dueAt),
      assignees: (Array.isArray(step.assignees) ? step.assignees : []).filter((name): name is string => typeof name === "string"),
    })),
  })).filter((run) => run.instanceId !== "");
}

export async function loadCrmClientRuns(crmClientId: string): Promise<CrmClientRun[]> {
  const { data, error } = await supabase.rpc("get_crm_client_fms_runs", { p_crm_client_id: crmClientId });
  if (error) throw new Error(error.message);
  return parseCrmClientRuns(data);
}
