import { describe, expect, it } from "vitest";

describe("Availability coverage integration", () => {
  it("captures a range and renders the profile coverage outcome", async () => {
    const source = await import("./AvailabilityPage?raw").then((module) => module.default);
    expect(source).toContain("Availability start date");
    expect(source).toContain("Availability end date");
    expect(source).toContain("Coverage result:");
    expect(source).toContain("secondary_buddy");
    expect(source).toContain('timeZone: "Asia/Kolkata"');
  });
});
