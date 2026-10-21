import type { EvidenceWorkspace } from "../taskEvidence/types";
import type { JewelosClient } from "@jewelos/api-client/client";
import { canDeleteTaskControlRow, OPEN_FMS_WORK_STATUSES, taskControlScheduleMatchesBulkScope } from "@jewelos/core";
import { parseTaskTemplateDirectory } from "../taskTemplates/model";

/**
 * One deletable selection. Tasks-section rows have no kind; `template` is a recurring
 * schedule; `fms_step` cancels its FMS run (`fms_instance_id`) and `fms_start` cancels
 * one pending start form.
 */
export type TaskDeleteKind = "template" | "fms_step" | "fms_start";
export type TaskDeleteTarget = Readonly<{ id: string; task_template_id: string | null; kind?: TaskDeleteKind; fms_instance_id?: string }>;
export type TaskBulkDeleteResult = Readonly<{ succeeded: string[]; failed: Array<{ id: string; message: string; kind?: TaskDeleteKind }> }>;
export const isFmsDeleteTarget = (row: TaskDeleteTarget): boolean => row.kind === "fms_step" || row.kind === "fms_start";
type Filter = Record<string, string | number | undefined>;

export async function readTaskDeleteSchedules(client: JewelosClient, filter: Filter): Promise<TaskDeleteTarget[]> {
  const { data, error } = await client.rpc("get_task_template_directory", { p_filter: { search: typeof filter.search === "string" ? filter.search : "" } });
  if (error) throw new Error(error.message);
  return parseTaskTemplateDirectory(data).templates.filter((row) => taskControlScheduleMatchesBulkScope(row, filter))
    .map((row) => ({ id: row.id, task_template_id: row.id, kind: "template" }));
}

export function selectTaskBulkDeleteTargets(targets: readonly TaskDeleteTarget[], entireSeries: boolean): TaskDeleteTarget[] {
  return targets.filter((row) => row.kind !== "template" || entireSeries);
}

export async function readTaskDeleteTargets(client: JewelosClient, ids: readonly string[]): Promise<TaskDeleteTarget[]> {
  if (ids.length === 0) return [];
  if (ids.length > 100) throw new Error("Task selection read exceeds page size.");
  const { data, error } = await client.from("task_instances").select("id,task_template_id").in("id", [...ids]).neq("task_type", "fms");
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  const fms = await readFmsDeleteTargets(client, ids.filter((id) => !rows.some((row) => row.id === id)));
  const templateIds = [...new Set(rows.flatMap((row) => row.task_template_id ? [row.task_template_id] : []))];
  if (templateIds.length === 0) return [...rows, ...fms];
  // Soft-deleted schedules are hidden by RLS. Their remaining (completed) occurrences
  // have no series left to retire, so they are deleted as individual occurrences.
  const live = await client.from("task_templates").select("id").in("id", templateIds);
  if (live.error) throw new Error(live.error.message);
  const liveIds = new Set((live.data ?? []).map((row) => row.id));
  return [...rows.map((row) => row.task_template_id && !liveIds.has(row.task_template_id) ? { ...row, task_template_id: null } : row), ...fms];
}

/** Selected FMS rows: open runtime steps (with their run) and pending start forms. RLS applies. */
async function readFmsDeleteTargets(client: JewelosClient, ids: readonly string[]): Promise<TaskDeleteTarget[]> {
  if (ids.length === 0) return [];
  const stages = await client.from("fms_instance_stages").select("id,fms_instance_id,status").in("id", [...ids]);
  if (stages.error) throw new Error(stages.error.message);
  const steps: TaskDeleteTarget[] = (stages.data ?? []).filter((row) => OPEN_FMS_WORK_STATUSES.has(row.status))
    .map((row) => ({ id: row.id, task_template_id: null, kind: "fms_step", fms_instance_id: row.fms_instance_id }));
  const rest = ids.filter((id) => !(stages.data ?? []).some((row) => row.id === id));
  if (rest.length === 0) return steps;
  const starters = await client.from("fms_starter_assignments").select("id,status").in("id", rest);
  if (starters.error) throw new Error(starters.error.message);
  return [...steps, ...(starters.data ?? []).filter((row) => row.status === "pending").map((row): TaskDeleteTarget => ({ id: row.id, task_template_id: null, kind: "fms_start" }))];
}

/** Resolve a frozen, bounded-read selection before confirmation and before writes. */
export async function prepareTaskBulkDelete(
  filter: Filter, selected: readonly string[] | null,
  read: (filter: Filter) => Promise<EvidenceWorkspace>,
  readTargets: (ids: readonly string[]) => Promise<readonly TaskDeleteTarget[]>,
  readSchedules?: (filter: Filter) => Promise<readonly TaskDeleteTarget[]>,
): Promise<TaskDeleteTarget[]> {
  let ids = [...new Set(selected ?? [])];
  if (selected === null) {
    const seen = new Set<string>();
    let total = 0;
    for (let page = 1; page === 1 || (page - 1) * 100 < total; page++) {
      const next = await read({ ...filter, page, page_size: 100 });
      if (page === 1) total = next.tasks_total;
      if (!Number.isSafeInteger(total) || total < 0 || next.tasks_total !== total
        || next.tasks.length !== Math.min(100, total - (page - 1) * 100)) throw new Error("Tasks changed while preparing deletion. Refresh and try again.");
      for (const row of next.tasks) {
        if (seen.has(row.task_id)) throw new Error("Tasks changed while preparing deletion. Refresh and try again.");
        seen.add(row.task_id);
        if (canDeleteTaskControlRow(row)) ids.push(row.task_id);
      }
    }
  }
  const targets: TaskDeleteTarget[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const chunk = ids.slice(offset, offset + 100);
    const rows = await readTargets(chunk);
    if (rows.length !== chunk.length || new Set(rows.map((row) => row.id)).size !== chunk.length
      || rows.some((row) => !chunk.includes(row.id))) throw new Error("Some selected tasks are no longer available. Refresh and try again.");
    targets.push(...rows);
  }
  if (selected === null && readSchedules) {
    const represented = new Set(targets.flatMap((row) => row.task_template_id ? [row.task_template_id] : []));
    for (const schedule of await readSchedules(filter)) {
      if (schedule.task_template_id && !represented.has(schedule.task_template_id)) {
        targets.push(schedule); represented.add(schedule.task_template_id);
      }
    }
  }
  return targets;
}

/** Each existing RPC authorizes and audits its own transaction. Stop queuing on failure. */
export async function executeTaskBulkDelete(
  targets: readonly TaskDeleteTarget[], entireSeries: boolean, reason: string,
  remove: (id: string, entireSeries: boolean, reason: string) => Promise<void>,
  onProgress: (processed: number, total: number) => void,
  removeTemplate?: (id: string) => Promise<unknown>,
  cancelFms?: (target: TaskDeleteTarget, reason: string) => Promise<void>,
): Promise<TaskBulkDeleteResult> {
  const groups = new Map<string, TaskDeleteTarget[]>();
  for (const target of selectTaskBulkDeleteTargets(targets, entireSeries)) {
    // Several selected steps of one FMS run cancel that run once.
    const key = target.kind === "fms_step" && target.fms_instance_id ? `fms:${target.fms_instance_id}`
      : entireSeries && target.task_template_id ? `series:${target.task_template_id}` : `task:${target.id}`;
    const group = groups.get(key) ?? [];
    if (!group.some((row) => row.id === target.id)) group.push(target);
    groups.set(key, group);
  }
  const queue = [...groups.values()];
  const result: TaskBulkDeleteResult = { succeeded: [], failed: [] };
  let cursor = 0, processed = 0, stopped = false;
  const worker = async () => {
    while (!stopped && cursor < queue.length) {
      const group = queue[cursor++];
      const target = group?.[0];
      if (!group || !target) continue;
      try {
        if (target.kind === "template") {
          if (!removeTemplate) throw new Error("Schedule deletion is unavailable.");
          await removeTemplate(target.id);
        } else if (isFmsDeleteTarget(target)) {
          if (!cancelFms) throw new Error("FMS cancellation is unavailable.");
          await cancelFms(target, reason);
        } else await remove(target.id, entireSeries && target.task_template_id !== null, reason);
        result.succeeded.push(...group.map((row) => row.id));
      } catch (caught) {
        stopped = true;
        const message = caught instanceof Error ? caught.message : "Task deletion failed";
        result.failed.push(...group.map((row) => ({ id: row.id, message, ...(row.kind ? { kind: row.kind } : {}) })));
      }
      processed += group.length;
      onProgress(processed, targets.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
  for (const group of queue.slice(cursor)) result.failed.push(...group.map((row) => ({ id: row.id, ...(row.kind ? { kind: row.kind } : {}), message: "Not attempted after an earlier failure. Retry the remaining selection." })));
  return result;
}
