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

  it("keeps internal question routes and terminal actions, remapping their complete rules", () => {
    const source: FormTemplateDefinition = { name: "Routes", sections: [{ key: "s", title: "S" }], fields: [
      field("answer", "s", 0, { branches: [
        { operator: "not_empty", rule: { kind: "all", rules: [{ kind: "predicate", fieldKey: "answer", operator: "not_empty" }] }, targetSectionKey: "__question__:detail" },
        { operator: "default", targetSectionKey: "__submit__" },
        { operator: "default", targetSectionKey: "__stage_end__" },
        { operator: "default", targetSectionKey: "__continue__" },
      ] }), field("detail", "s", 1),
    ] };
    const result = importFormSectionCopy({ name: "Target", fields: [field("answer", "existing", 0), field("detail", "existing", 1)] }, source, "s")!;
    const branches = result.definition.fields[2]!.branches!;
    expect(branches.map(branch => branch.targetSectionKey)).toEqual(["__question__:detail_2", "__submit__", "__stage_end__", "__continue__"]);
    expect(branches[0]!.rule).toEqual({ kind: "all", rules: [{ kind: "predicate", fieldKey: "answer_2", operator: "not_empty" }] });
    expect(result.plan.droppedJumps).toBe(0);
    expect(source.fields[0]!.branches![0]!.targetSectionKey).toBe("__question__:detail");
  });

  it("drops entire routes with external conditions and reports section eligibility dependencies", () => {
    const source: FormTemplateDefinition = { name: "Scoped", sections: [
      { key: "prior", title: "Prior" }, { key: "s", title: "S", visibility: "when", rule: { kind: "predicate", fieldKey: "outside", operator: "not_empty" }, next: "__question__:outside" },
    ], fields: [field("outside", "prior", 0), field("answer", "s", 1, { branches: [
      { operator: "not_empty", rule: { kind: "any", rules: [{ kind: "predicate", fieldKey: "answer", operator: "not_empty" }, { kind: "predicate", fieldKey: "outside", operator: "not_empty" }] }, targetSectionKey: "__submit__" },
      { operator: "default", targetSectionKey: "__question__:outside" },
      { operator: "default", targetSectionKey: "__continue__" },
    ] })] };
    const result = importFormSectionCopy({ name: "Target", fields: [] }, source, "s")!;
    expect(result.definition.sections).toEqual([{ key: "s", title: "S" }]);
    expect(result.definition.fields[0]!.branches).toEqual([{ operator: "default", targetSectionKey: "__continue__" }]);
    expect(result.plan.droppedJumps).toBe(3);
    expect(result.plan.externalDependencies).toEqual([
      { fieldKey: "answer", label: "answer", dependsOn: [{ key: "outside", label: "outside" }] },
      { fieldKey: "s", label: "S", dependsOn: [{ key: "outside", label: "outside" }] },
    ]);
  });

  it("remaps each original key once when a generated key is also a source key", () => {
    const source: FormTemplateDefinition = { name: "Collisions", sections: [{ key: "s", title: "S" }], fields: [
      field("answer", "s", 0, { branches: [{ operator: "not_empty", rule: { kind: "predicate", fieldKey: "answer", operator: "not_empty" }, targetSectionKey: "__question__:answer_2" }] }),
      field("answer_2", "s", 1, { rule: { kind: "predicate", fieldKey: "answer", operator: "not_empty" } }),
    ] };
    const result = importFormSectionCopy({ name: "Target", fields: [field("answer", "existing", 0)] }, source, "s")!;
    expect(result.definition.fields[1]!.key).toBe("answer_2");
    expect(result.definition.fields[1]!.branches![0]!.rule).toEqual({ kind: "predicate", fieldKey: "answer_2", operator: "not_empty" });
    expect(result.definition.fields[1]!.branches![0]!.targetSectionKey).toBe("__question__:answer_2_2");
    expect(result.definition.fields[2]!.rule).toEqual({ kind: "predicate", fieldKey: "answer_2", operator: "not_empty" });
  });

  it.each(["__submit__", "__stage_end__", "__continue__"])("preserves terminal section action %s", next => {
    const source: FormTemplateDefinition = { name: "Terminal", sections: [{ key: "s", title: "S", next, visibility: "routed" }], fields: [field("answer", "s", 0)] };
    const result = importFormSectionCopy({ name: "Target", fields: [] }, source, "s")!;
    expect(result.definition.sections).toEqual([{ key: "s", title: "S", next }]);
    expect(result.plan.droppedJumps).toBe(0);
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
