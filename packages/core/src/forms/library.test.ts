import { describe, expect, it } from "vitest";
import { formMatchesLifecycle } from "./library";

describe("form library lifecycle filter", () => {
  it("includes archived history in all lifecycle without including it in current forms", () => {
    expect(formMatchesLifecycle("archived", "all")).toBe(true);
    expect(formMatchesLifecycle("archived", "active")).toBe(false);
    expect(formMatchesLifecycle("draft", "active")).toBe(true);
    expect(formMatchesLifecycle("published", "draft")).toBe(false);
    expect(formMatchesLifecycle("archived", "archived")).toBe(true);
  });
});
