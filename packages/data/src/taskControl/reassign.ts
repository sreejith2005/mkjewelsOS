import { getSupabase as db } from "@jewelos/api-client/client";
import { batchReassignPlan, parseReassignCandidates, parseReassignResult, reassignPlanSize, type ReassignCandidates, type ReassignPlan, type ReassignResult } from "@jewelos/core";

/** Everyone whose work can be handed over, former employees included. */
export type ReassignSourcePerson = Readonly<{ id: string; label: string; former: boolean }>;

export async function loadReassignSources(): Promise<ReassignSourcePerson[]> {
  const { data, error } = await db().from("user_profiles")
    .select("id,employee_name,employee_code,account_status,working_status,removed_at")
    .order("employee_name");
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const former = row.removed_at !== null || row.account_status === "left" || row.working_status === "resigned";
    const label = row.removed_at !== null ? `Removed employee · ${row.employee_code}` : `${row.employee_name}${former ? " (left)" : ""}`;
    return { id: row.id, label, former };
  }).sort((a, b) => Number(a.former) - Number(b.former) || a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
}

export async function loadReassignCandidates(fromUserId: string): Promise<ReassignCandidates> {
  const { data, error } = await db().rpc("task_reassignment_candidates", { p_from_user_id: fromUserId });
  if (error) throw new Error(error.message);
  return parseReassignCandidates(data);
}

/**
 * Moves the plan in calls of at most 100 items. Items that cannot move are
 * collected, never fatal; a failed call stops the rest and is reported.
 */
export async function executeReassignPlan(
  fromUserId: string, toUserId: string, reason: string, plan: ReassignPlan,
  onProgress: (done: number, total: number) => void,
): Promise<ReassignResult & { error: string | null }> {
  const total = reassignPlanSize(plan);
  const moved: string[] = []; const skipped: ReassignResult["skipped"] = [];
  let done = 0;
  for (const batch of batchReassignPlan(plan)) {
    const { data, error } = await db().rpc("reassign_task_work_with_audit", {
      p_from_user_id: fromUserId, p_to_user_id: toUserId, p_reason: reason,
      p_task_ids: batch.taskIds, p_fms_stage_ids: batch.fmsStageIds, p_template_ids: batch.templateIds,
    });
    if (error) return { moved, skipped, error: error.message };
    const result = parseReassignResult(data);
    moved.push(...result.moved); skipped.push(...result.skipped);
    done += reassignPlanSize(batch);
    onProgress(done, total);
  }
  return { moved, skipped, error: null };
}
