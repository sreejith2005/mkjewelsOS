import {
  type ExecutorContext,
  type SelectFilter,
  type ToolArgs,
  type ToolOutcome,
  argInt,
  argText,
  isOutcome,
  localTime,
  nameMap,
  outcomeForError,
  records,
  selectByIds,
  selectRows,
  untrusted,
} from "./shared.ts";

const OPEN_STAGE_STATUSES = ["pending", "in_progress", "in_review", "blocked", "overdue"];

/**
 * `get_fms_work` mirrors the FMS work the caller is assigned, as the Tasks feed
 * and FMS section show it: stages whose `assigned_to` holds the caller (the
 * same rule `v_task_feed_scope` uses), read as the caller under
 * `can_read_fms_instance`, and pending starter forms from
 * `get_my_fms_starter_assignments`. Instances the caller can read but is not
 * assigned to (a manager's branch) are not listed: that is a team question.
 */
export async function getFmsWork(context: ExecutorContext, args: ToolArgs): Promise<ToolOutcome> {
  const { actor, profileId, timeZone } = context;
  const status = argText(args, "status") ?? "open";
  const limit = argInt(args, "limit", 10);

  const filters: SelectFilter[] = [{ op: "contains", column: "assigned_to", values: [profileId] }];
  if (status === "open") filters.push({ op: "in", column: "status", values: OPEN_STAGE_STATUSES });
  if (status === "completed") filters.push({ op: "eq", column: "status", value: "completed" });
  const [stages, starters] = await Promise.all([
    selectRows(actor, "fms_instance_stages", {
      columns: "fms_instance_id,fms_stage_id,status,planned_datetime,actual_datetime,sla_breached",
      filters,
      order: [{ column: status === "open" ? "planned_datetime" : "updated_at", ascending: status === "open" }],
      limit: limit + 1,
    }),
    status === "completed" ? Promise.resolve({ data: [], error: null }) : actor.rpc("get_my_fms_starter_assignments"),
  ]);
  if (isOutcome(stages)) return stages;
  if (starters.error) return outcomeForError(starters.error);
  const shown = stages.slice(0, limit);

  const [instances, definitions] = await Promise.all([
    selectByIds(actor, "fms_instances", "id,title,reference_number,status", shown.map((row) => row.fms_instance_id as string)),
    selectByIds(actor, "fms_stages", "id,name", shown.map((row) => row.fms_stage_id as string)),
  ]);
  if (isOutcome(instances)) return instances;
  if (isOutcome(definitions)) return definitions;
  const instanceById = new Map(instances.map((row) => [row.id as string, row]));
  const stageName = nameMap(definitions, "name");
  const starterRows = records(starters.data);

  return {
    result: {
      status,
      stages: shown.map((row) => {
        const instance = instanceById.get(row.fms_instance_id as string);
        return {
          workflow: untrusted(instance?.title),
          reference: typeof instance?.reference_number === "string" ? instance.reference_number : null,
          stage: untrusted(stageName.get(row.fms_stage_id as string)),
          status: row.status ?? null,
          planned: localTime(row.planned_datetime, timeZone),
          completed: localTime(row.actual_datetime, timeZone),
          sla_breached: row.sla_breached === true,
        };
      }),
      starter_forms: starterRows.slice(0, limit).map((starter) => ({
        workflow: untrusted(starter.flow_name),
        stage: untrusted(starter.stage_name),
        assigned: localTime(starter.assigned_at, timeZone),
      })),
      ...(stages.length > limit || starterRows.length > limit ? { truncated: true } : {}),
    },
    isError: false,
  };
}
