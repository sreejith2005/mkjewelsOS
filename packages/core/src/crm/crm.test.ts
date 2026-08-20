import { describe, expect, it } from "vitest";
import {
  canTransitionFollowup, classifyFollowupDue, deriveCrmCapability, findDuplicateContactMatches,
  normalizeClientInput, normalizeCrmSearch, normalizeIndianPhone, timelineEventDisplay, validateCrmSourceMapping,
  validateCrmFieldDefinition,
  classifyCrmMappingPreflight,
  prepareLegacyClientImport,
  prepareLegacyTimelineImport,
  validateContact, validateWalkinConditional, zonedDateKey,
} from "./index";

describe("Indian phone normalization", () => {
  it.each([
    ["98765 43210", "+919876543210"], ["+91 98765-43210", "+919876543210"],
    ["919876543210", "+919876543210"], ["09876543210", "+919876543210"], ["0091 9876543210", "+919876543210"],
  ])("normalizes supported form %s", (value, expected) => expect(normalizeIndianPhone(value)?.normalized).toBe(expected));
  it.each(["", "12345", "1234567890", "98765432100", "+1 9876543210", "phone 9876543210"])("rejects invalid phone %s", (value) => expect(normalizeIndianPhone(value)).toBeNull());
  it("preserves a trimmed display value", () => expect(normalizeIndianPhone("  +91 98765 43210  ")?.display).toBe("+91 98765 43210"));
});

describe("CRM migration source mappings", () => {
  it("accepts a stable source and external ID without trusting a display name", () => expect(validateCrmSourceMapping({ sourceKey: "legacy_sreejith_crm", externalId: "branch-42", entityType: "branch" })).toEqual({ sourceKey: "legacy_sreejith_crm", externalId: "branch-42", entityType: "branch" }));
  it("rejects name-only mappings", () => expect(() => validateCrmSourceMapping({ sourceKey: "legacy_sreejith_crm", externalId: "", entityType: "branch", displayName: "MG Road" })).toThrow("external ID"));
});

describe("change-tolerant CRM fields", () => {
  it("normalizes a stable select field definition", () => expect(validateCrmFieldDefinition({ key: "preferred_metal", label: "Preferred metal", type: "select", options: [" Gold ", "Silver", "Gold"] })).toMatchObject({ key: "preferred_metal", options: ["Gold", "Silver"] }));
  it("requires select options and rejects changing a field key by label", () => {
    expect(() => validateCrmFieldDefinition({ key: "preferred_metal", label: "Preferred metal", type: "select" })).toThrow("option");
    expect(() => validateCrmFieldDefinition({ key: "Preferred Metal", label: "Preferred metal", type: "text" })).toThrow("key");
  });
});

describe("CRM migration preflight", () => {
  it("classifies unmapped, duplicate, and dangling stable-ID mappings", () => {
    const report = classifyCrmMappingPreflight(
      [{ externalId: "legacy-a" }, { externalId: "legacy-b" }],
      [{ externalId: "legacy-a", targetId: "jewelos-a" }, { externalId: "legacy-a", targetId: "jewelos-b" }, { externalId: "legacy-c", targetId: "missing" }],
      new Set(["jewelos-a", "jewelos-b"]),
    );
    expect(report).toEqual({ unmappedExternalIds: ["legacy-b"], duplicateExternalIds: ["legacy-a"], danglingExternalIds: ["legacy-c"] });
  });
});

describe("legacy client import preparation", () => {
  it("keeps a valid client ready for normal CRM contact indexing", () => {
    expect(prepareLegacyClientImport({ externalId: "legacy-client-1", primaryName: "Customer", primaryPhone: "98765 43210", legacyBranchId: "legacy-branch-1" })).toMatchObject({ normalizedPhone: "+919876543210", reviewCodes: [] });
  });
  it("preserves incomplete records while marking the exact review work", () => {
    expect(prepareLegacyClientImport({ externalId: "legacy-client-2", primaryName: "Customer", primaryPhone: "unknown" })).toMatchObject({ phone: "unknown", normalizedPhone: null, reviewCodes: ["invalid_phone", "missing_branch"] });
  });
});

describe("legacy timeline import preparation", () => {
  it("retains the legacy visit classification while using JewelOS's durable walk-in event", () => {
    expect(prepareLegacyTimelineImport({ externalId: "timeline-1", clientExternalId: "client-1", branchExternalId: "branch-1", eventType: "NON_PURCHASE_VISIT", occurredAt: "2026-01-02T10:30:00.000Z" })).toMatchObject({ eventType: "walkin", subject: "Legacy non-purchase visit", reviewCodes: [] });
  });
  it("does not invent a branch for a historical event", () => {
    expect(prepareLegacyTimelineImport({ externalId: "timeline-2", clientExternalId: "client-2", branchExternalId: null, eventType: "VISIT", occurredAt: "invalid" })).toMatchObject({ reviewCodes: ["missing_branch", "invalid_date"] });
  });
});

describe("client inputs and duplicates", () => {
  it("normalizes contact fields and deduplicates tags", () => expect(normalizeClientInput({ firstName: "  Example  ", primaryPhone: "9876543210", email: " USER@EXAMPLE.INVALID ", tags: [" Bridal ", "bridal"] })).toMatchObject({ firstName: "Example", normalizedPhone: "+919876543210", email: "user@example.invalid", tags: ["bridal"] }));
  it("rejects invalid contact combinations", () => expect(validateContact({ primaryPhone: "9876543210", billingPhone: "+91 9876543210", email: "bad", pincode: "000000" })).toHaveLength(3));
  it("matches primary, alternate, and alias contacts", () => expect(findDuplicateContactMatches("+919876543210", [
    { id: "a", normalizedPhone: "+919876543210" }, { id: "b", normalizedPhone: "+919000000001", normalizedBillingPhone: "+919876543210" }, { id: "c", normalizedPhone: "+919000000002", aliases: ["+919876543210"] }, { id: "d", normalizedPhone: "+919876543210", active: false },
  ])).toEqual(["a", "b", "c"]));
});

describe("walk-in and follow-up contracts", () => {
  it("requires reason for configured not-bought results", () => expect(validateWalkinConditional({ productBought: false, buyStatus: "not_bought" })).toContain("Not-bought reason is required for this outcome."));
  it("requires follow-up for configured results", () => expect(validateWalkinConditional({ productBought: false, buyStatus: "considering", notBoughtReason: "Synthetic reason" })).toContain("A follow-up date is required for this outcome."));
  it("accepts a valid outcome and companion count", () => expect(validateWalkinConditional({ productBought: true, buyStatus: "purchased", companions: 2 })).toEqual([]));
  it("bounds companions", () => expect(validateWalkinConditional({ companions: 51 })).toHaveLength(1));
  it("permits transitions only from open", () => { expect(canTransitionFollowup("open", "complete")).toBe(true); expect(canTransitionFollowup("completed", "reschedule")).toBe(false); expect(canTransitionFollowup("cancelled", "complete")).toBe(false); });
});

describe("timezone due classification", () => {
  const instant = new Date("2026-08-09T18:45:00.000Z");
  it("calculates the Kolkata business date", () => expect(zonedDateKey(instant)).toBe("2026-08-10"));
  it.each([["2026-08-09", "overdue"], ["2026-08-10", "today"], ["2026-08-11", "upcoming"]] as const)("classifies %s", (due, bucket) => expect(classifyFollowupDue(due, "open", instant)).toBe(bucket));
  it("keeps terminal history separate", () => { expect(classifyFollowupDue("2026-08-01", "completed", instant)).toBe("completed"); expect(classifyFollowupDue("2026-08-01", "cancelled", instant)).toBe("cancelled"); });
});

describe("timeline, search, and capability helpers", () => {
  it("maps timeline events", () => expect(timelineEventDisplay("fms_linked")).toEqual({ label: "FMS flow linked", category: "link" }));
  it("normalizes bounded search", () => expect(normalizeCrmSearch({ query: " +91 98765 43210 ", limit: 500 })).toMatchObject({ query: "+919876543210", limit: 100 }));
  it("rejects invalid filter identifiers", () => expect(() => normalizeCrmSearch({ branchId: "arbitrary" })).toThrow("identifier"));
  it("gives administrators tenant capability", () => expect(deriveCrmCapability({ role: "admin", active: true }).scope).toBe("tenant"));
  it("restricts managers to their branch", () => expect(deriveCrmCapability({ role: "manager", active: true, sameBranch: false }).canAccess).toBe(false));
  it("restricts CRM users to assigned same-branch clients", () => { expect(deriveCrmCapability({ role: "crm", active: true, sameBranch: true, assigned: true }).canEditClient).toBe(true); expect(deriveCrmCapability({ role: "crm", active: true, sameBranch: true, assigned: false }).canEditClient).toBe(false); });
  it.each(["staff", "doer", "hr", "housekeeping"] as const)("denies %s", (role) => expect(deriveCrmCapability({ role, active: true }).canAccess).toBe(false));
  it("denies inactive profiles", () => expect(deriveCrmCapability({ role: "super_admin", active: false }).canAccess).toBe(false));
});
