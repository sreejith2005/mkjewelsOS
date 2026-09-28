import { normalizeFormDefinition } from "./definition";
import type { FormBranch, FormFieldDefinition, FormOption, FormSectionDefinition, FormTemplateDefinition } from "./types";

export const WORK_UPLOAD_FORM_NAME = "MK JEWELS – WORK AND UPLOAD FORM";

const options = (...labels: readonly string[]): readonly FormOption[] => labels.map((label) => ({ value: label, label }));
const namedOptions = (...items: readonly (readonly [string, string])[]): readonly FormOption[] => items.map(([value, label]) => ({ value, label }));
const routes = (...items: readonly (readonly [string, string])[]): readonly FormBranch[] => items.map(([value, targetSectionKey]) => ({ operator: "equals", value, targetSectionKey }));
const sections: readonly FormSectionDefinition[] = [
  { key: "basic", title: "BASIC / WORK STAGE" },
  { key: "interaction", title: "INTERACTION MEETING" },
  { key: "interested", title: "INTERESTED CUSTOMER QUESTIONS", next: "remark" },
  { key: "demo", title: "DEMO CALL STATUS (WHAT HAPPENED)" },
  { key: "product_checklist", title: "PROPOSAL PRODUCT DEMONSTRATION & NEGOTIATIONS – MASTER CHECK FOR SALES PERSON" },
  { key: "order_method", title: "ORDER METHOD", next: "liked_product" },
  { key: "liked_product", title: "CUSTOMER LIKED PRODUCT / IMAGE UPLOAD", next: "remark" },
  { key: "lead_closer", title: "LEAD CLOSER" },
  { key: "no_call", title: "NO CALL", description: "No call was completed. Continue to the remark.", next: "remark" },
  { key: "remark", title: "REMARK", next: "__submit__" },
  { key: "tag_no", title: "ORDER CLOSE (TAG NO)", next: "__submit__" },
];

const fields: readonly FormFieldDefinition[] = [
  { key: "reference_number", label: "REFERENCE NUMBER", type: "text", sectionKey: "basic", sortOrder: 0, required: true },
  { key: "work_stage", label: "WORK STAGE", type: "select", sectionKey: "basic", sortOrder: 1, required: true,
    options: namedOptions(
      ["introduction", "2. INTRODUCTION CALL"], ["proposal", "3. PROPOSAL PRODUCT DEMONSTRATION"],
      ["negotiation", "4. NEGOTIATION"], ["closer", "5. CLOSER"],
    ), branches: routes(["introduction", "interaction"], ["proposal", "demo"], ["negotiation", "demo"], ["closer", "lead_closer"]) },
  { key: "crm_follow_up", label: "NAME OF CRM FOLLOWING UP WITH CLIENT", type: "user_dropdown", sectionKey: "interaction", sortOrder: 2 },
  { key: "call_status", label: "CALL STATUS (WHAT HAPPENED)", type: "select", sectionKey: "interaction", sortOrder: 3, required: true,
    options: namedOptions(
      ["interested", "YES (INTERESTED)"], ["follow_up", "INTERESTED FOLLOW-UP REQUESTED"],
      ["no", "NO"], ["busy", "BUSY"], ["not_reachable", "NOT REACHABLE"],
      ["declined", "CUSTOMER DECLINED"], ["not_interested", "NOT INTERESTED CLOSE THIS LEAD"],
      ["price_inquiry", "PRICE INQUIRY – CLIENT WILL..."],
    ), branches: routes(
      ["interested", "interested"], ["follow_up", "remark"], ["no", "no_call"],
      ["busy", "no_call"], ["not_reachable", "no_call"], ["declined", "no_call"],
      ["not_interested", "remark"], ["price_inquiry", "interested"],
    ) },
  { key: "first_enquiry_questions", label: "DID YOU ASK BELOW QUESTIONS TO CLIENT? (First-Time Enquiries on Instagram)", type: "checkbox", sectionKey: "interested", sortOrder: 4, required: true,
    options: options("What price range are you looking for?", "For which occasion are you shopping?", "Is it for personal use or a gifting purpose?", "What kind of jewellery are you interested in? (Rings, bracelets, necklace, bangles, etc.)", "NA") },
  { key: "more_options_questions", label: "DID YOU ASK BELOW QUESTIONS TO CLIENT? (If Customer Requests to See More Options)", type: "checkbox", sectionKey: "interested", sortOrder: 5, required: true,
    helperText: "To curate the best options for you, please share:",
    options: options("Which product are you looking for? (Ring, necklace, earrings, bracelet, etc.)", "What is your preferred price range?", "Design preference – Colour stone or Plain?", "Material preference – Diamond, CZ, Gold, or Polki?", "Would you like to explore more options on a video call?", "NA") },
  { key: "appointment_type", label: "TYPE OF APPOINTMENT", type: "radio", sectionKey: "interested", sortOrder: 6,
    options: namedOptions(["store", "STORE VISIT"], ["online", "ONLINE VIDEO CALL APPOINTMENT"], ["na", "NA"]) },
  { key: "appointment_at", label: "THE ONLINE VIDEO CALL APPOINTMENT IS SET FOR", type: "datetime", sectionKey: "interested", sortOrder: 7, required: true,
    condition: { fieldKey: "appointment_type", operator: "equals", value: "online" } },
  { key: "sales_person", label: "ASSIGNED TO SALES PERSON", type: "user_dropdown", sectionKey: "interested", sortOrder: 8 },
  { key: "demo_status", label: "DEMO CALL STATUS (WHAT HAPPENED)", type: "select", sectionKey: "demo", sortOrder: 9, required: true,
    options: namedOptions(
      ["done", "DEMO CALL DONE"], ["follow_up", "INTERESTED FOLLOW-UP REQUESTED"],
      ["no", "NO"], ["busy", "BUSY"], ["not_reachable", "NOT REACHABLE"],
      ["declined", "CUSTOMER DECLINED"], ["not_interested", "NOT INTERESTED CLOSE THIS LEAD"],
      ["another_call", "CLIENT REQUESTED ANOTHER..."],
    ), branches: routes(
      ["done", "product_checklist"], ["follow_up", "remark"], ["no", "no_call"],
      ["busy", "no_call"], ["not_reachable", "no_call"], ["declined", "no_call"],
      ["not_interested", "remark"], ["another_call", "remark"],
    ) },
  { key: "demonstration_checklist", label: "CHECKLIST", type: "checkbox", sectionKey: "product_checklist", sortOrder: 10,
    options: options("PRODUCT SHOWN PROPERLY (360° VIEW)", "DETAILS EXPLAINED (PURITY / WEIGHT / DIAMOND QUALITY)", "DIFFERENT OPTIONS SHOWN (MIN 3 TO 5 DESIGNS)", "ACTUAL SIZE / FIT EXPLAINED", "DESIGN COMPARISON EXPLAINED", "MAKING CHARGES EXPLAINED", "DIAMOND QUALITY & CERTIFICATION EXPLAINED", "GOLD RATE & PURITY EXPLAINED", "CUSTOMIZATION POSSIBILITIES DISCUSSED", "DELIVERY TIME DISCUSSED", "AFTER-SALES SERVICE EXPLAINED", "NA") },
  { key: "product_outcome", label: "SALES OUTCOME", type: "radio", sectionKey: "product_checklist", sortOrder: 11, required: true,
    options: namedOptions(["bought", "YES, THE CLIENT BOUGHT THE PRODUCT"], ["pending", "DECISION PENDING"], ["not_interested", "NOT INTERESTED CLOSE THIS LEAD"]),
    branches: routes(["bought", "order_method"], ["pending", "remark"], ["not_interested", "remark"]) },
  { key: "order_method", label: "HOW WILL THE CLIENT PLACE THE ORDER?", type: "radio", sectionKey: "order_method", sortOrder: 12, required: true,
    options: namedOptions(["online", "ORDER WILL BE PLACED ONLINE"], ["store", "CLIENT WILL VISIT THE STORE"]) },
  { key: "liked_product_image_1", label: "IF CUSTOMER LIKED A PRODUCT, LOAD IMAGES HERE (1)", type: "file", sectionKey: "liked_product", sortOrder: 13 },
  { key: "liked_product_image_2", label: "PRODUCT IMAGE (2)", type: "file", sectionKey: "liked_product", sortOrder: 14 },
  { key: "liked_product_image_3", label: "PRODUCT IMAGE (3)", type: "file", sectionKey: "liked_product", sortOrder: 15 },
  { key: "billing_name", label: "Billing Name", type: "text", sectionKey: "lead_closer", sortOrder: 16, required: true },
  { key: "billing_number", label: "Billing Number", type: "phone", sectionKey: "lead_closer", sortOrder: 17, required: true },
  { key: "closer_status", label: "STATUS", type: "radio", sectionKey: "lead_closer", sortOrder: 18, required: true,
    options: namedOptions(["order_close", "ORDER CLOSE"], ["enquiry_close", "ENQUIRY CLOSE"]),
    branches: routes(["order_close", "tag_no"], ["enquiry_close", "remark"]) },
  { key: "callback_at", label: "IF THE CLIENT REQUESTS A CALL AT A LATER TIME, PLEASE NOTE THE SCHEDULED DATE AND TIME", type: "datetime", sectionKey: "remark", sortOrder: 19, required: true,
    rule: { kind: "any", rules: [
      { kind: "predicate", fieldKey: "call_status", operator: "equals", value: "follow_up" },
      { kind: "predicate", fieldKey: "demo_status", operator: "in", value: ["follow_up", "another_call"] },
    ] } },
  { key: "remark", label: "REMARK", type: "textarea", sectionKey: "remark", sortOrder: 20 },
  { key: "tag_no", label: "TAG NO", type: "text", sectionKey: "tag_no", sortOrder: 21, required: true },
  { key: "order_remark", label: "REMARK", type: "textarea", sectionKey: "tag_no", sortOrder: 22, required: true },
];

export const workUploadFormDefinition: FormTemplateDefinition = normalizeFormDefinition({
  name: WORK_UPLOAD_FORM_NAME,
  description: "Sales follow-up, demonstration, and closing work update.",
  sections,
  fields,
  permissions: { roles: ["super_admin", "admin", "manager", "crm", "staff"] },
});

/** Stable field keys keep step navigation when an author renames or revises this form. */
export function isWorkUploadForm(definition: FormTemplateDefinition): boolean {
  const keys = new Set(definition.fields.map((field) => field.key));
  return ["reference_number", "work_stage", "call_status", "demo_status", "closer_status", "tag_no"].every((key) => keys.has(key));
}
