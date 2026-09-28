import { describe, expect, it } from "vitest";
import { classifyCrmMappingPreflight, normalizeIndianPhone, prepareLegacyClientImport, prepareLegacyTimelineImport } from "./index";

// Only the helpers the legacy CRM import scripts still use remain (see scripts/import-legacy-crm-timeline.ts,
// scripts/crm-migration-preflight.ts); the old JewelOS CRM screens that used the rest were retired at the CRM cutover.

describe("Indian phone normalization", () => {
  it.each([
    ["98765 43210", "+919876543210"], ["+91 98765-43210", "+919876543210"],
    ["919876543210", "+919876543210"], ["09876543210", "+919876543210"], ["0091 9876543210", "+919876543210"],
  ])("normalizes supported form %s", (value, expected) => expect(normalizeIndianPhone(value)?.normalized).toBe(expected));
  it.each(["", "12345", "1234567890", "98765432100", "+1 9876543210", "phone 9876543210"])("rejects invalid phone %s", (value) => expect(normalizeIndianPhone(value)).toBeNull());
  it("preserves a trimmed display value", () => expect(normalizeIndianPhone("  +91 98765 43210  ")?.display).toBe("+91 98765 43210"));
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
