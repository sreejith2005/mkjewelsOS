import type { EvidenceWorkspace } from "../taskEvidence/types";
import type { JewelosClient } from "@jewelos/api-client/client";

export type TaskDeleteTarget = Readonly<{ id: string; task_template_id: string | null }>;
export type TaskBulkDeleteResult = Readonly<{ succeeded: string[]; failed: Array<{ id: string; message: string }> }>;
type Filter = Record<string, string | number | undefined>;

export async function readTaskDeleteTargets(client: JewelosClient, ids: readonly string[]): Promise<TaskDeleteTarget[]> {
  if (ids.length === 0) return [];
  if (ids.length > 100) throw new Error("Task selection read exceeds page size.");
  const { data, error } = await client.from("task_instances").select("id,task_template_id").in("id", [...ids]).neq("task_type", "fms");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Resolve a frozen, bounded-read selection before confirmation and before writes. */
export async function prepareTaskBulkDelete(
  filter: Filter, selected: readonly string[] | null,
  read: (filter: Filter) => Promise<EvidenceWorkspace>,
  readTargets: (ids: readonly string[]) => Promise<readonly TaskDeleteTarget[]>,
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
        if (row.task_type !== "fms") ids.push(row.task_id);
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
  return targets;
}

/** Each existing RPC authorizes and audits its own transaction. Stop queuing on failure. */
export async function executeTaskBulkDelete(
  targets: readonly TaskDeleteTarget[], entireSeries: boolean, reason: string,
  remove: (id: string, entireSeries: boolean, reason: string) => Promise<void>,
  onProgress: (processed: number, total: number) => void,
): Promise<TaskBulkDeleteResult> {
  const groups = new Map<string, TaskDeleteTarget[]>();
  for (const target of targets) {
    const key = entireSeries && target.task_template_id ? `series:${target.task_template_id}` : `task:${target.id}`;
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
        await remove(target.id, entireSeries && target.task_template_id !== null, reason);
        result.succeeded.push(...group.map((row) => row.id));
      } catch (caught) {
        stopped = true;
        const message = caught instanceof Error ? caught.message : "Task deletion failed";
        result.failed.push(...group.map((row) => ({ id: row.id, message })));
      }
      processed += group.length;
      onProgress(processed, targets.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, worker));
  for (const group of queue.slice(cursor)) result.failed.push(...group.map((row) => ({ id: row.id, message: "Not attempted after an earlier failure. Retry the remaining selection." })));
  return result;
}
