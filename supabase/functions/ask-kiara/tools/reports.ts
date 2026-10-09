import { reportFor, reportsForRole } from "../../../../packages/core/src/reports/catalog.ts";
import { KIARA_REPORT_KEYS } from "../../../../packages/core/src/assistant/tools.ts";
import { kiaraRangeDays, resolveKiaraPeriod } from "../../../../packages/core/src/assistant/period.ts";
import {
  type ExecutorContext,
  type ToolArgs,
  type ToolOutcome,
  argInt,
  argText,
  invalidInput,
  isOutcome,
  isRecord,
  localDay,
  localTime,
  num,
  outcomeForError,
  rangeFor,
  records,
  untrusted,
} from "./shared.ts";

export const REPORT_PAGE_SIZE = 25;

/**
 * `list_reports` mirrors the Reports section's catalogue: `reportsForRole` with
 * the profile's base role, exactly as the Reports page builds its list (and as
 * `report_rows_for_profile` authorizes; spec 3.2 notes reports use the base
 * role, not dashboard authority).
 */
export function listReports(context: ExecutorContext): ToolOutcome {
  const reports = reportsForRole(context.baseRole)
    .filter((report) => KIARA_REPORT_KEYS.includes(report.key))
    .map((report) => ({ report_key: report.key, name: report.name, shows: report.description, max_days: report.maxDateRangeDays }));
  return { result: { reports, scope: "Reports cover the user's own work; managers see their branch; admins the company." }, isError: false };
}

/** Columns that are only ids; Kiara needs what the row says, not how to address it. */
const ID_COLUMNS = new Set(["task_id", "instance_id", "stage_id", "profile_id", "submission_id", "export_id"]);
/** Free text written by people. */
const UNTRUSTED_COLUMNS = new Set(["title", "flow_name", "stage_name", "form_name"]);
const DATETIME_COLUMNS = new Set(["planned_datetime", "actual_datetime", "submitted_at", "reviewed_at", "latest_attempt_at"]);

function trimRow(row: Record<string, unknown>, timeZone: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (ID_COLUMNS.has(key)) continue;
    if (UNTRUSTED_COLUMNS.has(key)) out[key] = untrusted(value);
    else if (DATETIME_COLUMNS.has(key)) out[key] = localTime(value, timeZone);
    else if (key === "date") out[key] = localDay(value);
    else out[key] = value;
  }
  return out;
}

/**
 * `run_report` mirrors the Reports section: `get_report_data`, the RPC the
 * Reports page calls, as the caller, one page of 25 rows. The RPC applies the
 * report's role rule, the branch clamp, the reports section gate, and the
 * report's maximum date range.
 */
export async function runReport(context: ExecutorContext, args: ToolArgs): Promise<ToolOutcome> {
  const key = argText(args, "report_key") ?? "";
  const definition = reportFor(key);
  if (!definition || !KIARA_REPORT_KEYS.includes(key)) return invalidInput("Unknown report.");
  const range = rangeFor(args, context, ({ now, timeZone }) => resolveKiaraPeriod("this_month", now, timeZone));
  if (isOutcome(range)) return range;
  if (kiaraRangeDays(range) > definition.maxDateRangeDays) return invalidInput(`${definition.name} covers at most ${definition.maxDateRangeDays} days. Use a shorter period.`);
  const page = argInt(args, "page", 1);
  const filters: Record<string, string | number> = { preset: "custom", from: range.from, to: range.to, page, page_size: REPORT_PAGE_SIZE };
  const status = argText(args, "status")?.toLowerCase();
  if (status) {
    if (!/^[a-z_]{1,40}$/.test(status)) return invalidInput("status must be a single word such as pending or completed.");
    filters.status = status;
  }
  const { data, error } = await context.actor.rpc("get_report_data", { p_report_key: key, p_filters: filters });
  if (error) return outcomeForError(error);
  if (!isRecord(data)) return { result: { error: "unavailable", message: "This information could not be loaded right now." }, isError: true };
  const rows = records(data.rows).map((row) => trimRow(row, context.timeZone));
  const total = num(data.total) ?? rows.length;
  return {
    result: {
      report: definition.name,
      period: { from: range.from, to: range.to },
      ...(status ? { status } : {}),
      page,
      rows,
      total_rows: total,
      ...(total > page * REPORT_PAGE_SIZE ? { truncated: true, more: "More rows exist on later pages (page up to 5) or in Reports." } : {}),
    },
    isError: false,
  };
}
