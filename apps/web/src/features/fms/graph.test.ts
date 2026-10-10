import { describe, expect, it } from "vitest";
import { newFmsStage } from "./definition";
import { fmsGraphEdges, layoutFmsDefinition } from "./graph";
import { routeFmsGraphEdges } from "@jewelos/core";

describe("FMS graph presentation", () => {
  it("auto-arranges compactly and puts a shared finish after the longer follow-up path", () => {
    const first = { ...newFmsStage("form", 0), key: "first", defaultNextStageKey: "follow", branchRules: [{ id: "exit", source: "context" as const, sourceKey: "done", operator: "equals" as const, value: "yes", nextStageKey: "finish", order: 0 }] };
    const follow = { ...newFmsStage("task", 1), key: "follow", defaultNextStageKey: "later" };
    const later = { ...newFmsStage("task", 2), key: "later", defaultNextStageKey: "finish" };
    const finish = { ...newFmsStage("task", 3), key: "finish" };
    const layout = layoutFmsDefinition({ name: "Follow ups", scope: "tenant", manualTrigger: true, stages: [first, follow, later, finish] });
    expect(layout.get("follow")!.x - layout.get("first")!.x).toBeLessThan(340);
    expect(layout.get("finish")!.x).toBeGreaterThan(layout.get("later")!.x);
  });
  it("draws backward routes with independent return lanes", () => {
    const a = { ...newFmsStage("task", 0), key: "a" };
    const b = { ...newFmsStage("task", 1), key: "b", defaultNextStageKey: "a", branchRules: [{ id: "return", source: "context" as const, sourceKey: "again", operator: "equals" as const, value: "yes", nextStageKey: "a", order: 0 }] };
    const edges = fmsGraphEdges([a, b]);
    const routes = routeFmsGraphEdges(edges.map((edge, index) => ({ ...edge, id: String(index) })), new Map([["a", { x: 60, y: 100 }], ["b", { x: 420, y: 100 }]]), { width: 208, height: 104 });
    expect(routes).toHaveLength(2);
    expect(routes.every((edge) => edge.isReturn)).toBe(true);
    expect(routes[0]!.label.y).not.toBe(routes[1]!.label.y);
  });
  it("lays out explicit routes rather than stage array order", () => {
    const first = { ...newFmsStage("form", 0), key: "first", defaultNextStageKey: "last" };
    const middle = { ...newFmsStage("task", 1), key: "middle" };
    const last = { ...newFmsStage("task", 2), key: "last" };
    const positions = layoutFmsDefinition({ name: "Graph", scope: "tenant", manualTrigger: true, stages: [first, middle, last] });
    expect(positions.get("last")!.x).toBeGreaterThan(positions.get("first")!.x);
    expect(positions.get("middle")!.x).toBeGreaterThan(positions.get("last")!.x);
  });

  it("labels conditional and parallel edges", () => {
    const branch = { ...newFmsStage("branch", 0), key: "route", branchRules: [{ id: "r", source: "outcome" as const, operator: "default" as const, nextStageKey: "done", order: 0 }] };
    const done = { ...newFmsStage("task", 1), key: "done" };
    expect(fmsGraphEdges([branch, done])).toEqual([{ from: "route", to: "done", label: "Otherwise", kind: "branch", ruleId: "r" }]);
  });

  it("names a form-answer edge with the question and answer labels, not their stable keys", () => {
    const formId = "00000000-0000-4000-8000-000000000001";
    const fields = { [formId]: [{ key: "purchased_jewellery", label: "Did the customer buy jewellery?", options: [{ value: "bought", label: "Bought Jewellery" }, { value: "not_bought", label: "Did Not Buy" }] }] };
    const purchase = { ...newFmsStage("form", 0), key: "purchase", formTemplateId: formId, defaultNextStageKey: "reason", branchRules: [{ id: "r1", source: "form_answer" as const, sourceKey: "purchased_jewellery", operator: "equals" as const, value: "bought", nextStageKey: "product", order: 0 }] };
    const product = { ...newFmsStage("task", 1), key: "product" };
    const reason = { ...newFmsStage("task", 2), key: "reason" };
    const edges = fmsGraphEdges([purchase, product, reason], fields);
    expect(edges[0]).toMatchObject({ to: "product", label: "Did the customer buy jewellery? is Bought Jewellery" });
    expect(edges[1]).toMatchObject({ to: "reason", label: "Otherwise" });
  });
});
