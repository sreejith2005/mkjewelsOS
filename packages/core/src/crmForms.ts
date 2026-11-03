// CRM forms built in the Form Builder (owner request 2026-11-03).
//
// A Super Admin links a published Form Builder form to a CRM purpose and says
// which question fills which CRM answer. Nothing here is a form layout: the
// questions, order, sections, conditions and widths all come from the Form
// Builder. What is fixed is only the CRM side of the contract, which the CRM's
// existing RPCs define:
// - client queue registration: register_walkin_entry(client name, mobile);
// - lead registration: save_crm_lead(phone, name, fields), whose fields are the
//   CRM's own configurable lead_form_fields.
// Links are by stable question key, never by label.
import type { FormAnswer, FormFieldDefinition, FormFieldType, FormTemplateDefinition } from "./forms/types.ts";

export const CRM_FORM_PURPOSES = ["queue", "lead", "walkin"] as const;
export type CrmFormPurpose = (typeof CRM_FORM_PURPOSES)[number];
/** Purposes that can be linked to a Form Builder form today; the walk-in visit follows. */
export const LINKABLE_CRM_FORM_PURPOSES = ["queue", "lead"] as const satisfies readonly CrmFormPurpose[];

export const CRM_FORM_PURPOSE_LABELS: Readonly<Record<CrmFormPurpose, string>> = {
  queue: "Client queue registration",
  lead: "Lead registration",
  walkin: "Client walk-in visit",
};

/** What kind of answer a CRM target accepts, which decides the questions that may fill it. */
export type CrmTargetKind = "name" | "phone" | "text" | "number" | "date" | "choice";

export type CrmFormTarget = Readonly<{
  key: string;
  label: string;
  required: boolean;
  kind: CrmTargetKind;
  /** For a choice: the CRM Dropdown Master key whose values CRM accepts. */
  optionKey?: string | undefined;
}>;

const KIND_FIELD_TYPES: Readonly<Record<CrmTargetKind, readonly FormFieldType[]>> = {
  name: ["text", "textarea"],
  phone: ["phone", "text"],
  text: ["text", "textarea", "select", "radio", "email", "phone", "number", "currency", "date", "datetime", "branch_dropdown", "user_dropdown", "department_dropdown"],
  number: ["number", "currency", "text"],
  date: ["date"],
  choice: ["select", "radio", "text"],
};

/** Form question types that may fill a CRM target. Headings, dividers, files and multi-answer questions never do. */
export function crmTargetFieldTypes(kind: CrmTargetKind): readonly FormFieldType[] {
  return KIND_FIELD_TYPES[kind];
}

/** register_walkin_entry's answers. Branch, token, CRM queue and identity stay with the CRM. */
export const CRM_QUEUE_TARGETS: readonly CrmFormTarget[] = [
  { key: "client_name", label: "Client name", required: true, kind: "name" },
  { key: "mobile", label: "Mobile number", required: true, kind: "phone" },
];

/** The CRM's own lead field configuration (lead_form_fields), as the lead form reads it. */
export type CrmLeadFieldConfig = Readonly<{
  field_key: string;
  label: string;
  field_type: string;
  is_mandatory: boolean;
  is_hidden: boolean;
  display_order: number;
  option_source: string | null;
}>;

/** Lead targets come from the CRM's lead field configuration, so a new CRM lead field appears here by itself. */
export function crmLeadTargets(fields: readonly CrmLeadFieldConfig[]): CrmFormTarget[] {
  return [...fields]
    .filter((field) => !field.is_hidden && field.field_type !== "file" && field.field_type !== "geo")
    .sort((left, right) => left.display_order - right.display_order || left.field_key.localeCompare(right.field_key))
    .map((field) => {
      const kind: CrmTargetKind = field.field_key === "mobile_no" ? "phone"
        : field.field_key === "name" ? "name"
        : field.field_type === "dropdown" ? "choice"
        : field.field_type === "date" ? "date"
        : field.field_type === "number" ? "number" : "text";
      return {
        key: field.field_key,
        label: field.label,
        // save_crm_lead always needs the mobile number.
        required: field.field_key === "mobile_no" || field.is_mandatory,
        kind,
        ...(kind === "choice" ? { optionKey: field.option_source ?? field.field_key } : {}),
      };
    });
}

export function crmFormTargets(purpose: CrmFormPurpose, leadFields: readonly CrmLeadFieldConfig[] = []): readonly CrmFormTarget[] {
  return purpose === "queue" ? CRM_QUEUE_TARGETS : purpose === "lead" ? crmLeadTargets(leadFields) : [];
}

/** {CRM target key: form question key}. */
export type CrmFieldMap = Readonly<Record<string, string>>;

export type CrmFormBindingIssue = Readonly<{ targetKey?: string | undefined; fieldKey?: string | undefined; message: string }>;

const ANSWER_FIELD = (field: FormFieldDefinition) => !["section_header", "divider", "file"].includes(field.type);

/** Questions of a form that may fill a target. */
export function crmTargetCandidates(definition: FormTemplateDefinition, target: CrmFormTarget): FormFieldDefinition[] {
  const allowed = new Set(crmTargetFieldTypes(target.kind));
  return definition.fields.filter((field) => ANSWER_FIELD(field) && allowed.has(field.type));
}

/**
 * Checks a link against a form version. CRM uses a linked form only when this
 * returns no issues; otherwise it keeps its standard form, so a form edit can
 * never stop registrations.
 */
export function checkCrmFormBinding(definition: FormTemplateDefinition, fieldMap: CrmFieldMap, targets: readonly CrmFormTarget[]): CrmFormBindingIssue[] {
  const issues: CrmFormBindingIssue[] = [];
  const byKey = new Map(definition.fields.map((field) => [field.key, field]));
  const used = new Map<string, string>();
  for (const target of targets) {
    const fieldKey = fieldMap[target.key];
    if (!fieldKey) {
      if (target.required) issues.push({ targetKey: target.key, message: `Choose the question for ${target.label}.` });
      continue;
    }
    const field = byKey.get(fieldKey);
    if (!field) { issues.push({ targetKey: target.key, fieldKey, message: `The question linked to ${target.label} is no longer in the form.` }); continue; }
    if (!crmTargetFieldTypes(target.kind).includes(field.type) || !ANSWER_FIELD(field)) {
      issues.push({ targetKey: target.key, fieldKey, message: `"${field.label}" cannot fill ${target.label}: use a ${target.kind === "phone" ? "phone or text" : target.kind === "name" ? "text" : target.kind === "date" ? "date" : target.kind === "choice" ? "dropdown or single-choice" : "matching"} question.` });
      continue;
    }
    if (target.required && field.required !== true) {
      issues.push({ targetKey: target.key, fieldKey, message: `"${field.label}" fills ${target.label}, which CRM requires: make the question required in the Form Builder.` });
    }
    const other = used.get(fieldKey);
    if (other) issues.push({ targetKey: target.key, fieldKey, message: `"${field.label}" already fills ${other}. One question can fill one CRM answer.` });
    used.set(fieldKey, target.label);
  }
  // A file uploaded in a linked form would stay in JewelOS storage and never reach the CRM record.
  for (const field of definition.fields) if (field.type === "file") issues.push({ fieldKey: field.key, message: `"${field.label}" is a file upload. CRM registration forms cannot save files yet: remove the question or move it to another form.` });
  const known = new Set(targets.map((target) => target.key));
  for (const key of Object.keys(fieldMap)) if (!known.has(key)) issues.push({ targetKey: key, message: `CRM no longer has the answer "${key}". Remove that link.` });
  return issues;
}

const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const TARGET_ALIASES: Readonly<Record<string, readonly string[]>> = {
  client_name: ["client name", "customer name", "name", "full name"],
  mobile: ["mobile", "mobile number", "phone", "phone number", "mobile no", "contact number"],
  mobile_no: ["mobile", "mobile number", "phone", "phone number", "mobile no", "contact number"],
  name: ["name", "client name", "customer name", "full name"],
};

/** A starting link: each target takes the free question with the same key, the same label, or a common alias. */
export function suggestCrmFieldMap(definition: FormTemplateDefinition, targets: readonly CrmFormTarget[], current: CrmFieldMap = {}): Record<string, string> {
  const map: Record<string, string> = {};
  const taken = new Set<string>();
  const keep = new Set(definition.fields.map((field) => field.key));
  for (const target of targets) {
    const existing = current[target.key];
    if (existing && keep.has(existing) && !taken.has(existing)) { map[target.key] = existing; taken.add(existing); }
  }
  for (const target of targets) {
    if (map[target.key]) continue;
    const candidates = crmTargetCandidates(definition, target).filter((field) => !taken.has(field.key));
    const names = new Set([normalized(target.key), normalized(target.label), ...(TARGET_ALIASES[target.key] ?? [])]);
    const match = candidates.find((field) => field.key === target.key)
      ?? candidates.find((field) => names.has(normalized(field.key)) || names.has(normalized(field.label)));
    if (match) { map[target.key] = match.key; taken.add(match.key); }
  }
  return map;
}

/**
 * The CRM answers from a submitted form. `display` is each answer as the person
 * saw it (a choice's label, a branch's name), which is what CRM stores; blank
 * answers are left out.
 */
export function crmAnswersFromForm(fieldMap: CrmFieldMap, answers: Readonly<Record<string, FormAnswer | null | undefined>>, display: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [targetKey, fieldKey] of Object.entries(fieldMap)) {
    const raw = answers[fieldKey];
    if (raw === null || raw === undefined || raw === "") continue;
    const text = (display[fieldKey] ?? (Array.isArray(raw) ? raw.join(", ") : String(raw))).trim();
    if (text) result[targetKey] = text;
  }
  return result;
}

// CRM lead dropdowns read the JewelOS Dropdown Master lists the CRM receives
// (supabase-crm get_crm_master_options). These are the CRM keys of the lists
// whose JewelOS type is spelt differently; any other list keeps its key or is
// stored as lead_<key>.
const CRM_OPTION_KEY_TO_MASTER: Readonly<Record<string, string>> = {
  lookup_beverages: "beverage", beverage: "beverage",
  lookup_sugar_options: "sugar_option", sugar: "sugar_option",
  lookup_snacks: "snack_option", snack: "snack_option",
  lookup_gifts: "gift_option", gift: "gift_option",
  lookup_communities: "caste", community: "caste",
  lookup_relations: "client_relation", relation: "client_relation",
  lookup_source_of_leads: "crm_source",
  lookup_product_categories: "product_category", product_category: "product_category",
  lookup_not_bought_reasons: "not_bought_reason", not_bought_reason: "not_bought_reason",
  client_potential_category: "potential_category", potential_category: "potential_category",
};

/** The JewelOS Dropdown Master list behind a CRM choice, among the lists that exist. */
export function dropdownMasterForCrmOption(optionKey: string, masterTypes: ReadonlySet<string>): string | undefined {
  return [CRM_OPTION_KEY_TO_MASTER[optionKey], `lead_${optionKey}`, optionKey].find((type): type is string => !!type && masterTypes.has(type));
}

const FIELD_KEY = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "q_$1").slice(0, 60) || "question";

/**
 * A ready-made Form Builder form with one question per CRM answer, laid out
 * two per row on wider screens, so an author starts from what CRM asks today
 * and rearranges it. Returns the questions and the matching link.
 */
export function crmStarterForm(targets: readonly CrmFormTarget[], masterTypes: ReadonlySet<string>): { fields: FormFieldDefinition[]; fieldMap: Record<string, string> } {
  const fields: FormFieldDefinition[] = [];
  const fieldMap: Record<string, string> = {};
  const keys = new Set<string>();
  targets.forEach((target, index) => {
    let key = FIELD_KEY(target.key);
    while (keys.has(key)) key = `${key}_${index}`;
    keys.add(key);
    const masterType = target.kind === "choice" && target.optionKey ? dropdownMasterForCrmOption(target.optionKey, masterTypes) : undefined;
    const type: FormFieldType = target.kind === "phone" ? "phone" : target.kind === "date" ? "date" : target.kind === "number" ? "number" : masterType ? "select" : "text";
    fields.push({
      key, label: target.label, type, sortOrder: index, required: target.required,
      validation: { width: "half" },
      ...(masterType ? { optionSource: { kind: "master", masterType } } : {}),
      ...(target.kind === "phone" ? { placeholder: "10-digit mobile number" } : {}),
    });
    fieldMap[target.key] = key;
  });
  return { fields, fieldMap };
}
