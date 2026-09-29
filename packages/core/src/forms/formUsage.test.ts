import { describe, expect, it } from "vitest";
import { describePublishedFormEdit, type FormUsageImpact } from "./formUsage";

describe("describePublishedFormEdit", () => {
  it("names connected work and explains the effect of editing the same form", () => {
    const impact: FormUsageImpact = {
      form: { id: "form-1", name: "Enquiry", version: 1, lifecycle: "published" },
      flows: [{ id: "flow-1", name: "Sales FMS", version: 2, status: "published", stages: ["Start"], activeInstances: 3 }],
      taskTemplates: [{ id: "template-1", title: "Call customer", active: true }],
      tasks: [{ id: "task-1", title: "Customer A", status: "pending" }],
      starterAssignments: [{ id: "starter-1", flowName: "Sales FMS", status: "pending" }],
      submissions: 4,
    };
    const message = describePublishedFormEdit(impact);
    expect(message).toContain("Sales FMS v2 / Start (3 active runs)");
    expect(message).toContain("Call customer");
    expect(message).toContain("Customer A");
    expect(message).toContain("1 pending FMS starter assignment");
    expect(message).toContain("4 completed submissions retain their original questions");
    expect(message).toContain("Create a new version");
    expect(message).toContain("question keys or answer choices");
  });
});
