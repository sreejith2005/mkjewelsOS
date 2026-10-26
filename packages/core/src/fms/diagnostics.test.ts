import { describe, expect, it } from "vitest";
import { applyFmsAiOperations } from "./aiOperations";
import { diagnoseFmsDefinition, explainFmsRoute } from "./diagnostics";
import { validateFmsDefinition } from "./engine";
import type { FmsFlowDefinition } from "./types";
import { catalog, fixed, FORM_ID, FORM_V1_ID, INACTIVE, NEHA, op, RAVI, sequentialIds } from "./aiFixtures.test-helpers";

const empty: FmsFlowDefinition = { assignmentVersion: 2, name: "Stock", description: "D", scope: "tenant", manualTrigger: true, stages: [] };
const diagnosticCatalog = {
  formFields: catalog.formFields,
  forms: [{ id: FORM_ID, name: "Stock request", version: 2, familyId: "fam", lifecycle: "published" }, { id: FORM_V1_ID, name: "Stock request", version: 1, familyId: "fam", lifecycle: "archived" }],
  users: [{ id: NEHA, name: "Neha", active: true, loginEnabled: true, availability: "absent" }, { id: RAVI, name: "Ravi", active: true, loginEnabled: true }, { id: INACTIVE, name: "Old Staff", active: false, loginEnabled: false }],
};

function build(extra: Parameters<typeof applyFmsAiOperations>[1] = []): FmsFlowDefinition {
  const result = applyFmsAiOperations(empty, [
    op({ op: "add_stage", stageKey: "request", stageType: "form", name: "Request" }),
    op({ op: "link_form", stageKey: "request", formTemplateId: FORM_ID }),
    op({ op: "add_stage", stageKey: "check", stageType: "task", name: "Check", afterStageKey: "request" }),
    op({ op: "set_assignment", stageKey: "check", assignment: fixed([NEHA]) }),
    op({ op: "set_timing", stageKey: "check", timing: { method: "none", hours: null, minutes: null } }),
    op({ op: "add_stage", stageKey: "approve", stageType: "task", name: "Approve" }),
    op({ op: "set_assignment", stageKey: "approve", assignment: fixed([RAVI]) }),
    op({ op: "set_timing", stageKey: "approve", timing: { method: "none", hours: null, minutes: null } }),
    ...extra,
  ], catalog, sequentialIds());
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.definition;
}

const codes = (definition: FmsFlowDefinition) => diagnoseFmsDefinition(definition, diagnosticCatalog).map((finding) => finding.code);

describe("diagnoseFmsDefinition", () => {
  it("reports every validator issue as an authoritative error with its step", () => {
    const definition = build();
    const findings = diagnoseFmsDefinition(definition, diagnosticCatalog);
    const validator = validateFmsDefinition(definition, { formFields: diagnosticCatalog.formFields, availableFormIds: diagnosticCatalog.forms.map((form) => form.id) });
    expect(validator.map((issue) => issue.code)).toContain("unreachable_stage");
    expect(findings.filter((finding) => finding.source === "validator").map((finding) => [finding.code, finding.stageKey, finding.severity])).toEqual(validator.map((issue) => [issue.code, issue.stageKey, "error"]));
    expect(findings.find((finding) => finding.code === "unreachable_stage")?.stageKey).toBe("approve");
  });

  it("does not require a fallback: an unmatched answer finishes the workflow", () => {
    const definition = build([op({ op: "add_route", stageKey: "request", route: { source: "form_answer", questionKey: "urgency", operator: "equals", values: ["high"], targetStageKey: "approve", label: null } })]);
    const withoutFallback = { ...definition, stages: definition.stages.map((stage) => stage.key === "request" ? { ...stage, defaultNextStageKey: undefined } : stage) };
    expect(codes(withoutFallback)).not.toContain("route_without_fallback");
    expect(codes(definition)).not.toContain("route_without_fallback");
  });

  it("explains answers that fall through to the fallback and routes on optional questions", () => {
    const definition = build([
      op({ op: "add_route", stageKey: "request", route: { source: "form_answer", questionKey: "urgency", operator: "equals", values: ["high"], targetStageKey: "approve", label: "Urgent" } }),
      op({ op: "add_route", stageKey: "request", route: { source: "form_answer", questionKey: "notes", operator: "not_empty", values: [], targetStageKey: "approve", label: "Has notes" } }),
    ]);
    const findings = diagnoseFmsDefinition(definition, diagnosticCatalog);
    const fallback = findings.find((finding) => finding.code === "option_uses_fallback");
    expect(fallback?.evidence.join(" ")).toContain("Normal [normal]");
    expect(fallback?.evidence.join(" ")).toContain("Check (check)");
    expect(findings.find((finding) => finding.code === "route_on_optional_question")?.title).toContain("Notes");
  });

  it("detects a route that an earlier catch-all shadows", () => {
    const definition = build([
      op({ op: "add_route", stageKey: "request", route: { source: "form_answer", questionKey: "urgency", operator: "not_empty", values: [], targetStageKey: "approve", label: "Any" } }),
      op({ op: "add_route", stageKey: "request", route: { source: "form_answer", questionKey: "urgency", operator: "equals", values: ["low"], targetStageKey: "check", label: "Low" } }),
    ]);
    const shadow = diagnoseFmsDefinition(definition, diagnosticCatalog).find((finding) => finding.code === "route_shadowed");
    expect(shadow).toMatchObject({ severity: "warning", stageKey: "request", title: '"Low" can never run' });
  });

  it("checks fixed employees against the directory without guessing", () => {
    const definition = build([op({ op: "set_next", stageKey: "check", nextStageKey: "approve" })]);
    const inactive = { ...definition, stages: definition.stages.map((stage) => stage.key === "approve" ? { ...stage, assigneeRules: [{ type: "specific_user" as const, userProfileId: INACTIVE }] } : stage) };
    const findings = diagnoseFmsDefinition(inactive, diagnosticCatalog);
    expect(findings.find((finding) => finding.code === "assignee_inactive")).toMatchObject({ severity: "error", stageKey: "approve" });
    expect(findings.find((finding) => finding.code === "assignee_absent_today")).toMatchObject({ severity: "warning", stageKey: "check" });
    expect(diagnoseFmsDefinition(inactive, { ...diagnosticCatalog, users: undefined }).some((finding) => finding.code.startsWith("assignee_"))).toBe(false);
  });

  it("suggests a visit limit on a repeating human step and a newer pinned Form", () => {
    const definition = build([op({ op: "set_next", stageKey: "check", nextStageKey: "approve" }), op({ op: "set_decision_options", stageKey: "approve", decisionOptions: [{ key: "ok", label: "OK" }, { key: "redo", label: "Redo" }] }), op({ op: "add_route", stageKey: "approve", route: { source: "outcome", questionKey: null, operator: "equals", values: ["redo"], targetStageKey: "check", label: null } })]);
    const pinnedOld = { ...definition, stages: definition.stages.map((stage, index) => index === 0 ? { ...stage, formTemplateId: FORM_V1_ID } : stage) };
    const found = codes(pinnedOld);
    expect(found).toContain("loop_without_visit_limit");
    expect(found).toContain("older_form_version");
  });

  it("is deterministic and orders errors before warnings before suggestions", () => {
    const definition = build();
    const first = diagnoseFmsDefinition(definition, diagnosticCatalog);
    expect(diagnoseFmsDefinition(definition, diagnosticCatalog)).toEqual(first);
    const order = first.map((finding) => ({ error: 0, warning: 1, suggestion: 2 })[finding.severity]);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(new Set(first.map((finding) => finding.id)).size).toBe(first.length);
  });
});

describe("explainFmsRoute", () => {
  const definition = build([
    op({ op: "set_next", stageKey: "check", nextStageKey: undefined as never }),
    op({ op: "add_route", stageKey: "request", route: { source: "form_answer", questionKey: "urgency", operator: "equals", values: ["high"], targetStageKey: "approve", label: "Urgent" } }),
  ]);
  it("shows the stored value and its label, in evaluation order, and the first match", () => {
    const explanation = explainFmsRoute(definition, "request", { answers: { urgency: "high" } }, catalog.formFields);
    expect(explanation).toMatchObject({ chosenRuleId: expect.any(String), nextStageKey: "approve", viaFallback: false });
    expect(explanation?.evaluations[0]).toMatchObject({ expected: "High [high]", actual: "High [high]", matched: true, questionLabel: "Urgency" });
  });
  it("names the fallback when no route matches, and a missing answer as blank", () => {
    expect(explainFmsRoute(definition, "request", { answers: { urgency: "low" } }, catalog.formFields)).toMatchObject({ nextStageKey: "check", viaFallback: true, note: "No route matched, so the fallback is used." });
    expect(explainFmsRoute(definition, "request", { answers: {} }, catalog.formFields)?.evaluations[0]?.actual).toBe("—");
  });
  it("returns null for an unknown step", () => expect(explainFmsRoute(definition, "nope", {})).toBeNull());
});
