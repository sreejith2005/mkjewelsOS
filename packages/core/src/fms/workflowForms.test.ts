import { describe, expect, it } from "vitest";
import { groupWorkflowForms, groupFmsBuiltForms } from "./workflowForms";

const forms = [
  { id: "published", family_id: "family", name: "Lead", description: "Details", lifecycle: "published", version: 1 },
  { id: "draft", family_id: "family", name: "Lead", description: "Details", lifecycle: "draft", version: 2 },
  { id: "regular", family_id: "regular", name: "Regular", lifecycle: "published", version: 1 },
];
const provenance = {
  published: { origin: "fms", workflows: [{ id: "flow", name: "Sales", stage_name: "Call" }, { id: "flow", name: "Sales", stage_name: "Call" }] },
  draft: { origin: "fms", source_flow_id: "flow", source_flow_name: "Sales", source_stage_name: "Call" },
  regular: { origin: "library", workflows: [{ id: "flow", name: "Sales", stage_name: "Call" }] },
};

describe("workflow form hierarchy", () => {
  it("preserves exact server pairs for one family used by different workflows", () => {
    const built = new Map([["family", { familyId: "family", workflows: ["Sales", "Support"], steps: ["Call", "Resolve"], links: [
      { workflowId: "sales", workflowName: "Sales", stageId: "call", stageName: "Call" },
      { workflowId: "support", workflowName: "Support", stageId: "resolve", stageName: "Resolve" },
    ] }]]);
    expect(groupFmsBuiltForms(forms, built).map(group => [group.name, group.stages.map(stage => stage.name)])).toEqual([["Sales", ["Call"]], ["Support", ["Resolve"]]]);
    expect(groupFmsBuiltForms(forms, built, { query: "support resolve" }).map(group => group.name)).toEqual(["Support"]);
  });
  it("does not infer pairs from older responses or expose restricted workflow metadata", () => {
    const built = new Map([["family", { familyId: "family", workflows: ["Sales", "Support"], steps: ["Call", "Resolve"] }]]);
    expect(groupFmsBuiltForms(forms, built)[0]?.name).toBe("Workflow unavailable in your access");
    expect(groupFmsBuiltForms(forms, built)[0]?.stages.map(stage => stage.name)).toEqual(["Stage unavailable"]);
  });
  it("keeps same-named stages distinct by their persisted IDs", () => {
    const built = new Map([["family", { familyId: "family", workflows: ["Sales"], steps: ["Call"], links: [
      { workflowId: "sales", workflowName: "Sales", stageId: "first-call", stageName: "Call" },
      { workflowId: "sales", workflowName: "Sales", stageId: "second-call", stageName: "Call" },
    ] }]]);
    expect(groupFmsBuiltForms(forms, built)[0]?.stages.map(stage => stage.id)).toEqual(["first-call", "second-call"]);
  });
  it("shows one group per workflow, not per saved version, with the current version's steps in order", () => {
    const link = (version: number, status: "draft" | "published" | "archived", isCurrent: boolean, stage: string, order: number, name = "Instagram FMS") =>
      ({ workflowId: `flow-v${version}`, workflowName: name, stageId: `${stage}-v${version}`, stageName: stage, workflowFamilyId: "instagram", workflowVersion: version, workflowStatus: status, stageOrder: order, isCurrent });
    const twoForms = [...forms, { id: "pay", family_id: "pay", name: "Payment", lifecycle: "published", version: 1 }, { id: "old", family_id: "old", name: "Old intro", lifecycle: "published", version: 1 }];
    const built = new Map([
      ["family", { familyId: "family", workflows: [], steps: [], links: [link(1, "archived", false, "Lead", 0, "Insta"), link(2, "published", true, "Lead", 2), link(3, "draft", false, "Lead", 2)] }],
      ["pay", { familyId: "pay", workflows: [], steps: [], links: [link(2, "published", true, "Payment", 1), link(3, "draft", false, "Payment", 1)] }],
      ["old", { familyId: "old", workflows: [], steps: [], links: [link(1, "archived", false, "Intro", 0, "Insta")] }],
    ]);
    const groups = groupFmsBuiltForms(twoForms, built);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: "instagram", name: "Instagram FMS", status: "published", version: 2, familyCount: 3 });
    expect(groups[0]?.stages.map(stage => [stage.name, stage.families.map(family => family[0]!.name)])).toEqual([["Payment", ["Payment"]], ["Lead", ["Lead"]]]);
    expect(groups[0]?.elsewhere.map(family => family[0]!.name)).toEqual(["Old intro"]);
    expect(groupFmsBuiltForms(twoForms, built, { query: "intro" })[0]?.elsewhere.map(family => family[0]!.name)).toEqual(["Old intro"]);
  });
  it("names a workflow without a current link after its newest version", () => {
    const built = new Map([["family", { familyId: "family", workflows: [], steps: [], links: [
      { workflowId: "a", workflowName: "Old name", stageId: "s1", stageName: "Call", workflowFamilyId: "flow", workflowVersion: 1, isCurrent: false },
      { workflowId: "b", workflowName: "New name", stageId: "s2", stageName: "Call", workflowFamilyId: "flow", workflowVersion: 2, workflowStatus: "archived" as const, isCurrent: false },
    ] }]]);
    expect(groupFmsBuiltForms(forms, built)).toMatchObject([{ id: "flow", name: "New name", status: "archived", stages: [], familyCount: 1 }]);
  });
  it("groups persisted FMS sources and attachments without duplicating versions or reclassifying library forms", () => {
    const groups = groupWorkflowForms(forms, provenance);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.stages[0]?.families[0]?.map(form => form.id)).toEqual(["draft", "published"]);
  });
  it("filters workflow, stage, search and lifecycle against the same version", () => {
    expect(groupWorkflowForms(forms, provenance, { workflow: "other" })).toEqual([]);
    expect(groupWorkflowForms(forms, provenance, { stage: "Other" })).toEqual([]);
    expect(groupWorkflowForms(forms, provenance, { query: "sales call", lifecycle: "published" })[0]?.stages[0]?.families[0]?.map(form => form.id)).toEqual(["published"]);
    expect(groupWorkflowForms(forms, provenance, { lifecycle: "archived" })).toEqual([]);
  });
  it("keeps restricted or removed source forms discoverable without guessing names or IDs", () => {
    const groups = groupWorkflowForms(forms, { published: { origin: "fms" } });
    expect(groups[0]?.id).toBe("");
    expect(groups[0]?.name).toBe("Workflow unavailable in your access");
    expect(groups[0]?.stages[0]?.name).toBe("Stage unavailable");
  });
  it("prefers current attachments over immutable source labels", () => {
    const groups = groupWorkflowForms(forms, { published: { ...provenance.published, source_flow_id: "old", source_flow_name: "Old", source_stage_name: "Old stage" } });
    expect(groups.map(group => group.id)).toEqual(["flow"]);
  });
});
