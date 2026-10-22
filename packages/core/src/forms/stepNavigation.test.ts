import { describe, expect, it } from "vitest";
import { FORM_STEP_MIN_QUESTIONS, formCompletionProgress, formUsesSteps, isFinalFormStep } from "./stepNavigation";
import { workUploadFormDefinition } from "./workUploadForm";
import type { FormFieldDefinition, FormTemplateDefinition } from "./types";

const questions = (count: number, sectionKey: string, offset = 0): FormFieldDefinition[] =>
  Array.from({ length: count }, (_, index) => ({ key: `${sectionKey}_${index}`, label: `Question ${index}`, type: "text", sortOrder: offset + index, sectionKey }));

describe("when a form is filled step by step", () => {
  it("always steps the Work and Upload form", () => {
    expect(formUsesSteps(workUploadFormDefinition)).toBe(true);
  });

  it("keeps short and single-section forms on one page", () => {
    expect(formUsesSteps({ name: "Short", sections: [{ key: "a", title: "A" }, { key: "b", title: "B" }], fields: [...questions(2, "a"), ...questions(2, "b", 2)] })).toBe(false);
    expect(formUsesSteps({ name: "Long single", fields: questions(20, "section_1") })).toBe(false);
  });

  it("steps long multi-section forms, ignoring headers, dividers and hidden fields", () => {
    const half = FORM_STEP_MIN_QUESTIONS / 2;
    const long: FormTemplateDefinition = { name: "Long", sections: [{ key: "a", title: "A" }, { key: "b", title: "B" }], fields: [...questions(half, "a"), ...questions(half, "b", half)] };
    expect(formUsesSteps(long)).toBe(true);
    const padded: FormTemplateDefinition = { ...long, fields: [...long.fields.slice(1), { key: "h", label: "Header", type: "section_header", sortOrder: 99, sectionKey: "a" }, { key: "x", label: "Hidden", type: "text", sortOrder: 100, sectionKey: "a", shown: false }] };
    expect(formUsesSteps(padded)).toBe(false);
  });
});

describe("form completion progress", () => {
  const form: FormTemplateDefinition = { name: "Progress", sections: [{ key: "a", title: "A" }, { key: "b", title: "B" }], fields: [
    { key: "kind", label: "Kind", type: "select", sortOrder: 0, sectionKey: "a", required: true, options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }],
      branches: [{ operator: "equals", value: "x", targetSectionKey: "b" }, { operator: "equals", value: "y", targetSectionKey: "__submit__" }] },
    { key: "note", label: "Note", type: "text", sortOrder: 1, sectionKey: "a" },
    { key: "agree", label: "Agree", type: "checkbox", sortOrder: 2, sectionKey: "b", required: true },
    { key: "detail", label: "Detail", type: "text", sortOrder: 3, sectionKey: "b", required: true },
  ] };

  it("counts only questions the respondent can currently see", () => {
    expect(formCompletionProgress(form, {})).toEqual({ requiredTotal: 1, requiredAnswered: 0, questionTotal: 2, questionAnswered: 0 });
    expect(formCompletionProgress(form, { kind: "y" })).toEqual({ requiredTotal: 1, requiredAnswered: 1, questionTotal: 2, questionAnswered: 1 });
  });

  it("grows when a branch reveals a section, and an unticked required checkbox is not answered", () => {
    expect(formCompletionProgress(form, { kind: "x", agree: false, detail: "Done" })).toEqual({ requiredTotal: 3, requiredAnswered: 2, questionTotal: 4, questionAnswered: 2 });
    expect(formCompletionProgress(form, { kind: "x", agree: true, detail: "Done" }).requiredAnswered).toBe(3);
  });
});

describe("the last step of a branching form", () => {
  const form: FormTemplateDefinition = { name: "Route", sections: [{ key: "a", title: "A" }, { key: "b", title: "B" }, { key: "c", title: "C", next: "__submit__" }, { key: "d", title: "D" }], fields: [
    { key: "kind", label: "Kind", type: "radio", sortOrder: 0, sectionKey: "a", options: [{ value: "b", label: "B" }, { value: "end", label: "End" }],
      branches: [{ operator: "equals", value: "b", targetSectionKey: "b" }, { operator: "equals", value: "end", targetSectionKey: "__submit__" }] },
    { key: "x", label: "X", type: "text", sortOrder: 1, sectionKey: "b" },
    { key: "y", label: "Y", type: "text", sortOrder: 2, sectionKey: "c" },
    { key: "z", label: "Z", type: "text", sortOrder: 3, sectionKey: "d" },
  ] };

  it("is unknown while the branching question is unanswered", () => {
    expect(isFinalFormStep(form, {}, "a")).toBe(false);
  });
  it("follows the chosen branch, the section's own next, and the last section", () => {
    expect(isFinalFormStep(form, { kind: "end" }, "a")).toBe(true);
    expect(isFinalFormStep(form, { kind: "b" }, "a")).toBe(false);
    expect(isFinalFormStep(form, { kind: "b" }, "b")).toBe(false);
    expect(isFinalFormStep(form, { kind: "b" }, "c")).toBe(true);
    expect(isFinalFormStep(form, {}, "d")).toBe(true);
    expect(isFinalFormStep(form, {}, "missing")).toBe(false);
  });
});
