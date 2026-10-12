import { describe, expect, it } from "vitest";
import { crmClientPath, isKiaraCrmPath } from "./crmLinks";

describe("CRM links in Kiara answers", () => {
  it("builds the client record path", () => {
    expect(crmClientPath("3f2a1b9c-1d2e-4f50-8a6b-426614174000")).toBe("/crm/clients/3f2a1b9c-1d2e-4f50-8a6b-426614174000");
  });

  it("accepts client records and CRM list screens only", () => {
    expect(isKiaraCrmPath("/crm")).toBe(true);
    expect(isKiaraCrmPath("/crm/clients/3f2a1b9c-1d2e-4f50-8a6b-426614174000")).toBe(true);
    for (const path of ["/crm/followups", "/crm/referrals", "/crm/dashboard", "/crm/queue", "/crm/clients"]) expect(isKiaraCrmPath(path)).toBe(true);
    for (const path of ["/crm/clients/new", "/crm/clients/x/../../users", "/crm/visits/new", "/crmx", "//crm/clients", "/crm/clients/3f2a1b9c-1d2e-4f50-8a6b-426614174000/edit"]) {
      expect(isKiaraCrmPath(path)).toBe(false);
    }
  });
});
