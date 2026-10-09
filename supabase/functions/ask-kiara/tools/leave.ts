import { addLocalDays, kiaraToday } from "../../../../packages/core/src/assistant/period.ts";
import {
  ACCESS_DENIED,
  type ExecutorContext,
  type SelectFilter,
  type ToolArgs,
  type ToolOutcome,
  argText,
  isOutcome,
  kiaraRangeOrNull,
  localDay,
  localTime,
  nameMap,
  num,
  selectByIds,
  selectRows,
  text,
} from "./shared.ts";

export const LEAVE_ROW_CAP = 25;

/**
 * Reason, HR remark, approval image paths, and handover details are never
 * selected: Kiara needs who is away and when, not why.
 */
export const LEAVE_COLUMNS = "applicant_id,leave_type,duration,leave_start,leave_end,work_start_date,status,total_leave_count,submitted_at";

/**
 * `get_leave` mirrors the Availability > Leave section:
 * - `mine`: `leave_requests` filtered to the caller (My leave);
 * - `office`: the office leave summary, `leave_requests` read as the caller
 *   with RLS `leave_requests_read` (0181): tenant-wide only with
 *   `availability.view_leave_summary` or `availability.review_leave`, exactly
 *   the users the section shows it to. Without either it is refused here
 *   before any read. Names come from `leave_summary_applicants`, the view the
 *   section uses, then from profiles the caller may read.
 */
export async function getLeave(context: ExecutorContext, args: ToolArgs): Promise<ToolOutcome> {
  const { actor, profileId, timeZone, now } = context;
  const scope = argText(args, "scope") === "office" ? "office" : "mine";
  if (scope === "office" && !context.hasPermission("availability.view_leave_summary") && !context.hasPermission("availability.review_leave")) {
    return ACCESS_DENIED;
  }
  const given = kiaraRangeOrNull(args, context, 366);
  if (isOutcome(given)) return given;
  // The office list defaults to the next 30 days; own requests to the latest ones.
  const today = kiaraToday(now, timeZone);
  const range = given ?? (scope === "office" ? { from: today, to: addLocalDays(today, 29) } : null);

  const filters: SelectFilter[] = [];
  if (scope === "mine") filters.push({ op: "eq", column: "applicant_id", value: profileId });
  const status = argText(args, "status");
  if (status) filters.push({ op: "eq", column: "status", value: status });
  if (range) {
    // Leave that overlaps the range.
    filters.push({ op: "lte", column: "leave_start", value: range.to });
    filters.push({ op: "gte", column: "leave_end", value: range.from });
  }
  const rows = await selectRows(actor, "leave_requests", {
    columns: LEAVE_COLUMNS,
    filters,
    order: [{ column: range ? "leave_start" : "submitted_at", ascending: Boolean(range) }],
    limit: LEAVE_ROW_CAP + 1,
  });
  if (isOutcome(rows)) return rows;
  const shown = rows.slice(0, LEAVE_ROW_CAP);

  let names = new Map<string, string>();
  if (scope === "office") {
    const ids = [...new Set(shown.flatMap((row) => (typeof row.applicant_id === "string" ? [row.applicant_id] : [])))];
    const summary = context.hasPermission("availability.view_leave_summary")
      ? await selectRows(actor, "leave_summary_applicants", { columns: "id,employee_name", filters: [{ op: "in", column: "id", values: ids }], limit: Math.max(ids.length, 1) })
      : [];
    if (isOutcome(summary)) return summary;
    names = nameMap(summary, "employee_name");
    const missing = ids.filter((id) => !names.has(id));
    if (missing.length > 0) {
      const profiles = await selectByIds(actor, "user_profiles", "id,employee_name", missing);
      if (isOutcome(profiles)) return profiles;
      for (const [id, name] of nameMap(profiles, "employee_name")) names.set(id, name);
    }
  }

  return {
    result: {
      scope,
      ...(range ? { period: { from: range.from, to: range.to }, matching: "leave that overlaps these dates" } : {}),
      ...(status ? { status } : {}),
      requests: shown.map((row) => ({
        ...(scope === "office" ? { employee: names.get(row.applicant_id as string) ?? (row.applicant_id === profileId ? "you" : "name not visible") } : {}),
        type: text(row.leave_type),
        duration: text(row.duration),
        from: localDay(row.leave_start),
        to: localDay(row.leave_end),
        back_at_work: localDay(row.work_start_date),
        days: num(row.total_leave_count),
        status: text(row.status),
        applied: localTime(row.submitted_at, timeZone),
      })),
      ...(rows.length > LEAVE_ROW_CAP ? { truncated: true } : {}),
    },
    isError: false,
  };
}
