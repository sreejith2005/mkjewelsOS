import { describe, expect, it } from "vitest";

describe("TaskCard required-form actions", () => {
  it("offers a single Complete form action and suppresses separate completion controls", async () => {
    const source = await import("./TaskCard?raw").then((module) => module.default);

    expect(source).toContain('const formOnlyAction = task.requires_form && !completed;');
    expect(source).toContain("Complete form");
    expect(source).toContain("!formOnlyAction && !readOnly && !completed && !blocked");
  });
});
