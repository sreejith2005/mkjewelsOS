import type { ReportDefinition, ReportFilters } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseReportFilters(input: URLSearchParams | Readonly<Record<string, unknown>>, definition: ReportDefinition): ReportFilters {
  const get = (key: string): string | undefined => input instanceof URLSearchParams ? input.get(key) ?? undefined : typeof input[key] === "string" ? input[key] as string : undefined;
  const rawPage = Number(get("page") ?? 1);
  const rawSize = Number(get("page_size") ?? 25);
  if (!Number.isInteger(rawPage) || rawPage < 1) throw new Error("Invalid report page");
  if (![10,25,50,100].includes(rawSize)) throw new Error("Invalid report page size");
  const result: Record<string, string | number> = { page: rawPage, page_size: rawSize };
  for (const key of definition.filters) {
    if (key === "page" || key === "page_size") continue;
    const value = get(key);
    if (!value) continue;
    if ((key === "from" || key === "to") && !DATE.test(value)) throw new Error(`Invalid ${key} date`);
    if ((key === "branch_id" || key === "department_id" || key === "user_profile_id") && !UUID.test(value)) throw new Error(`Invalid ${key}`);
    if (key === "status" && !/^[a-z_]{1,40}$/.test(value)) throw new Error("Invalid report status");
    result[key] = value;
  }
  if (result.from && result.to) {
    const days = (Date.parse(`${result.to}T00:00:00Z`) - Date.parse(`${result.from}T00:00:00Z`)) / 86_400_000 + 1;
    if (days < 1 || days > definition.maxDateRangeDays) throw new Error(`Report range must be 1-${definition.maxDateRangeDays} days`);
  }
  return result as ReportFilters;
}

export function filtersToSearchParams(reportKey: string, filters: ReportFilters): URLSearchParams {
  const params = new URLSearchParams({ report: reportKey });
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") params.set(key, String(value));
  return params;
}
