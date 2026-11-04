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
export const LINKABLE_CRM_FORM_PURPOSES = ["queue", "lead", "walkin"] as const satisfies readonly CrmFormPurpose[];

export const CRM_FORM_PURPOSE_LABELS: Readonly<Record<CrmFormPurpose, string>> = {
  queue: "Client queue registration",
  lead: "Lead registration",
  walkin: "Client walk-in visit",
};

/** What kind of answer a CRM target accepts, which decides the questions that may fill it. */
export type CrmTargetKind = "name" | "phone" | "text" | "number" | "date" | "datetime" | "choice" | "multi" | "repeat" | "photo";

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
  datetime: ["datetime"],
  choice: ["select", "radio", "text"],
  multi: ["checkbox", "multiselect"],
  repeat: ["repeat"],
  photo: ["crm_photo"],
};

/** Form question types that may fill a CRM target. Headings, dividers and file uploads never do. */
export function crmTargetFieldTypes(kind: CrmTargetKind): readonly FormFieldType[] {
  return KIND_FIELD_TYPES[kind];
}

/** register_walkin_entry's answers. Branch, token, CRM queue and identity stay with the CRM. */
export const CRM_QUEUE_TARGETS: readonly CrmFormTarget[] = [
  { key: "client_name", label: "Client name", required: true, kind: "name" },
  { key: "mobile", label: "Mobile number", required: true, kind: "phone" },
];

/** The engagement asks of the walk-in visit (walk-in-form.tsx engagementKinds), with their answers. */
export const CRM_WALKIN_ENGAGEMENT: ReadonlyArray<Readonly<{ key: string; label: string; answers: readonly string[] }>> = [
  { key: "instagram", label: "Instagram follow", answers: ["YES", "NO", "CLIENT_NOT_INTERESTED", "CLIENT_ALREADY_FOLLOWING_US"] },
  { key: "google_review", label: "Google review", answers: ["YES", "NO", "ALREADY_DONE", "NOT_INTERESTED"] },
  { key: "testimonial", label: "Testimonial", answers: ["YES", "NO", "NOT_INTERESTED"] },
  { key: "feedback_form", label: "Feedback form", answers: ["YES", "NO", "NOT_INTERESTED"] },
  { key: "thank_you_note", label: "Thank-you note", answers: ["YES", "NO"] },
  { key: "referrals", label: "Referrals", answers: ["YES", "NO", "NOT_INTERESTED"] },
];

/** The product lists of the walk-in visit: categories, "Other", and the count + tag rows. */
export const CRM_WALKIN_PRODUCT_LISTS: ReadonlyArray<Readonly<{ key: string; categories: string; other: string; tags: string; label: string }>> = [
  { key: "seen", categories: "seen_categories", other: "seen_other", tags: "seen_tags", label: "seen" },
  { key: "bought", categories: "bought_categories", other: "bought_other", tags: "bought_tags", label: "bought" },
  { key: "order", categories: "order_categories", other: "order_other", tags: "order_tags", label: "order" },
  { key: "camefor", categories: "came_for_categories", other: "came_for_other", tags: "camefor_tags", label: "came for" },
  { key: "new_things", categories: "new_things_categories", other: "new_things_other", tags: "new_things_tags", label: "new buy / order" },
];

const target = (key: string, label: string, kind: CrmTargetKind, required = false): CrmFormTarget => ({ key, label, kind, required });

/** submit_walkin_visit's answers, as the walk-in visit form collects them today. */
export const CRM_WALKIN_TARGETS: readonly CrmFormTarget[] = [
  target("event_date", "Visit date and time", "datetime"),
  target("primary_name", "Client name", "name", true),
  target("primary_phone", "Mobile", "phone", true),
  target("source_of_lead", "Source of lead", "choice"),
  target("reference_name", "Reference name", "text"),
  target("reference_phone", "Reference phone", "text"),
  target("source_of_lead_other", "Source other", "text"),
  target("crm_name", "CRM / salesperson", "text"),
  target("salesperson", "Salesperson attending the client", "text"),
  target("gender", "Gender", "choice"),
  target("billing_phone", "Billing phone", "phone"),
  target("country", "Country", "text"),
  target("state", "State", "text"),
  target("city", "City", "text"),
  target("city_other", "City other", "text"),
  target("pincode", "Pincode", "text"),
  target("address", "Address", "text"),
  target("community", "Community / caste", "choice"),
  target("community_other", "Community other", "text"),
  target("dob", "Date of birth", "date"),
  target("anniversary", "Anniversary", "date"),
  target("occupation", "Occupation", "choice"),
  target("occupation_other", "Occupation other", "text"),
  target("bridal_or_non_bridal", "Bridal / non-bridal", "choice"),
  target("wedding_month", "Wedding month", "choice"),
  target("wedding_year", "Wedding year", "choice"),
  target("communication_preference", "Communication preference", "choice"),
  target("companions", "Family / friends with the client", "repeat"),
  target("visit_status", "Client bought any product?", "choice", true),
  target("not_bought_reasons", "Not-bought reasons", "multi"),
  target("not_bought_other", "Other reason", "text"),
  ...CRM_WALKIN_PRODUCT_LISTS.flatMap((list) => [
    target(list.categories, `Product categories ${list.label}`, "multi"),
    target(list.tags, `Number of products ${list.label} and their tags`, "repeat"),
    target(list.other, `Other (${list.label} category)`, "text"),
  ]),
  target("other_order", "Did the client make any other / new order?", "choice"),
  target("repair_or_order_approach", "Did CRM approach to show new products?", "choice"),
  target("new_things_choice", "Is client buying / making order for new things?", "choice"),
  target("salesperson_handled", "Salesperson attending new buy / order", "text"),
  target("marketing_message_sent", "Marketing message", "choice"),
  ...CRM_WALKIN_ENGAGEMENT.flatMap((ask) => [
    target(`engagement_${ask.key}`, ask.label, "choice"),
    target(`engagement_${ask.key}_reason`, `${ask.label} - no reason`, "text"),
    target(`engagement_${ask.key}_proof`, `${ask.label} proof image`, "photo"),
  ]),
  target("referrals", "Referrals given", "repeat"),
  target("beverage", "Beverage", "choice"),
  target("beverage_other", "Other beverage", "text"),
  target("sugar", "Sugar", "choice"),
  target("sugar_other", "Other sugar preference", "text"),
  target("snack", "Snack", "choice"),
  target("snack_other", "Other snack", "text"),
  target("gift", "Gift given", "choice"),
  target("gift_other", "Other gift", "text"),
  target("next_visit_date", "Next visit date", "date"),
  target("client_potential_category", "Client potential category", "choice"),
  target("high_potential_reason", "Why high potential", "text"),
  target("product_requirement", "Product requirement", "text"),
  target("other_store_client_wants_to_visit", "Other store client wants to visit", "text"),
  target("categories_client_wants_more", "Which categories client wants to see more", "multi"),
  target("remark", "Remark", "text"),
  target("remark_photos", "Remark photos", "photo"),
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
  return purpose === "queue" ? CRM_QUEUE_TARGETS : purpose === "lead" ? crmLeadTargets(leadFields) : CRM_WALKIN_TARGETS;
}

/**
 * {CRM target key: form question key}. A walk-in answer may come from up to three questions shown
 * in different cases (for example Next visit date, required only after a Not Bought visit); the
 * first one answered is used.
 */
export type CrmFieldMap = Readonly<Record<string, string | readonly string[]>>;

/** The questions linked to a CRM answer, in order. */
export function crmLinkedQuestions(fieldMap: CrmFieldMap, targetKey: string): readonly string[] {
  const linked = fieldMap[targetKey];
  return linked === undefined ? [] : typeof linked === "string" ? (linked ? [linked] : []) : linked.filter(Boolean);
}

export type CrmFormBindingIssue = Readonly<{ targetKey?: string | undefined; fieldKey?: string | undefined; message: string }>;

const ANSWER_FIELD = (field: FormFieldDefinition) => !["section_header", "divider", "file"].includes(field.type);
const KIND_NAMES: Readonly<Record<CrmTargetKind, string>> = {
  name: "text", phone: "phone or text", text: "matching", number: "number", date: "date", datetime: "date and time",
  choice: "dropdown or single-choice", multi: "checkbox list", repeat: "repeating group", photo: "CRM photo",
};

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
    const linked = crmLinkedQuestions(fieldMap, target.key);
    if (!linked.length) {
      if (target.required) issues.push({ targetKey: target.key, message: `Choose the question for ${target.label}.` });
      continue;
    }
    if (linked.length > 3) issues.push({ targetKey: target.key, message: `${target.label} can come from up to three questions.` });
    for (const fieldKey of linked) {
      const field = byKey.get(fieldKey);
      if (!field) { issues.push({ targetKey: target.key, fieldKey, message: `The question linked to ${target.label} is no longer in the form.` }); continue; }
      if (!crmTargetFieldTypes(target.kind).includes(field.type) || !ANSWER_FIELD(field)) {
        issues.push({ targetKey: target.key, fieldKey, message: `"${field.label}" cannot fill ${target.label}: use a ${KIND_NAMES[target.kind]} question.` });
        continue;
      }
      if (target.required && linked.length === 1 && field.required !== true) {
        issues.push({ targetKey: target.key, fieldKey, message: `"${field.label}" fills ${target.label}, which CRM requires: make the question required in the Form Builder.` });
      }
      const other = used.get(fieldKey);
      if (other) issues.push({ targetKey: target.key, fieldKey, message: `"${field.label}" already fills ${other}. One question can fill one CRM answer.` });
      used.set(fieldKey, target.label);
    }
  }
  // A file uploaded in a linked form would stay in JewelOS storage and never reach the CRM record.
  for (const field of definition.fields) if (field.type === "file") issues.push({ fieldKey: field.key, message: `"${field.label}" is a file upload. CRM forms save photos through a CRM photo question instead: change its type.` });
  const known = new Set(targets.map((item) => item.key));
  for (const key of Object.keys(fieldMap)) if (!known.has(key)) issues.push({ targetKey: key, message: `CRM no longer has the answer "${key}". Remove that link.` });
  return issues;
}

const normalized = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const TARGET_ALIASES: Readonly<Record<string, readonly string[]>> = {
  client_name: ["client name", "customer name", "name", "full name"],
  mobile: ["mobile", "mobile number", "phone", "phone number", "mobile no", "contact number"],
  mobile_no: ["mobile", "mobile number", "phone", "phone number", "mobile no", "contact number"],
  name: ["name", "client name", "customer name", "full name"],
  primary_name: ["client name", "customer name", "name", "full name"],
  primary_phone: ["mobile", "mobile number", "phone", "phone number", "mobile no", "contact number"],
};

/** A starting link: each target takes the free question with the same key, the same label, or a common alias. */
export function suggestCrmFieldMap(definition: FormTemplateDefinition, targets: readonly CrmFormTarget[], current: CrmFieldMap = {}): Record<string, string | readonly string[]> {
  const map: Record<string, string | readonly string[]> = {};
  const taken = new Set<string>();
  const keep = new Set(definition.fields.map((field) => field.key));
  for (const item of targets) {
    const existing = crmLinkedQuestions(current, item.key).filter((key) => keep.has(key) && !taken.has(key));
    if (existing.length) { map[item.key] = existing.length === 1 ? existing[0]! : existing; existing.forEach((key) => taken.add(key)); }
  }
  for (const item of targets) {
    if (map[item.key]) continue;
    const candidates = crmTargetCandidates(definition, item).filter((field) => !taken.has(field.key));
    const names = new Set([normalized(item.key), normalized(item.label), ...(TARGET_ALIASES[item.key] ?? [])]);
    const match = candidates.find((field) => field.key === item.key)
      ?? candidates.find((field) => names.has(normalized(field.key)) || names.has(normalized(field.label)));
    if (match) { map[item.key] = match.key; taken.add(match.key); }
  }
  return map;
}

/** The answer for a CRM target: the first linked question answered. */
export function crmLinkedAnswer(fieldMap: CrmFieldMap, targetKey: string, answers: Readonly<Record<string, FormAnswer | null | undefined>>): { fieldKey: string; value: FormAnswer } | null {
  for (const fieldKey of crmLinkedQuestions(fieldMap, targetKey)) {
    const value = answers[fieldKey];
    if (value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    return { fieldKey, value };
  }
  return null;
}

/**
 * The CRM answers from a submitted form, as text. `display` is each answer as the person
 * saw it (a choice's label, a branch's name), which is what CRM stores; blank
 * answers are left out. Repeating groups and CRM photos are read with crmLinkedAnswer.
 */
export function crmAnswersFromForm(fieldMap: CrmFieldMap, answers: Readonly<Record<string, FormAnswer | null | undefined>>, display: Readonly<Record<string, string>>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const targetKey of Object.keys(fieldMap)) {
    const found = crmLinkedAnswer(fieldMap, targetKey, answers);
    if (!found || (typeof found.value === "object" && !Array.isArray(found.value))) continue;
    const raw = found.value;
    const text = (display[found.fieldKey] ?? (Array.isArray(raw) ? raw.join(", ") : String(raw))).trim();
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

export type CrmFormCopy = { name: string; description: string; fields: FormFieldDefinition[]; fieldMap: Record<string, string | string[]> };

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
