import { effectiveTaskDeadline, isTaskFeedItemOverdue } from "../../../../packages/core/src/taskFeed.ts";
import { addLocalDays } from "../../../../packages/core/src/assistant/period.ts";
import {
  type ExecutorContext,
  type SelectFilter,
  type ToolArgs,
  type ToolOutcome,
  argInt,
  argText,
  containsPattern,
  dayStart,
  isOutcome,
  isUuid,
  kiaraRangeOrNull,
  localTime,
  selectByIds,
  selectRows,
  untrusted,
} from "./shared.ts";

/** Rows read from the feed scope before status and text filtering. */
export const TASK_SCOPE_CAP = 300;

/**
 * `search_my_tasks` mirrors the Tasks section's own feeds: My Tasks / Delegated
 * (tasks the caller is a doer on or created) and Watching (tasks the caller
 * watches), read from `v_task_feed_scope` and `task_instances` as the caller.
 * Task RLS is tenant-wide for managers, so every read here is filtered to the
 * caller's own participation; team questions go through get_team_progress and
 * run_report instead (spec 3.2). FMS stages are left to get_fms_work.
 * "Overdue" is the Tasks screen's own rule (`isTaskFeedItemOverdue`).
 */
export async function searchMyTasks(context: ExecutorContext, args: ToolArgs): Promise<ToolOutcome> {
  const { actor, profileId, timeZone, now } = context;
  if (!isUuid(profileId)) return { result: { access: "denied" }, isError: false };
  const status = argText(args, "status") ?? "open";
  const limit = argInt(args, "limit", 10);
  const range = kiaraRangeOrNull(args, context);
  if (isOutcome(range)) return range;

  const watched = await selectRows(actor, "task_watchers", {
    columns: "task_instance_id",
    filters: [{ op: "eq", column: "user_profile_id", value: profileId }],
    limit: 500,
  });
  if (isOutcome(watched)) return watched;
  const watchedIds = new Set(watched.flatMap((row) => (isUuid(row.task_instance_id) ? [row.task_instance_id] : [])));

  const filters: SelectFilter[] = [{ op: "neq", column: "task_type", value: "fms" }];
  if (status === "completed") filters.push({ op: "eq", column: "status", value: "completed" });
  else if (status !== "all") filters.push({ op: "notIn", column: "status", values: ["completed", "rejected"] });
  if (status === "overdue") filters.push({ op: "lt", column: "effective_due_datetime", value: now.toISOString() });
  if (range) {
    filters.push({ op: "gte", column: "effective_due_datetime", value: dayStart(range.from, timeZone) });
    filters.push({ op: "lt", column: "effective_due_datetime", value: dayStart(addLocalDays(range.to, 1), timeZone) });
  }
  const order = [{ column: "effective_due_datetime", ascending: status === "open" || status === "overdue" }];

  // The three participations, each read under RLS and filtered to the caller.
  const scopes = await Promise.all([
    selectRows(actor, "v_task_feed_scope", { columns: "id,assignee_id,created_by", filters: [...filters, { op: "eq", column: "assignee_id", value: profileId }], order, limit: TASK_SCOPE_CAP }),
    selectRows(actor, "v_task_feed_scope", { columns: "id,assignee_id,created_by", filters: [...filters, { op: "eq", column: "created_by", value: profileId }], order, limit: TASK_SCOPE_CAP }),
    watchedIds.size > 0
      ? selectRows(actor, "v_task_feed_scope", { columns: "id,assignee_id,created_by", filters: [...filters, { op: "in", column: "id", values: [...watchedIds].slice(0, TASK_SCOPE_CAP) }], order, limit: TASK_SCOPE_CAP })
      : Promise.resolve([] as Record<string, unknown>[]),
  ]);
  const roles = new Map<string, Set<string>>();
  let scopeCapped = false;
  for (const [index, rows] of scopes.entries()) {
    if (isOutcome(rows)) return rows;
    if (rows.length >= TASK_SCOPE_CAP) scopeCapped = true;
    for (const row of rows) {
      if (!isUuid(row.id)) continue;
      const set = roles.get(row.id) ?? new Set<string>();
      if (index === 0 && row.assignee_id === profileId) set.add("assigned to you");
      if (index === 1 && row.created_by === profileId) set.add("created by you");
      if (index === 2) set.add("you watch it");
      if (set.size > 0) roles.set(row.id, set);
    }
  }

  const details = await selectByIds(actor, "task_instances", "id,title,task_type,priority,status,planned_datetime,revised_datetime,due_datetime,actual_datetime", [...roles.keys()]);
  if (isOutcome(details)) return details;
  const needle = argText(args, "text")?.toLocaleLowerCase() ?? null;

  const matches = details
    .filter((task) => typeof task.id === "string" && roles.has(task.id))
    .map((task) => {
      const feed = {
        id: task.id as string,
        assignee_id: null,
        status: typeof task.status === "string" ? task.status : null,
        planned_datetime: typeof task.planned_datetime === "string" ? task.planned_datetime : null,
        revised_datetime: typeof task.revised_datetime === "string" ? task.revised_datetime : null,
        due_datetime: typeof task.due_datetime === "string" ? task.due_datetime : null,
        actual_datetime: typeof task.actual_datetime === "string" ? task.actual_datetime : null,
      };
      return { task, deadline: effectiveTaskDeadline(feed), overdue: isTaskFeedItemOverdue(feed, now) };
    })
    .filter(({ overdue }) => status !== "overdue" || overdue)
    .filter(({ task }) => !needle || (typeof task.title === "string" && task.title.toLocaleLowerCase().includes(needle)))
    .sort((left, right) => {
      const a = left.deadline ? Date.parse(left.deadline) : 0;
      const b = right.deadline ? Date.parse(right.deadline) : 0;
      return status === "completed" || status === "all" ? b - a : a - b;
    });

  const tasks = matches.slice(0, limit).map(({ task, deadline, overdue }) => ({
    title: untrusted(task.title),
    type: task.task_type ?? null,
    priority: task.priority ?? null,
    status: task.status ?? null,
    due: localTime(deadline, timeZone),
    overdue,
    completed_at: localTime(task.actual_datetime, timeZone),
    your_part: [...(roles.get(task.id as string) ?? [])],
  }));
  return {
    result: {
      filter: { status, ...(range ? { from: range.from, to: range.to } : {}), ...(needle ? { text: argText(args, "text") } : {}) },
      total_found: matches.length,
      tasks,
      ...(matches.length > tasks.length || scopeCapped ? { truncated: true } : {}),
      note: "Only the user's own tasks (assigned, created, or watched). FMS stages are not included.",
    },
    isError: false,
  };
}
