import { describe, expect, it } from "vitest";
import { importFormSectionCopy, planFormSectionImport } from "./sectionImport";
import { reconcileFormPreviewAnswers } from "./previewAnswers";
import { validateFormDefinition } from "./definition";
import type { FormFieldDefinition, FormTemplateDefinition } from "./types";

const field = (key: string, sectionKey: string, sortOrder: number, patch: Partial<FormFieldDefinition> = {}): FormFieldDefinition => ({ key, label: key, type: "text", sortOrder, sectionKey, ...patch });

/** Jewellery Sales Pipeline: three sections; Negotiation reads one of its own questions and one from Interest. */
const pipeline: FormTemplateDefinition = {
  name: "Jewellery Sales Pipeline",
  sections: [{ key: "connection", title: "Connection", next: "negotiation" }, { key: "negotiation", title: "Negotiation", next: "closing" }, { key: "closing", title: "Closing" }],
  fields: [
    field("interested", "connection", 0, { type: "radio", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }], branches: [{ operator: "equals", value: "no", targetSectionKey: "closing" }] }),
    field("price_accepted", "negotiation", 1, { type: "radio", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }),
    field("discount", "negotiation", 2, { rule: { kind: "predicate", fieldKey: "price_accepted", operator: "equals", value: "no" } }),
    field("ready", "negotiation", 3, { rule: { kind: "all", rules: [{ kind: "predicate", fieldKey: "price_accepted", operator: "equals", value: "yes" }, { kind: "predicate", fieldKey: "interested", operator: "equals", value: "yes" }] } }),
    field("remarks", "closing", 4),
  ],
};

describe("import a Form section as an editable copy", () => {
  it("warns about a dependency outside the section before importing", () => {
    const plan = planFormSectionImport(pipeline, "negotiation")!;
    expect(plan.questions.map((question) => question.key)).toEqual(["price_accepted", "discount", "ready"]);
    expect(plan.externalDependencies).toEqual([{ fieldKey: "ready", label: "ready", dependsOn: [{ key: "interested", label: "interested" }] }]);
    expect(plan.droppedJumps).toBe(1);
  });

  it("copies only the chosen section into an empty questionnaire, keeping its own conditions", () => {
    const result = importFormSectionCopy({ name: "Introduction Call", sections: [{ key: "section_1", title: "Section 1" }], fields: [] }, pipeline, "negotiation")!;
    expect(result.definition.sections).toEqual([{ key: "negotiation", title: "Negotiation" }]);
    expect(result.definition.fields.map((item) => item.key)).toEqual(["price_accepted", "discount", "ready"]);
    expect(result.definition.fields[1]!.rule).toEqual({ kind: "predicate", fieldKey: "price_accepted", operator: "equals", value: "no" });
    // Only the in-section half of the grouped rule comes across.
    expect(result.definition.fields[2]!.rule).toEqual({ kind: "predicate", fieldKey: "price_accepted", operator: "equals", value: "yes" });
    expect(validateFormDefinition(result.definition)).toEqual([]);
    // The source Form is never modified.
    expect(pipeline.fields).toHaveLength(5);
  });

  it("appends a second section with collision-free keys and remapped conditions", () => {
    const first = importFormSectionCopy({ name: "Call", fields: [] }, pipeline, "negotiation")!.definition;
    const second = importFormSectionCopy(first, pipeline, "negotiation")!;
    expect(second.sectionKey).toBe("negotiation_2");
    expect(second.definition.fields.slice(3).map((item) => item.key)).toEqual(["price_accepted_2", "discount_2", "ready_2"]);
    expect(second.definition.fields[4]!.rule).toEqual({ kind: "predicate", fieldKey: "price_accepted_2", operator: "equals", value: "no" });
    expect(validateFormDefinition(second.definition)).toEqual([]);
  });

  it("returns nothing for an unknown section", () => {
    expect(importFormSectionCopy({ name: "x", fields: [] }, pipeline, "missing")).toBeUndefined();
  });
});

describe("live preview sample answers", () => {
  it("keeps compatible answers and drops removed questions, renamed choices and changed types", () => {
    const definition: FormTemplateDefinition = { name: "x", fields: [
      field("interested", "s", 0, { type: "radio", options: [{ value: "yes", label: "Yes" }, { value: "maybe", label: "Maybe" }] }),
      field("budget", "s", 1, { type: "number" }),
      field("note", "s", 2),
    ] };
    const answers = { interested: "no", budget: 5000, note: "hello", removed: "x" };
    expect(reconcileFormPreviewAnswers(definition, answers)).toEqual({ budget: 5000, note: "hello" });
    const same = { interested: "yes", budget: 1 };
    expect(reconcileFormPreviewAnswers(definition, same)).toBe(same);
  });
});
