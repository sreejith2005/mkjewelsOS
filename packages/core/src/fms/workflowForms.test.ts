import { describe, expect, it } from "vitest";
import { groupWorkflowForms } from "./workflowForms";

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
