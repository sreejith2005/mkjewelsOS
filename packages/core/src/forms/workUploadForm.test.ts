import { describe, expect, it } from "vitest";
import { normalizeFormAnswers, validateCompleteForm, validateFormDefinition } from "./index";
import { isWorkUploadForm, workUploadFormDefinition } from "./workUploadForm";
import { nextFormStepKey, previousFormStepKey, updateVisibleFormAnswers, validateFormStep } from "./stepNavigation";

const form = workUploadFormDefinition;
const path = (answers: Record<string, string | readonly string[]>) => {
  const route: string[] = ["basic"];
  while (true) {
    const next = nextFormStepKey(form, answers, route.at(-1)!);
    if (!next) return route;
    route.push(next);
  }
};

describe("MK Jewels work and upload form", () => {
  it("uses the saved Forms definition and only opts this form into steps", () => {
    expect(isWorkUploadForm(form)).toBe(true);
    expect(isWorkUploadForm({ name: "Other", fields: [] })).toBe(false);
    expect(validateFormDefinition(form)).toEqual([]);
  });

  it.each([
    [{ work_stage: "introduction", call_status: "interested" }, ["basic", "interaction", "interested", "remark"]],
    [{ work_stage: "introduction", call_status: "busy" }, ["basic", "interaction", "no_call", "remark"]],
    [{ work_stage: "proposal", demo_status: "done" }, ["basic", "demo", "product_checklist"]],
    [{ work_stage: "negotiation", demo_status: "done" }, ["basic", "demo", "product_checklist"]],
    [{ work_stage: "proposal", demo_status: "not_reachable" }, ["basic", "demo", "no_call", "remark"]],
    [{ work_stage: "proposal", demo_status: "done", product_outcome: "bought" }, ["basic", "demo", "product_checklist", "order_method", "liked_product", "remark"]],
    [{ work_stage: "closer", closer_status: "order_close" }, ["basic", "lead_closer", "tag_no"]],
    [{ work_stage: "closer", closer_status: "enquiry_close" }, ["basic", "lead_closer", "remark"]],
  ] as const)("routes %j through %j", (answers, expected) => {
    expect(path(answers)).toEqual(expected);
    expect(previousFormStepKey(form, answers, expected.at(-1)!)).toBe(expected.at(-2));
  });

  it("drops a tag when order close changes to enquiry close", () => {
    const before = { work_stage: "closer", closer_status: "order_close", tag_no: "ABC123" };
    expect(updateVisibleFormAnswers(form, before, "closer_status", "enquiry_close")).not.toHaveProperty("tag_no");
    expect(normalizeFormAnswers(form, { ...before, closer_status: "enquiry_close" })).not.toHaveProperty("tag_no");
  });

  it("drops all answers from a former work-stage branch", () => {
    const before = { reference_number: "REF-2", work_stage: "proposal", demo_status: "done", product_outcome: "bought", order_method: "online", liked_product_image_1: "file-id" };
    expect(updateVisibleFormAnswers(form, before, "work_stage", "closer")).toEqual({ reference_number: "REF-2", work_stage: "closer" });
  });

  it("drops online appointment details when appointment changes", () => {
    const before = { work_stage: "introduction", call_status: "interested", appointment_type: "online", appointment_at: "2026-10-01T12:00" };
    expect(updateVisibleFormAnswers(form, before, "appointment_type", "store")).not.toHaveProperty("appointment_at");
  });

  it("keeps spaces while typing and still clears newly hidden answers", () => {
    expect(updateVisibleFormAnswers(form, {}, "reference_number", "REF 1 ")).toHaveProperty("reference_number", "REF 1 ");
  });

  it("prefills a newly reached staff field after the first step is answered", () => {
    const defaults = { crm_follow_up: "profile-id" };
    const afterReference = updateVisibleFormAnswers(form, defaults, "reference_number", "REF 5", defaults);
    expect(afterReference).not.toHaveProperty("crm_follow_up");
    expect(updateVisibleFormAnswers(form, afterReference, "work_stage", "introduction", defaults)).toHaveProperty("crm_follow_up", "profile-id");
  });

  it("validates only the current step before Next", () => {
    expect(validateFormStep(form, { reference_number: "REF-1", work_stage: "closer" }, "basic").valid).toBe(true);
    expect(validateFormStep(form, { work_stage: "closer" }, "basic").issues[0]?.fieldKey).toBe("reference_number");
    expect(validateFormStep(form, { work_stage: "closer", closer_status: "order_close" }, "tag_no").issues.map((issue) => issue.fieldKey)).toEqual(["tag_no", "order_remark"]);
  });

  it("requires the online appointment and follow-up callback only on their relevant routes", () => {
    const appointment = { reference_number: "REF-3", work_stage: "introduction", call_status: "interested", first_enquiry_questions: ["NA"], more_options_questions: ["NA"], appointment_type: "online" };
    expect(validateFormStep(form, appointment, "interested").issues.map((issue) => issue.fieldKey)).toContain("appointment_at");
    expect(validateFormStep(form, { ...appointment, appointment_type: "store" }, "interested").issues.map((issue) => issue.fieldKey)).not.toContain("appointment_at");
    const followUp = { reference_number: "REF-4", work_stage: "introduction", call_status: "follow_up" };
    expect(validateCompleteForm(form, followUp).issues.map((issue) => issue.fieldKey)).toContain("callback_at");
    expect(validateCompleteForm(form, { ...followUp, callback_at: "2026-10-01T12:00" }).issues.map((issue) => issue.fieldKey)).not.toContain("callback_at");
  });
});
