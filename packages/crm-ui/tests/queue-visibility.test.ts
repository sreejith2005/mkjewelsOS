import { describe, expect, it } from "vitest";

import { queueMatchesLegacyScope } from "@/lib/queue-visibility";

describe("legacy queue visibility", () => {
  it("requires matching branch, CRM assignment, and pending status without a UTC-day cutoff", () => {
    expect(queueMatchesLegacyScope({ branch_id: "branch-a", assigned_crm_name: "CRM A", status: "pending" }, "branch-a", "CRM A")).toBe(true);
    expect(queueMatchesLegacyScope({ branch_id: "branch-b", assigned_crm_name: "CRM A", status: "pending" }, "branch-a", "CRM A")).toBe(false);
    expect(queueMatchesLegacyScope({ branch_id: "branch-a", assigned_crm_name: "CRM B", status: "pending" }, "branch-a", "CRM A")).toBe(false);
    expect(queueMatchesLegacyScope({ branch_id: "branch-a", assigned_crm_name: "CRM A", status: "complete" }, "branch-a", "CRM A")).toBe(false);
  });
});
