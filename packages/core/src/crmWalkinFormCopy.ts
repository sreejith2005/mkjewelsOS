// Today's CRM walk-in visit form (packages/crm-ui walk-in-form.tsx) as a Form Builder form (owner
// request 2026-11-03): the same six sections, questions, labels, choices and "shown only when"
// rules, so CRM can use it from Forms Library and the author can then change it like any form.
//
// Where the CRM form showed one block in two places (products seen for a repair visit appear after
// "Did CRM approach to show new products?", which they depend on), the copy asks the block in each
// place and links both questions to the same CRM answer; only one is ever shown.
import { dropdownMasterForCrmOption, CRM_WALKIN_ENGAGEMENT, type CrmFormCopy } from "./crmForms.ts";
import type { FormFieldDefinition, FormOption, FormRule, FormSectionDefinition } from "./forms/types.ts";

type MasterChoice = Readonly<{ masterType: string; value: string; label: string }>;
type Question = Omit<FormFieldDefinition, "sortOrder">;

const VISIT_STATUSES = ["YES", "NO", "REPAIR_PLACED", "REPAIR_PICKUP", "ORDER_PLACED", "ORDER_PICKUP", "PRODUCT_EXCHANGE", "PRODUCT_RETURN", "STORE_VISIT", "PRICE_CALCULATION"] as const;
const REPAIR_OR_ORDER = ["REPAIR_PLACED", "REPAIR_PICKUP", "ORDER_PLACED", "ORDER_PICKUP", "PRODUCT_RETURN"] as const;
const coded = (codes: readonly string[]): FormOption[] => codes.map((code) => ({ value: code.toLowerCase(), label: code.replaceAll("_", " ") }));
const YES_NO = coded(["YES", "NO"]);
const OPTION_VALUE = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 190) || "option";

const eq = (fieldKey: string, value: string): FormRule => ({ kind: "predicate", fieldKey, operator: "equals", value });
const inList = (fieldKey: string, values: readonly string[]): FormRule => ({ kind: "predicate", fieldKey, operator: "in", value: values });
/** Every rule must hold; nested "all" groups are flattened so conditions stay shallow. */
const all = (...rules: FormRule[]): FormRule => {
  const flat = rules.flatMap((rule) => rule.kind === "all" && !rule.negate ? rule.rules : [rule]);
  return flat.length === 1 ? flat[0]! : { kind: "all", rules: flat };
};
const any = (...rules: FormRule[]): FormRule | undefined => rules.length === 0 ? undefined : rules.length === 1 ? rules[0] : { kind: "any", rules };

/**
 * @param lookups the CRM's Dropdown Master lists (get_crm_master_options), keyed by CRM list key
 * @param masters JewelOS Dropdown Master options, so questions read the same lists
 * @param year the first wedding year offered (the CRM form offers this year and the next ten)
 */
export function crmWalkinFormCopy(lookups: Readonly<Record<string, readonly string[]>>, masters: readonly MasterChoice[], year = new Date().getFullYear()): CrmFormCopy & { sections: FormSectionDefinition[] } {
  const masterTypes = new Set(masters.map((option) => option.masterType));
  const questions: Question[] = [];
  const fieldMap: Record<string, string | string[]> = {};
  const choiceValues = new Map<string, (label: string) => string | undefined>();

  const add = (target: string | null, question: Question) => {
    questions.push(question);
    if (!target) return;
    const existing = fieldMap[target];
    fieldMap[target] = existing === undefined ? question.key : [...(Array.isArray(existing) ? existing : [existing]), question.key];
  };
  /** A dropdown (or checkbox list) reading the CRM list: its Dropdown Master list, else the same choices typed in. */
  const choices = (listKey: string, key: string): Pick<Question, "options" | "optionSource"> | null => {
    const masterType = dropdownMasterForCrmOption(listKey, masterTypes);
    if (masterType) {
      choiceValues.set(key, (label) => masters.find((option) => option.masterType === masterType && option.label.trim().toUpperCase() === label.trim().toUpperCase())?.value);
      return { optionSource: { kind: "master", masterType } };
    }
    const seen = new Set<string>(); const used = new Set<string>();
    const options = (lookups[listKey] ?? []).filter((label) => { const upper = label.trim().toUpperCase(); if (!upper || seen.has(upper)) return false; seen.add(upper); return true; })
      .slice(0, 100).map((label) => { let value = OPTION_VALUE(label); for (let round = 2; used.has(value); round += 1) value = `${OPTION_VALUE(label)}_${round}`; used.add(value); return { value, label }; });
    if (!options.length) return null;
    choiceValues.set(key, (label) => options.find((option) => option.label.trim().toUpperCase() === label.trim().toUpperCase())?.value);
    return { options };
  };
  const staticChoice = (key: string, options: readonly FormOption[]) => {
    choiceValues.set(key, (label) => options.find((option) => option.label.toUpperCase() === label.toUpperCase().replaceAll("_", " ") || option.value === label.toLowerCase())?.value);
    return { options };
  };
  /** The stored values of a question's choices whose wording starts with a word (OTHER) or equals a phrase. */
  const valuesWhere = (key: string, test: (label: string) => boolean, labels: readonly string[]) => labels.filter(test).map((label) => choiceValues.get(key)?.(label)).filter((value): value is string => !!value);
  const labelsOf = (listKey: string) => {
    const masterType = dropdownMasterForCrmOption(listKey, masterTypes);
    return masterType ? masters.filter((option) => option.masterType === masterType).map((option) => option.label) : [...(lookups[listKey] ?? [])];
  };
  const otherRule = (key: string, listKey: string, multi = false): FormRule | undefined => {
    const values = valuesWhere(key, (label) => label.trim().toUpperCase().startsWith("OTHER"), labelsOf(listKey));
    return any(...values.map((value): FormRule => ({ kind: "predicate", fieldKey: key, operator: multi ? "contains" : "equals", value })));
  };
  const choiceQuestion = (target: string, key: string, label: string, listKey: string, extra: Partial<Question> = {}) => {
    const source = choices(listKey, key);
    add(target, source ? { key, label, type: "select", ...source, ...extra } : { key, label, type: "text", ...extra });
  };
  const text = (target: string, key: string, label: string, extra: Partial<Question> = {}) => add(target, { key, label, type: "text", ...extra });
  const heading = (key: string, label: string, sectionKey: string) => add(null, { key, label, type: "section_header", sectionKey });

  // CLIENT DETAILS
  let section = "client_details";
  add("event_date", { key: "event_date", label: "Visit date and time", type: "datetime", required: true, sectionKey: section });
  text("primary_name", "primary_name", "Client name", { required: true, sectionKey: section });
  add("primary_phone", { key: "primary_phone", label: "Mobile", type: "phone", required: true, sectionKey: section, helperText: "A number outside India starts with + and the country code." });
  choiceQuestion("source_of_lead", "source_of_lead", "Source of lead", "lookup_source_of_leads", { required: true, sectionKey: section });
  const reference = valuesWhere("source_of_lead", (label) => label.trim().toUpperCase() === "REFERENCE", labelsOf("lookup_source_of_leads"));
  const referenceRule = any(...reference.map((value) => eq("source_of_lead", value)));
  text("reference_name", "reference_name", "Reference name", { required: true, sectionKey: section, ...(referenceRule ? { rule: referenceRule } : {}) });
  text("reference_phone", "reference_phone", "Reference phone", { sectionKey: section, ...(referenceRule ? { rule: referenceRule } : {}) });
  const sourceOther = otherRule("source_of_lead", "lookup_source_of_leads");
  text("source_of_lead_other", "source_of_lead_other", "Source other", { sectionKey: section, ...(sourceOther ? { rule: sourceOther } : {}) });
  text("crm_name", "crm_name", "CRM / salesperson", { sectionKey: section });
  text("salesperson", "salesperson", "Salesperson attending the client", { required: true, sectionKey: section });
  heading("profile_heading", "CLIENT PROFILE & CONTACT", section);
  choiceQuestion("gender", "gender", "Gender", "gender", { required: true, sectionKey: section });
  add("billing_phone", { key: "billing_phone", label: "Billing phone", type: "phone", sectionKey: section, helperText: "Leave blank when it is the same as the mobile number." });
  text("country", "country", "Country", { required: true, sectionKey: section });
  text("state", "state", "State", { required: true, sectionKey: section });
  text("city", "city", "City", { required: true, sectionKey: section });
  text("city_other", "city_other", "City other", { sectionKey: section, rule: inList("city", ["OTHER", "Other", "other"]) });
  text("pincode", "pincode", "Pincode", { required: true, sectionKey: section });
  text("address", "address", "Address", { required: true, sectionKey: section });
  choiceQuestion("community", "community", "Community / caste", "lookup_communities", { required: true, sectionKey: section });
  const communityOther = otherRule("community", "lookup_communities");
  text("community_other", "community_other", "Community other", { sectionKey: section, ...(communityOther ? { rule: communityOther } : {}) });
  add("dob", { key: "dob", label: "Date of birth", type: "date", sectionKey: section });
  add("anniversary", { key: "anniversary", label: "Anniversary", type: "date", sectionKey: section });
  heading("planning_heading", "CLIENT PLANNING", section);
  choiceQuestion("occupation", "occupation", "Occupation", "occupation", { required: true, sectionKey: section });
  const occupationOther = valuesWhere("occupation", (label) => label.trim().toUpperCase() === "OTHER", labelsOf("occupation"));
  const occupationOtherRule = any(...occupationOther.map((value) => eq("occupation", value)));
  text("occupation_other", "occupation_other", "Occupation other", { required: true, sectionKey: section, ...(occupationOtherRule ? { rule: occupationOtherRule } : {}) });
  choiceQuestion("bridal_or_non_bridal", "bridal_or_non_bridal", "Bridal / non-bridal", "bridal_or_non_bridal", { required: true, sectionKey: section });
  const bridal = valuesWhere("bridal_or_non_bridal", (label) => label.trim().toUpperCase() === "BRIDAL", labelsOf("bridal_or_non_bridal"));
  const bridalRule = any(...bridal.map((value) => eq("bridal_or_non_bridal", value)));
  choiceQuestion("wedding_month", "wedding_month", "Wedding month", "wedding_month", { required: true, sectionKey: section, ...(bridalRule ? { rule: bridalRule } : {}) });
  const years = Array.from({ length: 11 }, (_, index) => String(year + index));
  add("wedding_year", { key: "wedding_year", label: "Wedding year", type: "select", required: true, sectionKey: section, ...staticChoice("wedding_year", years.map((value) => ({ value, label: value }))), ...(bridalRule ? { rule: bridalRule } : {}) });
  choiceQuestion("communication_preference", "communication_preference", "Communication preference", "communication_preference", { required: true, sectionKey: section });

  // FAMILY / FRIENDS WITH CLIENT
  section = "family";
  const relation = choices("lookup_relations", "companion_relation");
  add("companions", { key: "companions", label: "Family / friends with the client", type: "repeat", sectionKey: section, validation: { repeat: { countLabel: "How many family members / friends are with them?", min: 0, max: 10, fields: [
    { key: "name", label: "Name", type: "text" },
    { key: "mobile", label: "Mobile", type: "phone" },
    ...(relation ? [{ key: "relation", label: "Relation", type: "select" as const, ...relation }] : [{ key: "relation", label: "Relation", type: "text" as const }]),
  ] } } });

  // VISIT DETAILS
  section = "visit";
  add("visit_status", { key: "visit_status", label: "Client bought any product?", type: "select", required: true, sectionKey: section, ...staticChoice("visit_status", coded(VISIT_STATUSES)) });
  const status = (...codes: string[]) => inList("visit_status", codes.map((code) => code.toLowerCase()));
  const reasons = choices("lookup_not_bought_reasons", "not_bought_reasons");
  if (reasons) add("not_bought_reasons", { key: "not_bought_reasons", label: "Not-bought reasons", type: "checkbox", required: true, sectionKey: section, ...reasons, rule: eq("visit_status", "no") });
  const reasonOther = reasons ? otherRule("not_bought_reasons", "lookup_not_bought_reasons", true) : undefined;
  text("not_bought_other", "not_bought_other", "Other reason", { sectionKey: section, rule: reasonOther ? all(eq("visit_status", "no"), reasonOther) : eq("visit_status", "no") });

  const productBlock = (list: { categories: string; tags: string; other: string }, suffix: string, labels: { categories: string; count: string; other: string }, shown: FormRule, allowNa: boolean, extra: Partial<Question> = {}) => {
    const categoriesKey = `${list.categories}${suffix}`;
    const categories = choices("lookup_product_categories", categoriesKey);
    if (categories) add(list.categories, { key: categoriesKey, label: labels.categories, type: "checkbox", sectionKey: section, ...categories, rule: shown, ...extra });
    add(list.tags, { key: `${list.tags}${suffix}`, label: labels.count, type: "repeat", sectionKey: section, rule: shown, validation: { repeat: { countLabel: labels.count, min: 1, max: 10, ...(allowNa ? { allowNa: true } : {}), fields: [{ key: "tag", label: "Tag / code", type: "text" }] } } });
    const other = categories ? otherRule(categoriesKey, "lookup_product_categories", true) : undefined;
    text(list.other, `${list.other}${suffix}`, labels.other, { sectionKey: section, rule: other ? all(shown, other) : shown });
  };
  const seen = { categories: "seen_categories", tags: "seen_tags", other: "seen_other" };
  const seenLabels = { categories: "Product categories seen by the client", count: "Number of products client has seen", other: "Other (seen category)" };
  productBlock(seen, "", seenLabels, status("YES", "NO", "PRODUCT_EXCHANGE"), true);
  const bought = status("YES");
  productBlock({ categories: "bought_categories", tags: "bought_tags", other: "bought_other" }, "", { categories: "Bought product categories", count: "How many products did the client buy?", other: "Other (bought category)" }, bought, false);
  add("other_order", { key: "other_order", label: "Did the client make any other / new order?", type: "select", sectionKey: section, ...staticChoice("other_order", YES_NO), rule: bought });
  productBlock({ categories: "order_categories", tags: "order_tags", other: "order_other" }, "", { categories: "Order / new-things categories", count: "How many products in the order?", other: "Other (order category)" }, all(bought, eq("other_order", "yes")), false);

  const repair = status(...REPAIR_OR_ORDER);
  const cameFor = { categories: "came_for_categories", tags: "camefor_tags", other: "came_for_other" };
  productBlock(cameFor, "", { categories: "Product categories client came for", count: "Number of products client came for", other: "Other (came-for category)" }, repair, true);
  add("repair_or_order_approach", { key: "repair_or_order_approach", label: "Did CRM approach to show new products?", type: "select", sectionKey: section, ...staticChoice("repair_or_order_approach", YES_NO), rule: repair });
  const approached = all(repair, eq("repair_or_order_approach", "yes"));
  productBlock(seen, "_b", seenLabels, approached, true);
  add("new_things_choice", { key: "new_things_choice", label: "Is client buying / making order for new things?", type: "select", sectionKey: section, ...staticChoice("new_things_choice", coded(["BUYING_NEW_PRODUCT", "MAKING_NEW_ORDER", "NO"])), rule: approached });
  const buyingNew = all(approached, inList("new_things_choice", ["buying_new_product", "making_new_order"]));
  text("salesperson_handled", "salesperson_handled", "Salesperson attending new buy / order", { required: true, sectionKey: section, rule: buyingNew });
  const newThings = { categories: "new_things_categories", tags: "new_things_tags", other: "new_things_other" };
  const newLabels = { categories: "New buy / order categories", count: "Number of new products", other: "Other (new buy / order category)" };
  productBlock(newThings, "", newLabels, buyingNew, false);

  const exchange = status("PRODUCT_EXCHANGE");
  productBlock(cameFor, "_x", { categories: "Product categories client came for", count: "Number of products client came for", other: "Other (came for category)" }, exchange, true);
  text("salesperson_handled", "salesperson_handled_x", "Salesperson attending the client (new buy / order)", { required: true, sectionKey: section, rule: exchange });
  productBlock(newThings, "_x", newLabels, exchange, false);

  // CRM APPROACH (not asked for a store visit or a price calculation)
  section = "approach";
  add("marketing_message_sent", { key: "marketing_message_sent", label: "Marketing message", type: "radio", sectionKey: section, ...staticChoice("marketing_message_sent", YES_NO) });
  for (const ask of CRM_WALKIN_ENGAGEMENT) {
    const key = `engagement_${ask.key}`;
    add(key, { key, label: ask.label, type: "select", required: true, sectionKey: section, ...staticChoice(key, coded(ask.answers)) });
    text(`${key}_reason`, `${key}_reason`, `${ask.label} - no reason`, { sectionKey: section, rule: eq(key, "no"), placeholder: "Reason" });
    if (ask.key === "referrals") add("referrals", { key: "referrals", label: "Referrals", type: "repeat", sectionKey: section, rule: eq(key, "yes"), validation: { repeat: { countLabel: "How many referrals?", min: 1, max: 10, fields: [
      { key: "name", label: "Referral name", type: "text", required: true }, { key: "mobile", label: "Referral number", type: "phone", required: true },
    ] } } });
    add(`${key}_proof`, { key: `${key}_proof`, label: `${ask.label} proof image`, type: "crm_photo", required: true, sectionKey: section, rule: eq(key, "yes"), validation: { crm: { maxFiles: 1, ...(ask.key === "testimonial" ? { video: true } : {}) } } });
  }

  // PREFERENCES
  section = "preferences";
  for (const [target, label, listKey, otherLabel] of [["beverage", "Beverage", "lookup_beverages", "Other beverage"], ["sugar", "Sugar", "lookup_sugar_options", "Other sugar preference"], ["snack", "Snack", "lookup_snacks", "Other snack"], ["gift", "Gift given", "lookup_gifts", "Other gift"]] as const) {
    choiceQuestion(target, target, label, listKey, { sectionKey: section });
    const other = otherRule(target, listKey);
    text(`${target}_other`, `${target}_other`, otherLabel, { sectionKey: section, ...(other ? { rule: other } : {}) });
  }

  // REMARK
  section = "remark";
  add("next_visit_date", { key: "next_visit_date", label: "Next visit date", type: "date", required: true, sectionKey: section, rule: eq("visit_status", "no") });
  add("next_visit_date", { key: "next_visit_date_other", label: "Next visit date", type: "date", sectionKey: section, rule: { kind: "predicate", fieldKey: "visit_status", operator: "not_equals", value: "no" } });
  choiceQuestion("client_potential_category", "client_potential_category", "Client potential category", "client_potential_category", { sectionKey: section });
  text("high_potential_reason", "high_potential_reason", "Why high potential", { sectionKey: section });
  text("product_requirement", "product_requirement", "Product requirement", { sectionKey: section });
  text("other_store_client_wants_to_visit", "other_store_client_wants_to_visit", "Other store client wants to visit", { sectionKey: section });
  const moreDesigns = reasons ? valuesWhere("not_bought_reasons", (label) => label.trim().toUpperCase() === "WANT TO SEE MORE DESIGNS", labelsOf("lookup_not_bought_reasons")) : [];
  const wantsMore = choices("lookup_product_categories", "categories_client_wants_more");
  const moreRule = any(...moreDesigns.map((value): FormRule => ({ kind: "predicate", fieldKey: "not_bought_reasons", operator: "contains", value })));
  if (wantsMore && moreRule) add("categories_client_wants_more", { key: "categories_client_wants_more", label: "Which categories client wants to see more", type: "checkbox", sectionKey: section, ...wantsMore, rule: all(eq("visit_status", "no"), moreRule) });
  text("remark", "remark", "Remark", { sectionKey: section });
  add("remark_photos", { key: "remark_photos", label: "Upload photo (optional) — up to 10", type: "crm_photo", sectionKey: section, validation: { crm: { maxFiles: 10 } } });

  const sections: FormSectionDefinition[] = [
    { key: "client_details", title: "CLIENT DETAILS" },
    { key: "family", title: "FAMILY / FRIENDS WITH CLIENT" },
    { key: "visit", title: "VISIT DETAILS" },
    { key: "approach", title: "CRM APPROACH", visibility: "unless", rule: inList("visit_status", ["store_visit", "price_calculation"]) },
    { key: "preferences", title: "PREFERENCES" },
    { key: "remark", title: "REMARK" },
  ];
  return {
    name: "Client walk-in visit",
    description: "CRM → CLIENT QUEUE → the client's queue entry. Complete each section in order; conditional questions appear only when they apply.",
    sections,
    fields: questions.map((question, sortOrder) => ({ ...question, sortOrder })),
    fieldMap,
  };
}
