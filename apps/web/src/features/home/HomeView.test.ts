import { describe, expect, it } from "vitest";

describe("HomeView work queue", () => {
  it("shows assigned work as typed cards without duplicate dashboard cards or quick actions", async () => {
    const source = await import("./HomeView?raw").then((module) => module.default);
    const cards = await import("./HomeWorkCards?raw").then((module) => module.default);

    expect(source).not.toContain("Your day at a glance");
    expect(source).not.toContain("Quick Actions");
    expect(source).toContain("<HomeWorkCards");
    expect(cards).toContain("starter.form_name");
    expect(cards).toContain("fmsAssignedWorkPath");
    // Scroll can pass back to the page when the bounded preview reaches its end.
    expect(cards).not.toContain("overscroll-contain");
  });
});
