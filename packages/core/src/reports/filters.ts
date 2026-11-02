import type { ReportDefinition, ReportFilters } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_KEYS = new Set(["branch_id", "department_id", "user_profile_id", "form_family_id", "flow_family_id", "crm_branch_id", "crm_employee_id", "client_id"]);
const TEXT_LIMITS: Readonly<Record<string, number>> = { search: 100, crm_name: 160, source: 120 };
export const WORK_KINDS = ["all", "task", "fms"] as const;
export const CUSTOMER_TYPES = ["lead", "client"] as const;
export const PURCHASE_CLASSES = ["Buyer", "Non-Buyer/Prospect", "Repair-only Customer", "Unknown"] as const;

export function parseReportFilters(input: URLSearchParams | Readonly<Record<string, unknown>>, definition: ReportDefinition): ReportFilters {
  const get = (key: string): string | undefined => input instanceof URLSearchParams ? input.get(key) ?? undefined : typeof input[key] === "string" ? input[key] as string : undefined;
  const rawPage = Number(get("page") ?? 1);
  const rawSize = Number(get("page_size") ?? 25);
  if (!Number.isInteger(rawPage) || rawPage < 1) throw new Error("Invalid report page");
  if (![10,25,50,100].includes(rawSize)) throw new Error("Invalid report page size");
  const result: Record<string, string | number> = { page: rawPage, page_size: rawSize };
  for (const key of definition.filters) {
    if (key === "page" || key === "page_size") continue;
    const value = get(key)?.trim();
    if (!value) continue;
    if ((key === "from" || key === "to") && !DATE.test(value)) throw new Error(`Invalid ${key} date`);
    if (UUID_KEYS.has(key) && !UUID.test(value)) throw new Error(`Invalid ${key}`);
    if (key === "status" && !/^[a-z_]{1,40}$/.test(value)) throw new Error("Invalid report status");
    if (key === "stage_key" && !/^[A-Za-z0-9_:-]{1,100}$/.test(value)) throw new Error("Invalid stage");
    if (key === "work_kind" && !(WORK_KINDS as readonly string[]).includes(value)) throw new Error("Invalid task type");
    if (key === "customer_type" && !(CUSTOMER_TYPES as readonly string[]).includes(value)) throw new Error("Invalid customer type");
    if (key === "purchase_class" && !(PURCHASE_CLASSES as readonly string[]).includes(value)) throw new Error("Invalid purchase status");
    if (TEXT_LIMITS[key] !== undefined && value.length > TEXT_LIMITS[key]!) throw new Error(`${key} is too long`);
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

/**
 * The server filter object for a JewelOS report. A chosen From/To is a custom range;
 * without "preset" the server used to read every range as today only.
 */
export function jewelosReportFilters(filters: ReportFilters): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(filters)) if (value !== undefined && value !== "") result[key] = value;
  if (result.from && result.to) result.preset = "custom";
  return result;
}

/** The CRM project's filter names (get_crm_business_report) for a CRM report. */
export function crmReportFilters(filters: ReportFilters): Record<string, string> {
  const map: Readonly<Record<string, string>> = { from: "from", to: "to", crm_branch_id: "branchId", crm_employee_id: "employeeId", crm_name: "crmName", source: "source", customer_type: "customerType", purchase_class: "purchaseClass", status: "status", search: "search", client_id: "clientId" };
  const result: Record<string, string> = {};
  for (const [key, name] of Object.entries(map)) {
    const value = filters[key as keyof ReportFilters];
    if (typeof value === "string" && value !== "") result[name] = value;
  }
  return result;
}
