import { describe, expect, it } from "vitest";
import { formDefinitionForSection } from "../forms/sections";
import { validateCompleteForm } from "../forms/validation";
import type { FormTemplateDefinition } from "../forms/types";
import { normalizeFmsDefinition, validateFmsDefinition } from "./engine";
import { fmsFormQuestionIndex, fmsPlannedRuleFormSectionKey, fmsStageFormDefinition, fmsStageFormFields, validateFmsFormSections, type FmsFormFieldRow } from "./formSections";
import { fmsSourceQuestions, suggestFmsAssignment } from "./assignmentAuthoring";
import { simulateFmsDefinition } from "./simulation";
import type { FmsFlowDefinition, FmsStageDefinition } from "./types";

const SALES = "11111111-1111-4111-8111-111111111111";
const SALES_V2 = "22222222-2222-4222-8222-222222222222";
const ENQUIRY = "33333333-3333-4333-8333-333333333333";
const yesNo = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];
const row = (field_key: string, field_name: string, group_name: string | null, patch: Partial<FmsFormFieldRow> = {}): FmsFormFieldRow => ({
  form_template_id: SALES, field_key, field_name, field_type: "select", is_required: true, is_shown: true, conditional_logic: null, rule_definition: null, options: yesNo, option_source: null, dropdown_master_type: null, group_name, ...patch,
});
const salesSections = [{ key: "intro", title: "Introduction Call" }, { key: "demo", title: "Product Demonstration" }, { key: "negotiation", title: "Negotiation" }, { key: "closing", title: "Closing" }];
const rows: FmsFormFieldRow[] = [
  row("client_connected", "Client Connected?", "intro"),
  row("client_interested", "Client Interested?", "intro"),
  row("intro_header", "About the call", "intro", { field_type: "section_header", options: null }),
  row("client_budget", "Client Budget", "intro", { field_type: "number", is_required: false, options: null }),
  row("product_shown", "Product Shown?", "demo"),
  row("price_accepted", "Price Accepted?", "demo"),
  row("offer_accepted", "Final Offer Accepted?", "negotiation"),
  row("discount_note", "Discount requested", "negotiation", { field_type: "text", options: null, conditional_logic: { fieldKey: "offer_accepted", operator: "equals", value: "no" } }),
  row("order_confirmed", "Order Confirmed?", "closing"),
  row("follow_up_detail", "Follow-up detail", "closing", { field_type: "text", is_required: false, options: null, conditional_logic: { kind: "any", rules: [{ kind: "predicate", fieldKey: "client_interested", operator: "equals", value: "no" }, { kind: "predicate", fieldKey: "order_confirmed", operator: "equals", value: "no" }] } }),
  row("payment_status", "Payment Status", "retired_section"),
];
const index = fmsFormQuestionIndex(rows, [{ id: SALES, sections: salesSections }, { id: ENQUIRY, sections: [] }]);
const context = { formFields: { ...index.formFields, [ENQUIRY]: [{ key: "client_name", label: "Client name", type: "text", required: true }] }, formSections: index.formSections, availableFormIds: [SALES, SALES_V2, ENQUIRY] };

const stage = (key: string, patch: Partial<FmsStageDefinition> = {}): FmsStageDefinition => ({ key, name: key, type: "task", order: 0, required: true, completionRule: "any_doer", allowMultipleDoers: false, requiresUpload: false, requiresRemark: false, checklist: [], assigneeRules: [{ type: "specific_user", userProfileId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }], requiresNextDoerHandoff: false, canMoveBackward: false, canReject: false, canRequestRevision: false, canEscalate: false, branchRules: [], parallelTargetStageKeys: [], joinRequiredStageKeys: [], sla: { dueDate: "", deadlineEnabled: false }, ...patch });
const section = (formSectionKey: string, patch: Partial<FmsStageDefinition> = {}): Partial<FmsStageDefinition> => ({ formTemplateId: SALES, ...patch, sla: { dueDate: "", deadlineEnabled: false, formSectionKey, ...patch.sla } });
const flow = (stages: FmsStageDefinition[]): FmsFlowDefinition => ({ name: "Jewellery sales", scope: "tenant", manualTrigger: true, assignmentVersion: 1, stages: stages.map((item, order) => ({ ...item, order })) });
/** Introduction → Proposal → Negotiation → Closing, with Interested / Not Interested / Follow-up loop. */
const salesFlow = (introPatch: Partial<FmsStageDefinition> = {}) => flow([
  stage("initial", { type: "form", formTemplateId: ENQUIRY, defaultNextStageKey: "intro" }),
  stage("intro", section("intro", { name: "Introduction Call", defaultNextStageKey: "followup", branchRules: [{ id: "interested", source: "form_answer", sourceKey: "client_interested", operator: "equals", value: "yes", nextStageKey: "proposal", order: 0, label: "Interested" }], ...introPatch })),
  stage("proposal", section("demo", { name: "Proposal", defaultNextStageKey: "negotiation" })),
  stage("negotiation", section("negotiation", { name: "Negotiation", defaultNextStageKey: "closing" })),
  stage("closing", { name: "Closing" }),
  stage("followup", { name: "Follow-up", defaultNextStageKey: "intro" }),
]);

const salesForm: FormTemplateDefinition = {
  name: "Jewellery Sales Pipeline",
  sections: [{ ...salesSections[0]!, next: "closing" }, ...salesSections.slice(1)],
  fields: [
    { key: "client_connected", label: "Client Connected?", type: "select", sortOrder: 0, sectionKey: "intro", required: true, options: yesNo },
    { key: "client_interested", label: "Client Interested?", type: "select", sortOrder: 1, sectionKey: "intro", required: true, options: yesNo, branches: [{ operator: "equals", value: "no", targetSectionKey: "closing" }] },
    { key: "product_shown", label: "Product Shown?", type: "select", sortOrder: 2, sectionKey: "demo", required: true, options: yesNo },
    { key: "offer_accepted", label: "Final Offer Accepted?", type: "select", sortOrder: 3, sectionKey: "negotiation", required: true, options: yesNo },
    { key: "discount_note", label: "Discount requested", type: "text", sortOrder: 4, sectionKey: "negotiation", required: true, condition: { fieldKey: "offer_accepted", operator: "equals", value: "no" } },
    { key: "order_confirmed", label: "Order Confirmed?", type: "select", sortOrder: 5, sectionKey: "closing", required: true, options: yesNo },
  ],
};

describe("FMS form section metadata", () => {
  it("lists a Form's sections in order with their answerable question counts", () => {
    expect(index.formSections[SALES]).toEqual([
      { key: "intro", title: "Introduction Call", questionCount: 4 },
      { key: "demo", title: "Product Demonstration", questionCount: 2 },
      { key: "negotiation", title: "Negotiation", questionCount: 2 },
      { key: "closing", title: "Closing", questionCount: 2 },
    ]);
    expect(index.formSections[ENQUIRY]).toBeUndefined();
  });
  it("assigns questions to sections the way the database does and keeps stable keys and option values", () => {
    const fields = index.formFields[SALES]!;
    expect(fields.map((field) => field.key)).not.toContain("intro_header");
    expect(fields.find((field) => field.key === "payment_status")?.sectionKey).toBe("intro");
    expect(fields.find((field) => field.key === "client_interested")).toMatchObject({ sectionKey: "intro", optionValues: ["yes", "no"], options: yesNo });
    expect(fields.find((field) => field.key === "discount_note")?.dependsOn).toEqual(["offer_accepted"]);
    expect(fields.find((field) => field.key === "follow_up_detail")?.dependsOn).toEqual(["client_interested", "order_confirmed"]);
  });
  it("keeps a renamed question or option on the same stable key", () => {
    const renamed = fmsFormQuestionIndex([row("client_interested", "Is the client keen?", "intro", { options: [{ value: "yes", label: "Keen" }, { value: "no", label: "Not keen" }] })], [{ id: SALES, sections: salesSections }]);
    expect(renamed.formFields[SALES]![0]).toMatchObject({ key: "client_interested", optionValues: ["yes", "no"] });
    expect(validateFmsFormSections(salesFlow(), { ...context, formFields: { ...context.formFields, [SALES]: [...renamed.formFields[SALES]!, ...index.formFields[SALES]!.filter((field) => field.key !== "client_interested")] } })).toEqual([]);
  });
  it("filters a stage's questions to its section and keeps Entire Form unchanged", () => {
    expect(fmsStageFormFields(stage("intro", section("intro")), index.formFields).map((field) => field.key)).toEqual(["client_connected", "client_interested", "client_budget", "payment_status"]);
    expect(fmsStageFormFields(stage("demo", section("demo")), index.formFields).map((field) => field.key)).toEqual(["product_shown", "price_accepted"]);
    expect(fmsStageFormFields(stage("whole", { formTemplateId: SALES }), index.formFields)).toHaveLength(index.formFields[SALES]!.length);
    expect(fmsStageFormFields(stage("none"), index.formFields)).toEqual([]);
  });
  it("reads a stored stage's section without trusting malformed configuration", () => {
    expect(fmsPlannedRuleFormSectionKey({ formSectionKey: " intro " })).toBe("intro");
    expect(fmsPlannedRuleFormSectionKey({ formSectionKey: "" })).toBeUndefined();
    expect(fmsPlannedRuleFormSectionKey([])).toBeUndefined();
    expect(fmsPlannedRuleFormSectionKey(null)).toBeUndefined();
  });
  it("offers only the section's User questions as later-step owners", () => {
    const users = fmsFormQuestionIndex([row("owner", "Owner", "intro", { field_type: "user_dropdown", options: null }), row("closer", "Closer", "closing", { field_type: "user_dropdown", options: null })], [{ id: SALES, sections: salesSections }]).formFields;
    const intro = stage("intro", section("intro"));
    expect(fmsSourceQuestions([intro], users, "next").map((item) => item.source.fieldKey)).toEqual(["owner"]);
    expect(suggestFmsAssignment(intro, users).sources).toEqual([{ sourceStageKey: "intro", formTemplateId: SALES, fieldKey: "owner" }]);
  });
});

describe("FMS section persistence", () => {
  it("survives normalization, save and reload, and copies", () => {
    const normalized = normalizeFmsDefinition(salesFlow());
    const reloaded = normalizeFmsDefinition(JSON.parse(JSON.stringify(normalized)) as FmsFlowDefinition);
    expect(reloaded.stages.map((item) => item.sla.formSectionKey)).toEqual([undefined, "intro", "demo", "negotiation", undefined, undefined]);
    expect(normalizeFmsDefinition({ ...reloaded, name: "Copy", id: undefined }).stages[1]?.sla.formSectionKey).toBe("intro");
  });
  it("treats an empty selection as the legacy Entire Form", () => {
    expect(normalizeFmsDefinition(flow([stage("a", { sla: { dueDate: "", formSectionKey: "  " } })])).stages[0]?.sla.formSectionKey).toBeUndefined();
  });
});

describe("FMS section publish readiness", () => {
  it("accepts one Form reused by several stages with different sections", () => {
    expect(validateFmsDefinition(salesFlow(), context)).toEqual([]);
  });
  it("keeps the starting Form on the entire Form", () => {
    const definition = salesFlow();
    const issues = validateFmsFormSections({ ...definition, stages: definition.stages.map((item, i) => i === 0 ? { ...item, sla: { ...item.sla, formSectionKey: "intro" } } : item) }, context);
    expect(issues.map((issue) => issue.code)).toEqual(["section_on_trigger"]);
  });
  it("reports a section without a Form and a section missing from the pinned version", () => {
    expect(validateFmsFormSections(salesFlow({ formTemplateId: undefined }), context).map((issue) => issue.code)).toContain("section_without_form");
    expect(validateFmsFormSections(salesFlow({ sla: { dueDate: "", deadlineEnabled: false, formSectionKey: "retired" } }), context).map((issue) => issue.code)).toEqual(["missing_form_section"]);
  });
  it("flags a route question outside the section instead of dropping the route", () => {
    const issues = validateFmsFormSections(salesFlow({ sla: { dueDate: "", deadlineEnabled: false, formSectionKey: "demo" } }), context);
    expect(issues).toEqual([expect.objectContaining({ code: "route_field_outside_section", stageKey: "intro", message: expect.stringContaining('"Interested" uses "Client Interested?"') })]);
  });
  it("names a conditional question whose dependency lives in another section", () => {
    const definition = salesFlow();
    const issues = validateFmsFormSections({ ...definition, stages: definition.stages.map((item) => item.key === "negotiation" ? { ...item, sla: { ...item.sla, formSectionKey: "closing" } } : item) }, context);
    expect(issues).toEqual([expect.objectContaining({ code: "external_section_dependency", stageKey: "negotiation", message: expect.stringContaining('"Follow-up detail" is shown only depending on "Client Interested?"') })]);
  });
  it("flags a later step that reads a question the source section never asks", () => {
    const definition = salesFlow();
    const issues = validateFmsFormSections({ ...definition, stages: definition.stages.map((item) => item.key === "closing" ? { ...item, sla: { ...item.sla, taskDisplay: { fields: [{ sourceStageKey: "proposal", formTemplateId: SALES, fieldKey: "client_budget" }] } } } : item) }, context);
    expect(issues.map((issue) => [issue.code, issue.stageKey])).toEqual([["source_field_outside_section", "closing"]]);
  });
  it("checks the section and questions again after an explicit Form version upgrade", () => {
    const v2 = fmsFormQuestionIndex([row("connected", "Client Connected?", "intro_call", { form_template_id: SALES_V2 })], [{ id: SALES_V2, sections: [{ key: "intro_call", title: "Introduction Call" }] }]);
    const upgraded = salesFlow({ formTemplateId: SALES_V2 });
    const issues = validateFmsDefinition(upgraded, { ...context, formFields: { ...context.formFields, ...v2.formFields }, formSections: { ...context.formSections, ...v2.formSections } });
    expect(issues).toContainEqual(expect.objectContaining({ code: "missing_form_section", stageKey: "intro" }));
    const sameSection = fmsFormQuestionIndex([row("connected", "Client Connected?", "intro", { form_template_id: SALES_V2 })], [{ id: SALES_V2, sections: [{ key: "intro", title: "Introduction Call" }] }]);
    const routeIssues = validateFmsDefinition(upgraded, { ...context, formFields: { ...context.formFields, ...sameSection.formFields }, formSections: { ...context.formSections, ...sameSection.formSections } });
    expect(routeIssues).toContainEqual(expect.objectContaining({ code: "route_field_missing", stageKey: "intro" }));
  });
});

describe("FMS section execution", () => {
  it("renders and validates only the selected section and never navigates into other sections", () => {
    const intro = formDefinitionForSection(salesForm, "intro")!;
    expect(intro.sections).toEqual([{ key: "intro", title: "Introduction Call" }]);
    expect(intro.fields.map((field) => field.key)).toEqual(["client_connected", "client_interested"]);
    expect(intro.fields.some((field) => field.branches)).toBe(false);
    expect(validateCompleteForm(intro, { client_connected: "yes", client_interested: "no" }).valid).toBe(true);
    expect(validateCompleteForm(intro, { client_connected: "yes" }).issues.map((issue) => issue.fieldKey)).toEqual(["client_interested"]);
    expect(validateCompleteForm(intro, { client_connected: "yes", client_interested: "no", product_shown: "yes" }).issues.map((issue) => issue.code)).toEqual(["unknown_answer"]);
    expect(formDefinitionForSection(salesForm, "missing")).toBeUndefined();
  });
  it("keeps conditional questions inside the section and Entire Form unchanged", () => {
    const negotiation = fmsStageFormDefinition(stage("n", section("negotiation")), salesForm)!;
    expect(validateCompleteForm(negotiation, { offer_accepted: "yes" }).valid).toBe(true);
    expect(validateCompleteForm(negotiation, { offer_accepted: "no" }).issues.map((issue) => issue.fieldKey)).toEqual(["discount_note"]);
    expect(fmsStageFormDefinition(stage("whole", { formTemplateId: SALES }), salesForm)).toBe(salesForm);
    expect(validateCompleteForm(salesForm, { client_connected: "yes", client_interested: "yes" }).valid).toBe(false);
  });
  it("routes Interested to Proposal, Not Interested to Follow-up, and loops Follow-up to a fresh Introduction visit", () => {
    const result = simulateFmsDefinition(salesFlow(), {
      starterId: "A",
      forms: { [SALES]: salesForm, [ENQUIRY]: { name: "Enquiry", fields: [{ key: "client_name", label: "Client name", type: "text", sortOrder: 0, required: true }] } },
      answers: {
        initial: [{ client_name: "Synthetic client" }],
        intro: [{ client_connected: "yes", client_interested: "no" }, { client_connected: "yes", client_interested: "yes" }],
        proposal: [{ product_shown: "yes" }],
        negotiation: [{ offer_accepted: "yes" }],
      },
    });
    expect(result.events.map((event) => `${event.stageKey}:${event.visit}:${event.status}`)).toEqual([
      "initial:1:simulated", "intro:1:simulated", "followup:1:simulated", "intro:2:simulated", "proposal:1:simulated", "negotiation:1:simulated", "closing:1:simulated",
    ]);
    expect(result.events[3]?.answers).toEqual({ client_connected: "yes", client_interested: "yes" });
  });
  it("waits on a section stage only for that section's missing answers", () => {
    const result = simulateFmsDefinition(salesFlow(), { starterId: "A", forms: { [SALES]: salesForm }, answers: { initial: [{}], intro: [{ client_connected: "yes" }] } });
    expect(result.events.find((event) => event.stageKey === "intro")).toMatchObject({ status: "waiting", note: "Client Interested? is required" });
  });
});
