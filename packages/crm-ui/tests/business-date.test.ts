import { describe, expect, it } from "vitest";

import { kolkataDateKey, kolkataDayStart } from "@/lib/business-date";

describe("Asia/Kolkata business dates", () => {
  it("moves to the next business date at midnight Kolkata rather than midnight UTC", () => {
    expect(kolkataDateKey(new Date("2026-07-29T18:29:59.000Z"))).toBe("2026-07-29");
    expect(kolkataDateKey(new Date("2026-07-29T18:30:00.000Z"))).toBe("2026-07-30");
    expect(kolkataDayStart(new Date("2026-07-29T18:30:00.000Z"))).toBe("2026-07-29T18:30:00.000Z");
  });
});
