import { describe, expect, it } from "vitest";
import { CRM_WALKIN_TARGETS, checkCrmFormBinding, crmLinkedQuestions } from "./crmForms";
import { crmWalkinFormCopy } from "./crmWalkinFormCopy";
import { validateFormDefinition } from "./forms/definition";
import { validateCompleteForm } from "./forms/validation";
import { resolveFormOptions } from "./forms/options";

// The CRM's lists (get_crm_master_options) and some of them as JewelOS Dropdown Master lists.
const lookups = {
  lookup_source_of_leads: ["WALK-IN", "REFERENCE", "OTHERS"],
  lookup_communities: ["HINDU", "OTHER"],
  lookup_relations: ["WIFE", "FRIEND"],
  lookup_product_categories: ["RINGS", "CHAINS", "OTHER"],
  lookup_not_bought_reasons: ["PRICE", "WANT TO SEE MORE DESIGNS", "OTHER"],
  lookup_beverages: ["TEA", "OTHER"], lookup_sugar_options: ["NO SUGAR"], lookup_snacks: ["BISCUIT"], lookup_gifts: ["COIN", "OTHER GIFT"],
  gender: ["MALE", "FEMALE"], occupation: ["DOCTOR", "OTHER"], bridal_or_non_bridal: ["BRIDAL", "NON BRIDAL"],
  wedding_month: ["January", "February"], communication_preference: ["CALL", "WHATSAPP MESSAGE"], client_potential_category: ["High", "Low"],
};
const masters = [
  { masterType: "crm_source", value: "walk_in", label: "Walk-in" }, { masterType: "crm_source", value: "reference", label: "Reference" }, { masterType: "crm_source", value: "others", label: "Others" },
  { masterType: "product_category", value: "rings", label: "Rings" }, { masterType: "product_category", value: "other", label: "Other" },
  { masterType: "not_bought_reason", value: "price", label: "Price" }, { masterType: "not_bought_reason", value: "more", label: "Want to see more designs" }, { masterType: "not_bought_reason", value: "other", label: "Other" },
];

describe("the walk-in visit as a Form Builder form", () => {
  const copy = crmWalkinFormCopy(lookups, masters, 2026);
  const definition = { name: copy.name, sections: copy.sections, fields: copy.fields };

  it("is a valid form with the CRM form's six sections, in order", () => {
    expect(validateFormDefinition(definition)).toEqual([]);
    expect(copy.sections.map((section) => section.title)).toEqual(["CLIENT DETAILS", "FAMILY / FRIENDS WITH CLIENT", "VISIT DETAILS", "CRM APPROACH", "PREFERENCES", "REMARK"]);
    expect(copy.sections[3]).toMatchObject({ visibility: "unless" });
  });

  it("links every question to a walk-in CRM answer, including the questions asked in two places", () => {
    expect(checkCrmFormBinding(definition, copy.fieldMap, CRM_WALKIN_TARGETS)).toEqual([]);
    expect(crmLinkedQuestions(copy.fieldMap, "seen_categories")).toEqual(["seen_categories", "seen_categories_b"]);
    expect(crmLinkedQuestions(copy.fieldMap, "salesperson_handled")).toEqual(["salesperson_handled", "salesperson_handled_x"]);
    expect(crmLinkedQuestions(copy.fieldMap, "next_visit_date")).toEqual(["next_visit_date", "next_visit_date_other"]);
    const answered = new Set(Object.values(copy.fieldMap).flat());
    const unlinked = copy.fields.filter((field) => field.type !== "section_header" && !answered.has(field.key)).map((field) => field.key);
    expect(unlinked).toEqual([]);
  });

  it("keeps the CRM form's labels, required answers and lists, with no per-question settings", () => {
    const byKey = new Map(copy.fields.map((field) => [field.key, field]));
    expect(byKey.get("primary_phone")).toMatchObject({ label: "Mobile", type: "phone", required: true });
    expect(copy.fields.filter((field) => field.validation?.width !== undefined || (field.validation?.crm && (field.validation.crm.lookup || field.validation.crm.choices)))).toEqual([]);
    expect(byKey.get("salesperson")).toMatchObject({ type: "text", required: true });
    expect(byKey.get("source_of_lead")?.optionSource).toEqual({ kind: "master", masterType: "crm_source" });
    expect(byKey.get("gender")?.options).toEqual([{ value: "male", label: "MALE" }, { value: "female", label: "FEMALE" }]);
    expect(byKey.get("visit_status")?.options?.map((option) => option.label)).toEqual(["YES", "NO", "REPAIR PLACED", "REPAIR PICKUP", "ORDER PLACED", "ORDER PICKUP", "PRODUCT EXCHANGE", "PRODUCT RETURN", "STORE VISIT", "PRICE CALCULATION"]);
    expect(byKey.get("wedding_year")?.options?.[0]).toEqual({ value: "2026", label: "2026" });
    expect(byKey.get("companions")?.validation?.repeat).toMatchObject({ countLabel: "How many family members / friends are with them?", min: 0, max: 10 });
    expect(byKey.get("engagement_testimonial_proof")).toMatchObject({ type: "crm_photo", required: true, validation: { crm: { video: true, maxFiles: 1 } } });
    expect(byKey.get("remark_photos")?.validation?.crm?.maxFiles).toBe(10);
  });

  it("asks only what applies: a Not Bought visit needs reasons and the next visit date; a store visit skips CRM APPROACH", () => {
    const resolved = resolveFormOptions(definition, masters);
    const base = {
      event_date: "2026-11-04T11:00", primary_name: "Asha", primary_phone: "9876543210", source_of_lead: "walk_in", salesperson: "Priya", gender: "female",
      country: "India", state: "Kerala", city: "Kochi", pincode: "682001", address: "MG Road", community: "hindu", occupation: "doctor", bridal_or_non_bridal: "non_bridal", communication_preference: "call",
    };
    const storeVisit = validateCompleteForm(resolved, { ...base, visit_status: "store_visit" });
    expect(storeVisit.issues).toEqual([]);
    const notBought = validateCompleteForm(resolved, { ...base, visit_status: "no" });
    const missing = notBought.issues.map((issue) => issue.fieldKey);
    expect(missing).toEqual(expect.arrayContaining(["not_bought_reasons", "next_visit_date", "engagement_instagram"]));
    expect(missing).not.toContain("next_visit_date_other");
    const reference = validateCompleteForm(resolved, { ...base, source_of_lead: "reference", visit_status: "store_visit" });
    expect(reference.issues.map((issue) => issue.fieldKey)).toEqual(["reference_name"]);
  });
});
