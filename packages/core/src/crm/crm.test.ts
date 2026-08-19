import { describe, expect, it } from "vitest";
import {
  canTransitionFollowup, classifyFollowupDue, deriveCrmCapability, findDuplicateContactMatches,
  normalizeClientInput, normalizeCrmSearch, normalizeIndianPhone, timelineEventDisplay,
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
