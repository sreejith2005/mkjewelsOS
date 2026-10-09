import { describe, expect, it } from "vitest";
import { formatQuotaLabel, formatQuotaReset, isQuotaExhausted, kiaraQuotaDate, parseKiaraQuota, quotaRemaining } from "./quota";

describe("Kiara quota", () => {
  it("labels the remaining questions", () => {
    expect(formatQuotaLabel({ used: 3, limit: 10, resets_at: "2026-10-09T18:30:00Z" })).toBe("7 of 10 questions left today");
    expect(formatQuotaLabel({ used: 0, limit: 1, resets_at: "2026-10-09T18:30:00Z" })).toBe("1 of 1 question left today");
    expect(formatQuotaLabel({ used: 40, limit: null, resets_at: "2026-10-09T18:30:00Z" })).toBe("Unlimited questions");
  });

  it("never reports a negative remainder", () => {
    const quota = { used: 12, limit: 10, resets_at: "2026-10-09T18:30:00Z" };
    expect(quotaRemaining(quota)).toBe(0);
    expect(isQuotaExhausted(quota)).toBe(true);
    expect(isQuotaExhausted({ ...quota, limit: null })).toBe(false);
  });

  it("shows the reset in the tenant's timezone", () => {
    expect(formatQuotaReset({ used: 10, limit: 10, resets_at: "2026-10-09T18:30:00Z", timezone: "Asia/Kolkata" })).toBe("12:00 am on 10 Oct");
  });

  it("uses the tenant-local calendar day, not UTC", () => {
    expect(kiaraQuotaDate(new Date("2026-10-09T18:29:59Z"), "Asia/Kolkata")).toBe("2026-10-09");
    expect(kiaraQuotaDate(new Date("2026-10-09T18:30:00Z"), "Asia/Kolkata")).toBe("2026-10-10");
  });

  it("parses only well-formed payloads", () => {
    expect(parseKiaraQuota({ used: 1, limit: 10, resets_at: "2026-10-09T18:30:00Z", timezone: "Asia/Kolkata" })).toEqual({ used: 1, limit: 10, resets_at: "2026-10-09T18:30:00Z", timezone: "Asia/Kolkata" });
    expect(parseKiaraQuota({ used: "1", limit: 10, resets_at: "2026-10-09T18:30:00Z" })).toBeNull();
    expect(parseKiaraQuota({ used: 1, limit: 10, resets_at: "soon" })).toBeNull();
    expect(parseKiaraQuota(null)).toBeNull();
  });
});
