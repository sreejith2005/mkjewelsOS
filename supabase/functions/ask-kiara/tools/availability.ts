import { resolveKiaraPeriod } from "../../../../packages/core/src/assistant/period.ts";
import {
  type ExecutorContext,
  type ToolArgs,
  type ToolOutcome,
  argText,
  isOutcome,
  isRecord,
  localDay,
  num,
  rangeFor,
  records,
  resolveOne,
  selectRows,
  text,
} from "./shared.ts";

export const AVAILABILITY_MAX_DAYS = 31;
export const TEAM_AVAILABILITY_ROWS = 50;

/**
 * `get_availability` mirrors two sections:
 * - the user's own days: `user_availability` filtered to the caller (their own
 *   Availability calendar);
 * - other people: the Reports section's "People availability" report through
 *   `get_report_data`, which clamps managers to their branch and refuses roles
 *   without the PEOPLE report. Raw availability RLS is tenant-wide for managers
 *   and HR, so it is never read for other people (spec 3.2 and 8).
 */
export async function getAvailability(context: ExecutorContext, args: ToolArgs): Promise<ToolOutcome> {
  const { actor, profileId } = context;
  const range = rangeFor(args, context, ({ now, timeZone }) => resolveKiaraPeriod("today", now, timeZone), AVAILABILITY_MAX_DAYS);
  if (isOutcome(range)) return range;
  const department = await resolveOne(actor, "departments", argText(args, "department"));
  if (isOutcome(department)) return department;

  const own = await selectRows(actor, "user_availability", {
    columns: "date,status",
    filters: [
      { op: "eq", column: "user_profile_id", value: profileId },
      { op: "gte", column: "date", value: range.from },
      { op: "lte", column: "date", value: range.to },
    ],
    order: [{ column: "date", ascending: true }],
    limit: AVAILABILITY_MAX_DAYS,
  });
  if (isOutcome(own)) return own;

  const filters: Record<string, string | number> = { preset: "custom", from: range.from, to: range.to, page: 1, page_size: TEAM_AVAILABILITY_ROWS };
  if (department) filters.department_id = department.id;
  const team = await actor.rpc("get_report_data", { p_report_key: "people_availability", p_filters: filters });
  let others: Record<string, unknown>;
  if (team.error) {
    // 42501 is the report's own refusal (role or section): the user simply sees no team rows.
    if (team.error.code !== "42501") return { result: { error: "unavailable", message: "This information could not be loaded right now." }, isError: true };
    others = { access: "denied", message: "Other people's availability is not open to this user in JewelOS." };
  } else {
    const data = isRecord(team.data) ? team.data : {};
    const rows = records(data.rows).map((row) => ({
      name: text(row.employee_name),
      branch: text(row.branch_name),
      department: text(row.department_name),
      date: localDay(row.date),
      availability: text(row.availability_status) ?? "not recorded",
      working_status: text(row.working_status),
    }));
    const total = num(data.total) ?? rows.length;
    others = { people: rows, total_rows: total, ...(total > rows.length ? { truncated: true } : {}), source: "People availability report (branch scope for managers)." };
  }

  return {
    result: {
      period: { from: range.from, to: range.to },
      ...(department ? { department: department.name } : {}),
      your_days: own.map((row) => ({ date: localDay(row.date), status: text(row.status) })),
      your_days_note: "Days without a record are not recorded (usually a normal working day).",
      others,
    },
    isError: false,
  };
}
