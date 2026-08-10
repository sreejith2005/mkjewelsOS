export const LANDING_PAGES = ["home", "dashboard"] as const;
export const DASHBOARD_RANGES = ["today", "this_week", "this_month", "last_7_days", "last_30_days"] as const;
export const TABLE_DENSITIES = ["comfortable", "compact"] as const;
export const TIMEZONE_DISPLAYS = ["tenant", "device"] as const;

export type UserPreferences = Readonly<{
  default_landing_page: (typeof LANDING_PAGES)[number];
  dashboard_range: (typeof DASHBOARD_RANGES)[number];
  table_density: (typeof TABLE_DENSITIES)[number];
  timezone_display: (typeof TIMEZONE_DISPLAYS)[number];
}>;

export const DEFAULT_USER_PREFERENCES: UserPreferences = { default_landing_page:"home",dashboard_range:"today",table_density:"comfortable",timezone_display:"tenant" };

function exactKeys(value: Readonly<Record<string, unknown>>, allowed: readonly string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new Error("Unknown settings key");
}

export function validateUserPreferences(input: unknown): UserPreferences {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Preferences must be an object");
  const value = input as Record<string, unknown>;
  exactKeys(value, ["default_landing_page","dashboard_range","table_density","timezone_display"]);
  const result = { ...DEFAULT_USER_PREFERENCES, ...value } as UserPreferences;
  if (!LANDING_PAGES.includes(result.default_landing_page)) throw new Error("Invalid default landing page");
  if (!DASHBOARD_RANGES.includes(result.dashboard_range)) throw new Error("Invalid dashboard range");
  if (!TABLE_DENSITIES.includes(result.table_density)) throw new Error("Invalid table density");
  if (!TIMEZONE_DISPLAYS.includes(result.timezone_display)) throw new Error("Invalid timezone display");
  return result;
}

export type TenantSettings = Readonly<{ name: string; currency: string; timezone: string; export_retention_days: number; export_max_rows: number }>;
export function validateTenantSettings(input: unknown): TenantSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Tenant settings must be an object");
  const value = input as Record<string, unknown>;
  exactKeys(value,["name","currency","timezone","export_retention_days","export_max_rows"]);
  if (typeof value.name !== "string" || value.name.trim().length < 2 || value.name.trim().length > 120) throw new Error("Invalid tenant name");
  if (typeof value.currency !== "string" || !/^[A-Z]{3}$/.test(value.currency)) throw new Error("Invalid currency");
  if (typeof value.timezone !== "string" || value.timezone.length > 64) throw new Error("Invalid timezone");
  try { new Intl.DateTimeFormat("en", { timeZone: value.timezone }).format(); } catch { throw new Error("Invalid timezone"); }
  if (!Number.isInteger(value.export_retention_days) || (value.export_retention_days as number) < 1 || (value.export_retention_days as number) > 30) throw new Error("Export retention must be 1-30 days");
  if (!Number.isInteger(value.export_max_rows) || (value.export_max_rows as number) < 100 || (value.export_max_rows as number) > 100_000) throw new Error("Export row limit must be 100-100000");
  return { name:value.name.trim(),currency:value.currency,timezone:value.timezone,export_retention_days:value.export_retention_days as number,export_max_rows:value.export_max_rows as number };
}

export type BranchSettings = Readonly<{ report_default_department_id: string | null; export_max_rows: number | null }>;
export function validateBranchSettings(input: unknown): BranchSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Branch settings must be an object");
  const value=input as Record<string,unknown>;
  exactKeys(value,["report_default_department_id","export_max_rows"]);
  const department=value.report_default_department_id;
  if (department !== null && department !== undefined && (typeof department !== "string" || !/^[0-9a-f-]{36}$/i.test(department))) throw new Error("Invalid default department");
  const maxRows=value.export_max_rows;
  if (maxRows !== null && maxRows !== undefined && (!Number.isInteger(maxRows) || (maxRows as number)<100 || (maxRows as number)>50_000)) throw new Error("Invalid branch export row limit");
  return { report_default_department_id:department as string|null ?? null,export_max_rows:maxRows as number|null ?? null };
}
