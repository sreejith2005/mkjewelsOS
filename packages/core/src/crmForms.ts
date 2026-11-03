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
    // The CRM lead form shows no file fields yet; a geo field is a text box there.
    .filter((field) => !field.is_hidden && field.field_type !== "file")
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
const OPTION_VALUE = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 190) || "option";

export type CrmFormCopy = { name: string; description: string; fields: FormFieldDefinition[]; fieldMap: Record<string, string> };

/**
 * Today's client queue registration form (REGISTER CLIENT ENTRY) as a Form Builder form:
 * CLIENT NAME and MOBILE NUMBER side by side. BRANCH stays a CRM choice above the form.
 */
export function crmQueueFormCopy(): CrmFormCopy {
  return {
    name: "Client queue registration",
    description: "CRM → REGISTRATION → CLIENT / WALK-IN. The branch is chosen in CRM. A mobile number outside India starts with + and the country code.",
    fields: [
      { key: "client_name", label: "CLIENT NAME", type: "text", sortOrder: 0, required: true, validation: { width: "half" } },
      { key: "mobile", label: "MOBILE NUMBER", type: "phone", sortOrder: 1, required: true, validation: { width: "half" } },
    ],
    fieldMap: { client_name: "client_name", mobile: "mobile" },
  };
}

/** One configured lead option route (get_crm_lead_option_routes): choosing option_value on a field shows triggers_field_key. */
export type CrmLeadOptionRoute = Readonly<{ field_id: string; option_value: string; display_order: number; triggers_field_key: string | null }>;
export type CrmLeadFieldWithId = CrmLeadFieldConfig & Readonly<{ id: string }>;
type MasterChoice = Readonly<{ masterType: string; value: string; label: string }>;

/** Fields the CRM lead form shows only when an earlier answer routes to them (lead-form.tsx, save_crm_lead). */
export const CRM_LEAD_ROUTED_FIELDS: ReadonlySet<string> = new Set(["source_of_lead", "type_of_calling", "name_of_exhibition", "exhibition_name", "invitation_offer_name"]);

function uniqueChoices(choices: readonly string[]) {
  const seen = new Set<string>();
  return choices.filter((choice) => { const key = choice.trim().toUpperCase(); if (!key || seen.has(key)) return false; seen.add(key); return true; });
}

/**
 * Today's CRM lead form as a Form Builder form, built from the CRM's live lead configuration:
 * the same fields, labels, order and required answers, two per row as in CRM; dropdowns read the
 * same JewelOS Dropdown Master lists CRM reads (or the same choices, when no list matches), and
 * fields CRM reveals after an answer (for example Exhibition after Source of lead) get the same
 * condition. Questions keep the CRM field keys, so each is linked to its own CRM answer.
 */
export function crmLeadFormCopy(fields: readonly CrmLeadFieldWithId[], routes: readonly CrmLeadOptionRoute[], lookupOptions: Readonly<Record<string, readonly string[]>>, masters: readonly MasterChoice[]): CrmFormCopy {
  const masterTypes = new Set(masters.map((option) => option.masterType));
  const shown = [...fields].filter((field) => !field.is_hidden && field.field_type !== "file")
    .sort((left, right) => left.display_order - right.display_order || left.field_key.localeCompare(right.field_key));
  const byId = new Map(shown.map((field) => [field.id, field]));

  // How each question offers its choices, and the stored value for a CRM choice.
  const choiceSource = new Map<string, { masterType?: string; options?: { value: string; label: string }[] }>();
  for (const field of shown) {
    if (field.field_type !== "dropdown") continue;
    const listKey = field.option_source ?? field.field_key;
    const masterType = dropdownMasterForCrmOption(listKey, masterTypes);
    if (masterType) { choiceSource.set(field.field_key, { masterType }); continue; }
    const used = new Set<string>();
    const options = uniqueChoices(lookupOptions[listKey] ?? []).slice(0, 100).map((label) => {
      let value = OPTION_VALUE(label);
      for (let round = 2; used.has(value); round += 1) value = `${OPTION_VALUE(label)}_${round}`;
      used.add(value);
      return { value, label };
    });
    if (options.length) choiceSource.set(field.field_key, { options });
  }
  const storedValue = (fieldKey: string, crmChoice: string): string | undefined => {
    const source = choiceSource.get(fieldKey);
    const wanted = crmChoice.trim().toUpperCase();
    if (source?.masterType) return masters.find((option) => option.masterType === source.masterType && option.label.trim().toUpperCase() === wanted)?.value;
    return source?.options?.find((option) => option.label.trim().toUpperCase() === wanted)?.value;
  };

  // Which answers reveal each routed field.
  const triggers = new Map<string, Array<{ sourceKey: string; value: string }>>();
  for (const route of routes) {
    const source = byId.get(route.field_id);
    if (!source || !route.triggers_field_key) continue;
    const value = storedValue(source.field_key, route.option_value);
    if (!value) continue;
    triggers.set(route.triggers_field_key, [...(triggers.get(route.triggers_field_key) ?? []), { sourceKey: source.field_key, value }]);
  }
  // A routed field nothing reveals is never shown in CRM, so it is left out.
  const included = shown.filter((field) => !CRM_LEAD_ROUTED_FIELDS.has(field.field_key) || (triggers.get(field.field_key)?.length ?? 0) > 0);
  const includedKeys = new Set(included.map((field) => field.field_key));
  // Conditions read earlier questions: a revealed field moves after the questions that reveal it.
  const ordered: CrmLeadFieldWithId[] = [];
  const pending = [...included];
  while (pending.length) {
    const placed = new Set(ordered.map((field) => field.field_key));
    const index = pending.findIndex((field) => !CRM_LEAD_ROUTED_FIELDS.has(field.field_key)
      || (triggers.get(field.field_key) ?? []).every((trigger) => placed.has(trigger.sourceKey) || !includedKeys.has(trigger.sourceKey)));
    ordered.push(...pending.splice(index === -1 ? 0 : index, 1));
  }

  const keys = new Map<string, string>();
  const definitions = ordered.map((field, sortOrder): FormFieldDefinition => {
    let key = FIELD_KEY(field.field_key);
    while ([...keys.values()].includes(key)) key = `${key}_${sortOrder}`;
    keys.set(field.field_key, key);
    const source = choiceSource.get(field.field_key);
    const type: FormFieldType = field.field_key === "mobile_no" ? "phone" : field.field_type === "date" ? "date" : field.field_type === "number" ? "number" : field.field_type === "dropdown" && source ? "select" : "text";
    const placed = (triggers.get(field.field_key) ?? []).filter((trigger) => keys.has(trigger.sourceKey) && trigger.sourceKey !== field.field_key);
    const predicates = placed.slice(0, 20).map((trigger) => ({ kind: "predicate" as const, fieldKey: keys.get(trigger.sourceKey)!, operator: "equals" as const, value: trigger.value }));
    return {
      key, label: field.label, type, sortOrder,
      required: field.field_key === "mobile_no" || field.is_mandatory,
      validation: { width: "half" },
      ...(type === "select" && source?.masterType ? { optionSource: { kind: "master" as const, masterType: source.masterType } } : {}),
      ...(type === "select" && source?.options ? { options: source.options } : {}),
      ...(CRM_LEAD_ROUTED_FIELDS.has(field.field_key) && predicates.length ? { rule: predicates.length === 1 ? predicates[0]! : { kind: "any" as const, rules: predicates } } : {}),
    };
  });
  return {
    name: "Lead registration",
    description: "CRM → REGISTRATION → LEAD. For Instagram, WhatsApp, calling, exhibitions, referrals and other remote enquiries.",
    fields: definitions,
    fieldMap: Object.fromEntries(ordered.map((field) => [field.field_key, keys.get(field.field_key)!])),
  };
}
