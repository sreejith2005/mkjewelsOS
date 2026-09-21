import { describe, expect, it } from "vitest";
import {
  buildCrmSearchFilter,
  crmMergeConfirmed,
  crmStaleEditMessage,
  validateCrmClientDraft,
  validateCrmFollowupDraft,
} from "./crmWorkspace";

describe("CRM workspace rules", () => {
  it("omits empty directory filters and retains the exact cursor and limit", () => {
    expect(buildCrmSearchFilter({ query: " Asha ", branch_id: "", assigned_crm_id: "crm-1", limit: 25, cursor: "cursor-1" })).toEqual({
      query: "Asha",
      assigned_crm_id: "crm-1",
      limit: 25,
      cursor: "cursor-1",
    });
  });

  it("requires client identity and organization without normalizing an invented value", () => {
    expect(validateCrmClientDraft({ firstName: "", primaryPhone: "", branchId: "" })).toBe("First name is required.");
    expect(validateCrmClientDraft({ firstName: "Asha", primaryPhone: "123", branchId: "branch-1" })).toMatch(/phone/i);
    expect(validateCrmClientDraft({ firstName: "Asha", primaryPhone: "+919876543210", branchId: "" })).toBe("Home branch is required.");
    expect(validateCrmClientDraft({ firstName: "Asha", primaryPhone: "+919876543210", branchId: "branch-1" })).toBeNull();
  });

  it("uses explicit merge confirmation and different records", () => {
    expect(crmMergeConfirmed("one", "two", "MERGE")).toBe(true);
    expect(crmMergeConfirmed("one", "one", "MERGE")).toBe(false);
    expect(crmMergeConfirmed("one", "two", "yes")).toBe(false);
  });

  it("turns stale-version failures into an actionable refresh message", () => {
    expect(crmStaleEditMessage(new Error("record changed since version 2"))).toMatch(/Refresh/i);
  });

  it("validates follow-up subject, date, assignee, and action text", () => {
    expect(validateCrmFollowupDraft({ subject: "", dueDate: "", assignedTo: "" })).toBe("Follow-up subject is required.");
    expect(validateCrmFollowupDraft({ subject: "Call", dueDate: "2026-09-20", assignedTo: "crm-1" })).toBeNull();
    expect(validateCrmFollowupDraft({ action: "complete", actionText: " " })).toBe("Outcome is required.");
    expect(validateCrmFollowupDraft({ action: "cancel", actionText: "Customer requested", dueDate: "", assignedTo: "", subject: "" })).toBeNull();
  });
});
