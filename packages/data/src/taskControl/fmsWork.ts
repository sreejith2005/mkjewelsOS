import { getSupabase as db } from "@jewelos/api-client/client";
import type { TaskWorkKind } from "@jewelos/core";

/**
 * Task Control removes FMS work through the FMS contracts, never by deleting rows:
 * an FMS step cancels its whole run (cancel_fms_instance_with_audit, history and
 * completed stages preserved), a pending start form is cancelled on its own
 * assignment. Both RPCs authorize the actor and write the audit record.
 */
function auditReason(reason: string): string {
  const trimmed = reason.trim();
  if (!trimmed) throw new Error("Enter a reason so the cancellation can be audited.");
  return trimmed;
}

export async function cancelFmsRun(instanceId: string, reason: string): Promise<void> {
  const { error } = await db().rpc("cancel_fms_instance_with_audit", { p_instance_id: instanceId, p_reason: auditReason(reason) });
  if (error) throw new Error(`Cancel FMS run: ${error.message}`);
}

export async function cancelFmsStartForm(assignmentId: string, reason: string): Promise<void> {
  const { error } = await db().rpc("cancel_fms_starter_assignment_with_audit", { p_assignment_id: assignmentId, p_reason: auditReason(reason) });
  if (error) throw new Error(`Cancel start form: ${error.message}`);
}

export async function cancelTaskControlFmsWork(kind: Extract<TaskWorkKind, "fms_step" | "fms_start">, id: string, reason: string): Promise<void> {
  if (kind === "fms_start") return cancelFmsStartForm(id, reason);
  auditReason(reason);
  const stage = await db().from("fms_instance_stages").select("fms_instance_id").eq("id", id).maybeSingle();
  if (stage.error) throw new Error(`Cancel FMS run: ${stage.error.message}`);
  if (!stage.data) throw new Error("This FMS step is no longer available. Refresh and try again.");
  return cancelFmsRun(stage.data.fms_instance_id, reason);
}
