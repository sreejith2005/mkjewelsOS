import { describe, expect, it } from "vitest";
import { normalizeFormDefinition, validateFormDefinition } from "./definition";
import { normalizeFormAnswers } from "./answers";
import { evaluateFormRule } from "./visibility";
import { formDefinitionForSection, visibleFormSections } from "./sections";
import { isFinalFormStep } from "./stepNavigation";
import { validateCompleteForm } from "./validation";
import { buildFormRoutingMap, formRoutingWarnings } from "./routingMap";
import { duplicateFormField, updateFormField } from "./builder";
import { pruneOptionValueReferences } from "./fieldTypes";
import { convertFormFieldType } from "./fieldTypes";
import { setAnswerRoute } from "./guidedConditions";
import { formUsesSteps } from "./stepNavigation";
import type { FormTemplateDefinition } from "./types";

const form = (): FormTemplateDefinition => ({ name: "Routing", sections: [
  { key: "intro", title: "Introduction", next: "__submit__" },
  { key: "interested", title: "Interested", visibility: "when", rule: { kind: "predicate", fieldKey: "status", operator: "in", value: ["yes", "follow"] } },
  { key: "disconnected", title: "Disconnected", visibility: "when", rule: { kind: "predicate", fieldKey: "status", operator: "equals", value: "no" } },
], fields: [
  { key: "status", label: "Status", type: "select", sortOrder: 0, sectionKey: "intro", required: true, options: [{ value: "yes", label: "Interested" }, { value: "no", label: "Disconnected" }, { value: "follow", label: "Follow up" }], branches: [
    { operator: "in", rule: { kind: "predicate", fieldKey: "status", operator: "in", value: ["yes", "follow"] }, targetSectionKey: "interested" },
    { operator: "equals", rule: { kind: "predicate", fieldKey: "status", operator: "equals", value: "no" }, targetSectionKey: "disconnected" },
  ] },
  { key: "detail", label: "Details", type: "text", sortOrder: 1, sectionKey: "interested", required: true },
  { key: "remark", label: "Remark", type: "text", sortOrder: 2, sectionKey: "disconnected", required: true },
] });

describe("advanced conditional routing", () => {
  it("retains typed Other answers through routing and hidden-answer pruning", () => {
    const original = form();
    const definition: FormTemplateDefinition = { ...original, fields: original.fields.map(field => field.key === "status"
      ? { ...field, validation: { allowOther: true }, branches: [{ operator: "default", targetSectionKey: "__submit__" }] }
      : field) };
    const answers = { status: "A personal answer", detail: "stale", remark: "stale" };
    expect(validateCompleteForm(definition, answers).valid).toBe(true);
    expect(normalizeFormAnswers(definition, answers)).toEqual({ status: "A personal answer" });
    expect(normalizeFormDefinition(definition).fields[0]?.validation?.allowOther).toBe(true);
  });

  it("warns about structurally unreachable sections and duplicate route priority", () => {
    const definition: FormTemplateDefinition = { name: "Unreachable", sections: [{ key: "one", title: "First", next: "__submit__" }, { key: "two", title: "Unreachable" }], fields: [] };
    expect(formRoutingWarnings(definition)).toContain('Section "Unreachable" has no reachable navigation path.');
  });
  it("persists a selected answer's explicit Continue action", () => {
    const original = form();
    const fields = setAnswerRoute(original.fields, "status", "yes", { kind: "continue" });
    expect(fields[0]?.branches?.find(b => b.value === "yes")?.targetSectionKey).toBe("__continue__");
    expect(visibleFormSections({ ...original, fields }, { status: "yes" }).map(s => s.section.key)).toEqual(["intro", "interested"]);
  });
  it("preserves routed choices when dropdown becomes multiselect", () => {
    const original = form();
    const fields = setAnswerRoute(original.fields, "status", "yes", { kind: "section", sectionKey: "interested" });
    const converted = convertFormFieldType(fields, 0, "multiselect");
    expect(visibleFormSections({ ...original, fields: converted.fields }, { status: ["yes"] }).map(s => s.section.key)).toEqual(["intro", "interested"]);
  });
  it("never broadens a route group when an earlier dependency changes type", () => {
    const condition = { kind: "all" as const, rules: [{ kind: "predicate" as const, fieldKey: "status", operator: "equals" as const, value: "yes" }, { kind: "predicate" as const, fieldKey: "budget", operator: "greater_than" as const, value: 5 }] };
    const fields = [{ ...form().fields[0]!, branches: undefined }, { key: "budget", label: "Budget", type: "number" as const, sortOrder: 1, branches: [{ operator: "equals" as const, rule: condition, targetSectionKey: "__submit__" }] }];
    expect(convertFormFieldType(fields, 0, "text").fields[1]?.branches?.[0]?.rule).toEqual(condition);
  });
  it("recognizes End current form stage without other advanced metadata", () => {
    const definition: FormTemplateDefinition = { name: "Stage end", sections: [{ key: "a", title: "A", next: "__stage_end__" }, { key: "b", title: "B" }], fields: [{ key: "answer", label: "Answer", type: "text", sortOrder: 0, sectionKey: "a" }] };
    expect(formUsesSteps(definition)).toBe(true);
    expect(isFinalFormStep(definition, { answer: "ok" }, "a")).toBe(true);
  });
  it("lets a matching Continue override section Submit", () => {
    const definition = form();
    const fields = definition.fields.map(f => f.key === "status" ? { ...f, branches: [{ operator: "default" as const, targetSectionKey: "__continue__" }] } : f);
    expect(visibleFormSections({ ...definition, fields }, { status: "yes" }).map(s => s.section.key)).toEqual(["intro", "interested"]);
    expect(validateCompleteForm({ ...definition, fields }, { status: "yes" }).issues.some(i => i.fieldKey === "detail" && i.code === "required")).toBe(true);
  });
  it("carries field renames into routing, section eligibility and record names", () => {
    const original = form();
    const renamed = updateFormField({ ...original, recordNameFieldKey: "detail", sections: original.sections!.map(s => s.key === "intro" ? { ...s, next: "__question__:detail" } : s) }, "status", { key: "outcome" });
    expect(renamed.fields[0]?.branches?.[0]?.rule).toMatchObject({ fieldKey: "outcome" });
    expect(renamed.sections?.[1]?.rule).toMatchObject({ fieldKey: "outcome" });
    const target = updateFormField(renamed, "detail", { key: "description" });
    expect(target.recordNameFieldKey).toBe("description");
    expect(target.sections?.[0]?.next).toBe("__question__:description");
  });
  it("makes a duplicated question's self routing read the new question", () => {
    const copied = duplicateFormField(form(), "status");
    expect(copied.fields[1]?.branches?.[0]?.rule).toMatchObject({ fieldKey: copied.fields[1]?.key });
  });
  it("preserves negated groups when unrelated option edits prune dependencies", () => {
    const original = form();
    const fields = original.fields.map(f => f.key === "detail" ? { ...f, rule: { kind: "any" as const, negate: true, rules: [{ kind: "predicate" as const, fieldKey: "status", operator: "equals" as const, value: "yes" }, { kind: "predicate" as const, fieldKey: "status", operator: "equals" as const, value: "follow" }] } } : f);
    const pruned = pruneOptionValueReferences(fields, "unrelated", new Set(["x"]));
    expect(pruned[1]?.rule?.negate).toBe(true);
  });
  it("maps ordered rule destinations to question nodes", () => {
    const definition = form();
    const fields = definition.fields.map(f => f.key === "status" ? { ...f, branches: [{ operator: "equals" as const, rule: { kind: "predicate" as const, fieldKey: "status", operator: "equals" as const, value: "yes" }, targetSectionKey: "__question__:detail" }] } : f);
    expect(buildFormRoutingMap(fields, definition.sections!).edges.some(e => e.from === "question:status" && e.to === "question:detail" && e.label?.includes("IF 1"))).toBe(true);
  });
  it("rejects routing comparisons to deleted options and empty route groups", () => {
    const definition = form();
    const fields = definition.fields.map(f => f.key === "status" ? { ...f, branches: [{ operator: "equals" as const, rule: { kind: "predicate" as const, fieldKey: "status", operator: "equals" as const, value: "deleted" }, targetSectionKey: "interested" }] } : f);
    expect(validateFormDefinition({ ...definition, fields }).some(i => i.code === "unknown_rule_option")).toBe(true);
    const empty = definition.fields.map(f => f.key === "status" ? { ...f, branches: [{ operator: "equals" as const, rule: { kind: "all" as const, rules: [] }, targetSectionKey: "interested" }] } : f);
    expect(validateFormDefinition({ ...definition, fields: empty }).some(i => i.code === "empty_rule")).toBe(true);
  });
  it.each(["not_equals", "not_in", "not_contains"] as const)("does not match unanswered negative %s", operator => {
    expect(evaluateFormRule({ kind: "predicate", fieldKey: "status", operator, value: operator === "not_in" ? ["no"] : "no" }, {})).toBe(false);
  });
  it("keeps section eligibility separate and explicit routes override default Submit", () => {
    expect(visibleFormSections(form(), { status: "yes" }).map(s => s.section.key)).toEqual(["intro", "interested"]);
    expect(isFinalFormStep(form(), { status: "yes" }, "intro")).toBe(false);
    expect(validateCompleteForm(form(), { status: "yes", detail: "ok" }).valid).toBe(true);
    expect(normalizeFormAnswers(form(), { status: "no", detail: "stale", remark: "retry" })).toEqual({ status: "no", remark: "retry" });
  });
  it("jumps to a question in the same section and skips intervening required questions", () => {
    const definition: FormTemplateDefinition = { name: "Question jump", fields: [
      { key: "start", label: "Start", type: "text", sortOrder: 0, branches: [{ operator: "equals", rule: { kind: "predicate", fieldKey: "start", operator: "equals", value: "jump" }, targetSectionKey: "__question__:last" }] },
      { key: "skip", label: "Skipped", type: "text", sortOrder: 1, required: true },
      { key: "last", label: "Last", type: "text", sortOrder: 2, required: true },
    ] };
    expect(visibleFormSections(definition, { start: "jump" }).flatMap(s => s.fields.map(f => f.key))).toEqual(["start", "last"]);
    expect(normalizeFormAnswers(definition, { start: "jump", skip: "stale", last: "done" })).toEqual({ start: "jump", last: "done" });
    expect(validateCompleteForm(definition, { start: "jump", last: "done" }).valid).toBe(true);
  });
  it("persists grouped routing and section eligibility through normalization", () => {
    const normalized = normalizeFormDefinition(form());
    expect(normalized.sections?.[1]?.rule).toEqual(form().sections?.[1]?.rule);
    expect(normalized.fields[0]?.branches?.[0]?.rule).toEqual(form().fields[0]?.branches?.[0]?.rule);
  });
  it("rejects backward question destinations", () => {
    const definition = form();
    expect(validateFormDefinition({ ...definition, fields: definition.fields.map(f => f.key === "detail" ? { ...f, branches: [{ operator: "default", targetSectionKey: "__question__:status" }] } : f) }).some(i => i.code === "backward_branch")).toBe(true);
  });
  it("retains internal question routes in an isolated FMS section", () => {
    const definition = form();
    const scoped = formDefinitionForSection({ ...definition, fields: [...definition.fields, { key: "end", label: "End", type: "text", sortOrder: 3, sectionKey: "interested" }].map(f => f.key === "detail" ? { ...f, branches: [{ operator: "default", targetSectionKey: "__question__:end" }] } : f) }, "interested");
    expect(scoped?.fields[0]?.branches?.[0]?.targetSectionKey).toBe("__question__:end");
  });
});
