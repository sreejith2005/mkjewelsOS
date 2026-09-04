import { describe, expect, it } from "vitest";
import { shouldShowTaskLoading } from "./taskLoading";

describe("shouldShowTaskLoading", () => {
  it("keeps an already loaded task board visible during a background refresh", () => {
    expect(shouldShowTaskLoading(true, true)).toBe(false);
  });
});
