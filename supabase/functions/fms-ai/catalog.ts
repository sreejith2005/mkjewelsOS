import { parseFormOptions } from "../../../packages/core/src/forms/options.ts";
import { FMS_AI_LIMITS } from "../../../packages/core/src/fms/aiContract.ts";
import type { FmsAiCatalog } from "../../../packages/core/src/fms/aiOperations.ts";
import type { FmsAiDirectory } from "../../../packages/core/src/fms/aiContext.ts";
import type { FmsDiagnosticCatalog } from "../../../packages/core/src/fms/diagnostics.ts";
import type { FmsFormFieldOption, FmsFormFieldRef } from "../../../packages/core/src/fms/types.ts";

export type RpcError = Readonly<{ code?: string | undefined; message: string }>;
export type SelectFilter = Readonly<{ column: string; op: "eq" | "in"; value: string | boolean | readonly string[] }>;
/**
 * The caller's database access: the anon key plus the caller's JWT, so RLS and
 * every RPC's own checks apply. This function never holds the service-role key.
 */
export interface FmsAiActor {
  rpc(fn: string, args?: Record<string, unknown>): Promise<Readonly<{ data: unknown; error: RpcError | null }>>;
  select(table: string, columns: string, filters: readonly SelectFilter[], limit: number, order?: Readonly<{ column: string; ascending: boolean }>): Promise<Readonly<{ data: readonly Record<string, unknown>[] | null; error: RpcError | null }>>;
}

export class CatalogError extends Error {}

const STRUCTURAL = new Set(["section_header", "divider"]);
const text = (value: unknown): string => typeof value === "string" ? value : "";

/** Today's date in the business timezone (availability is recorded per Kolkata day). */
export function kolkataDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/**
 * What the caller may see, bounded: published active Forms (plus the exact
 * versions the draft pins), their questions with stable keys and option values,
 * and the people/branch/department directory. No contact details are read.
 */
export async function loadFmsAiCatalog(actor: FmsAiActor, pinnedFormIds: readonly string[], now: Date): Promise<Readonly<{ catalog: FmsAiCatalog; diagnosticCatalog: FmsDiagnosticCatalog; directory: FmsAiDirectory }>> {
  const check = <T>(label: string, result: Readonly<{ data: T | null; error: RpcError | null }>): T => {
    if (result.error || result.data === null) throw new CatalogError(`${label}: ${result.error?.code ?? "no data"}`);
    return result.data;
  };
  const [published, users, branches, departments, availability] = await Promise.all([
    actor.select("form_templates", "id,name,version,family_id,lifecycle", [{ column: "lifecycle", op: "eq", value: "published" }, { column: "is_active", op: "eq", value: true }], 300, { column: "name", ascending: true }),
    actor.select("user_profiles", "id,employee_name,user_role,branch_id,department_id,working_status,account_status,is_login_enabled", [], 500, { column: "employee_name", ascending: true }),
    actor.select("branches", "id,name", [{ column: "is_active", op: "eq", value: true }], 100),
    actor.select("departments", "id,branch_id,name", [{ column: "is_active", op: "eq", value: true }], 300),
    actor.select("user_availability", "user_profile_id,status", [{ column: "date", op: "eq", value: kolkataDate(now) }], 1000),
  ]);
  const formRows = [...check("forms", published)];
  const missing = pinnedFormIds.filter((id) => !formRows.some((row) => row.id === id)).slice(0, 50);
  if (missing.length) formRows.push(...check("pinned forms", await actor.select("form_templates", "id,name,version,family_id,lifecycle", [{ column: "id", op: "in", value: missing }], 50)));
  const forms = formRows.map((row) => ({ id: text(row.id), name: text(row.name), version: Number(row.version) || 1, familyId: text(row.family_id), lifecycle: text(row.lifecycle) }));
  const formFields: Record<string, FmsFormFieldRef[]> = {};
  if (forms.length) {
    const rows = check("form questions", await actor.select("form_fields", "form_template_id,field_key,field_name,field_type,is_required,is_shown,conditional_logic,rule_definition,options,option_source,dropdown_master_type", [{ column: "form_template_id", op: "in", value: forms.map((form) => form.id) }], 5000, { column: "sort_order", ascending: true }));
    const masterTypes = [...new Set(rows.flatMap((row) => row.option_source === "dropdown_master" && typeof row.dropdown_master_type === "string" ? [row.dropdown_master_type] : []))];
    const masters = masterTypes.length ? check("dropdown options", await actor.select("dropdown_masters", "master_type,label,value", [{ column: "master_type", op: "in", value: masterTypes }, { column: "is_active", op: "eq", value: true }], 2000)) : [];
    for (const row of rows) {
      const type = text(row.field_type);
      if (STRUCTURAL.has(type)) continue;
      const formId = text(row.form_template_id);
      const options: FmsFormFieldOption[] = row.option_source === "dropdown_master"
        ? masters.filter((option) => option.master_type === row.dropdown_master_type).map((option) => ({ value: text(option.value), label: text(option.label) || text(option.value) }))
        : (parseFormOptions(row.options) ?? []).map((option) => ({ value: option.value, label: option.label || option.value }));
      const list = formFields[formId] ??= [];
      if (list.length >= FMS_AI_LIMITS.maxFieldsPerForm * 2) continue;
      list.push({ key: text(row.field_key), label: text(row.field_name) || text(row.field_key), type, required: row.is_required === true, shown: row.is_shown !== false, hasCondition: row.conditional_logic !== null || row.rule_definition !== null, ...(options.length ? { options: options.slice(0, FMS_AI_LIMITS.maxOptionsPerField * 2), optionValues: options.map((option) => option.value) } : {}) });
    }
  }
  const branchNames = new Map(check("branches", branches).map((row) => [text(row.id), text(row.name)]));
  const departmentRows = check("departments", departments);
  const departmentNames = new Map(departmentRows.map((row) => [text(row.id), text(row.name)]));
  const today = new Map(check("availability", availability).map((row) => [text(row.user_profile_id), text(row.status)]));
  const people = check("people", users).map((row) => ({
    id: text(row.id), name: text(row.employee_name), role: text(row.user_role),
    branch: branchNames.get(text(row.branch_id)) ?? null, department: departmentNames.get(text(row.department_id)) ?? null,
    active: row.working_status !== "inactive" && row.working_status !== "resigned" && row.account_status !== "inactive" && row.account_status !== "suspended",
    loginEnabled: row.is_login_enabled === true, availabilityToday: today.get(text(row.id)) ?? null,
  }));
  return {
    catalog: { forms, formFields, users: people.map(({ id, name, active, loginEnabled }) => ({ id, name, active, loginEnabled })) },
    diagnosticCatalog: { forms, formFields, users: people.map(({ id, name, active, loginEnabled, availabilityToday }) => ({ id, name, active, loginEnabled, availability: availabilityToday ?? undefined })) },
    directory: { users: people, branches: [...branchNames].map(([id, name]) => ({ id, name })), departments: departmentRows.map((row) => ({ id: text(row.id), name: text(row.name), branch: branchNames.get(text(row.branch_id)) ?? null })) },
  };
}
