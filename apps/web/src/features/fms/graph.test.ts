import { describe, expect, it } from "vitest";
import { newFmsStage } from "./definition";
import { fmsGraphEdges, layoutFmsDefinition } from "./graph";

describe("FMS graph presentation", () => {
  it("lays out explicit routes rather than stage array order", () => {
    const first = { ...newFmsStage("task", 0), key: "first", defaultNextStageKey: "last" };
    const middle = { ...newFmsStage("task", 1), key: "middle" };
    const last = { ...newFmsStage("end", 2), key: "last" };
    const positions = layoutFmsDefinition({ name: "Graph", scope: "tenant", manualTrigger: true, stages: [first, middle, last] });
    expect(positions.get("last")!.x).toBeGreaterThan(positions.get("first")!.x);
    expect(positions.get("middle")!.x).toBeGreaterThan(positions.get("last")!.x);
  });

  it("labels conditional and parallel edges", () => {
    const branch = { ...newFmsStage("branch", 0), key: "route", branchRules: [{ id: "r", source: "outcome" as const, operator: "default" as const, nextStageKey: "done", order: 0 }] };
    const done = { ...newFmsStage("end", 1), key: "done" };
    expect(fmsGraphEdges([branch, done])).toEqual([{ from: "route", to: "done", label: "Default", kind: "branch" }]);
  });
});
