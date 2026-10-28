import { getSupabase as db } from "@jewelos/api-client/client";
import type { FormMasterOption, Json, Tables } from "@jewelos/core";
import { writeError } from "../writeErrors.ts";

export type MasterOption = Pick<Tables<"dropdown_masters">, "id" | "master_type" | "label" | "value" | "sort_order" | "is_active">;
const cached = new Map<string, Promise<MasterOption[]>>();

export function loadMasterOptions(types: readonly string[], activeOnly = true): Promise<MasterOption[]> {
  const key = `${activeOnly ? "active" : "all"}:${[...types].sort().join(",")}`;
  const existing = cached.get(key); if (existing) return existing;
  const request = readAllPages<MasterOption>((from, to) => {
    const query = db().from("dropdown_masters").select("id,master_type,label,value,sort_order,is_active").eq("is_active", activeOnly).order("master_type").order("sort_order").order("id");
    return (types.length ? query.in("master_type", [...types]) : query).range(from, to);
  }).finally(() => { if (cached.get(key) === request) cached.delete(key); });
  cached.set(key, request); return request;
}
export function invalidateMasterOptions() { cached.clear(); }

export function loadAllMasterOptions(): Promise<MasterOption[]> {
  return readAllPages<MasterOption>((from, to) => db().from("dropdown_masters")
    .select("id,master_type,label,value,sort_order,is_active")
    .order("master_type").order("sort_order").order("id").range(from, to));
}

/** Every Dropdown Master row, active or not, for the Dropdown Master page. */
export function loadDropdownMasterRows(): Promise<Tables<"dropdown_masters">[]> {
  return readAllPages<Tables<"dropdown_masters">>((from, to) => db().from("dropdown_masters")
    .select("*").order("master_type").order("sort_order").order("id").range(from, to));
}

/** Where a Dropdown Master list came from. */
export type DropdownListOrigin = "form" | "master" | "built_in";
export type DropdownListForm = Readonly<{ formTemplateId: string; name: string; lifecycle: string; questions: readonly string[] }>;
export type DropdownListInsights = Readonly<{
  /** List key -> when a form author created it from the form editor. */
  madeInForms: ReadonlyMap<string, string>;
  /** List keys the app ships with (system categories). */
  builtIn: ReadonlySet<string>;
  /** List key -> forms whose questions use the list (archived forms left out). */
  usedBy: ReadonlyMap<string, readonly DropdownListForm[]>;
  /** False when a source could not be read; the page then shows less detail. */
  complete: boolean;
}>;

/**
 * Read-only facts the Dropdown Master page shows beside each list. Each read
 * is independent and fails open: Dropdown Master itself never depends on it.
 */
export async function loadDropdownListInsights(): Promise<DropdownListInsights> {
  let complete = true;
  const soft = async <T,>(read: () => Promise<T[]>): Promise<T[]> => {
    try { return await read(); } catch { complete = false; return []; }
  };
  const [created, categories, fields] = await Promise.all([
    soft(() => readAllPages<{ created_at: string | null; new_value: Json | null }>((from, to) => db().from("audit_logs")
      .select("created_at,new_value").eq("module", "dropdown_master").eq("action", "dropdown_list_created")
      .order("created_at").order("id").range(from, to))),
    soft(() => readAllPages<{ category_key: string; is_system: boolean }>((from, to) => db().from("dropdown_master_categories")
      .select("category_key,is_system").order("category_key").order("id").range(from, to))),
    soft(() => readAllPages<{ dropdown_master_type: string | null; field_name: string; form_template_id: string; form_templates: { name: string; lifecycle: string } | null }>((from, to) => db().from("form_fields")
      .select("dropdown_master_type,field_name,form_template_id,form_templates!inner(name,lifecycle)")
      .eq("option_source", "dropdown_master").not("dropdown_master_type", "is", null)
      .order("form_template_id").order("id").range(from, to))),
  ]);
  const madeInForms = new Map<string, string>();
  for (const row of created) {
    const value = row.new_value;
    const masterType = value && typeof value === "object" && !Array.isArray(value) ? value.master_type : null;
    if (typeof masterType === "string" && !madeInForms.has(masterType)) madeInForms.set(masterType, row.created_at ?? "");
  }
  const usage = new Map<string, Map<string, { name: string; lifecycle: string; questions: string[] }>>();
  for (const field of fields) {
    const template = field.form_templates;
    if (!field.dropdown_master_type || !template || template.lifecycle === "archived") continue;
    const forms = usage.get(field.dropdown_master_type) ?? new Map();
    const form = forms.get(field.form_template_id) ?? { name: template.name, lifecycle: template.lifecycle, questions: [] };
    form.questions.push(field.field_name);
    forms.set(field.form_template_id, form); usage.set(field.dropdown_master_type, forms);
  }
  return {
    madeInForms,
    builtIn: new Set(categories.filter((category) => category.is_system).map((category) => category.category_key)),
    usedBy: new Map([...usage].map(([key, forms]) => [key, [...forms].map(([formTemplateId, form]) => ({ formTemplateId, ...form })).sort((a, b) => a.name.localeCompare(b.name))])),
    complete,
  };
}

const PAGE_SIZE = 1000;
/**
 * PostgREST returns at most 1000 rows per request, so a long Dropdown Master
 * would silently lose its last lists. Reads continue page by page instead.
 */
async function readAllPages<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = (data ?? []) as T[];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
}

export async function changeMasterOption(input: {
  id?: string;
  masterType: string;
  label: string;
  value: string;
  sortOrder: number;
  active: boolean;
}): Promise<void> {
  const { error } = await db().rpc("change_dropdown_with_audit", {
    p_operation: input.id ? "update" : "create",
    ...(input.id ? { p_record_id: input.id } : {}),
    p_master_type: input.masterType,
    p_label: input.label,
    p_value: input.value,
    p_sort_order: input.sortOrder,
    p_is_active: input.active,
  });
  // A unique-index refusal here is a person re-adding a value that exists, not
  // a fault, so it is re-worded before it reaches either client.
  if (error) throw writeError(error.message);
  invalidateMasterOptions();
}

/** The Dropdown Master rows in the shape the forms engine resolves references with. */
export const toFormMasterOptions = (options: readonly MasterOption[]): FormMasterOption[] =>
  options.map((option) => ({ masterType: option.master_type, value: option.value, label: option.label }));

/** Creates a brand-new Dropdown Master list and returns its master_type key. */
export async function createMasterList(masterType: string, options: readonly { value: string; label: string }[]): Promise<string> {
  const { data, error } = await db().rpc("create_dropdown_list_with_audit", { p_master_type: masterType, p_options: options as unknown as Json });
  if (error) throw writeError(error.message);
  invalidateMasterOptions();
  return (data as string | null) ?? masterType;
}
