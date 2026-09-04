import { describe, expect, it } from "vitest";

describe("HomeView work queue", () => {
  it("keeps assigned work in one focal queue without duplicate dashboard cards or quick actions", async () => {
    const source = await import("./HomeView?raw").then((module) => module.default);

    expect(source).not.toContain("Your day at a glance");
    expect(source).not.toContain("Quick Actions");
    expect(source).toContain("Action required");
    expect(source).not.toContain("openTasks.slice(0, 4)");
    expect(source).toContain("All open tasks");
    expect(source).toContain("overflow-y-auto");
  });
});
