import { describe, expect, it } from "vitest";
import { formMatchesLifecycle, parseFmsBuiltForms } from "./library";

describe("form library lifecycle filter", () => {
  it("includes archived history in all lifecycle without including it in current forms", () => {
    expect(formMatchesLifecycle("archived", "all")).toBe(true);
    expect(formMatchesLifecycle("archived", "active")).toBe(false);
    expect(formMatchesLifecycle("draft", "active")).toBe(true);
    expect(formMatchesLifecycle("published", "draft")).toBe(false);
    expect(formMatchesLifecycle("archived", "archived")).toBe(true);
  });
});

describe("FMS-built forms", () => {
  it("parses optional authorized workflow-stage pairs and rejects malformed links", () => {
    const link = { workflowId: "workflow", workflowName: "Sales", stageId: "stage", stageName: "Call" };
    expect(parseFmsBuiltForms([{ familyId: "family", links: [link, null, { workflowId: "invalid" }] }]).get("family")?.links).toEqual([link]);
    expect(parseFmsBuiltForms([{ familyId: "family", links: "invalid" }]).get("family")?.links).toBeUndefined();
  });
  it("reads families with optional workflow and step names and skips malformed rows", () => {
    const built = parseFmsBuiltForms([{ familyId: "f1", workflows: ["Instagram Leads"], steps: ["Call", ""] }, { familyId: "f2" }, { nope: 1 }, null, "x"]);
    expect([...built.keys()]).toEqual(["f1", "f2"]);
    expect(built.get("f1")).toEqual({ familyId: "f1", workflows: ["Instagram Leads"], steps: ["Call"] });
    expect(built.get("f2")).toEqual({ familyId: "f2", workflows: [], steps: [] });
    expect(parseFmsBuiltForms(null).size).toBe(0);
  });
});
