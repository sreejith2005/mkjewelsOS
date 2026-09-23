import { describe, expect, it } from "vitest";
import { isFormerEmployee } from "./formerEmployees";

describe("isFormerEmployee", () => {
  it("treats left or resigned accounts as former employees", () => {
    expect(isFormerEmployee({ account_status: "left", working_status: "resigned" })).toBe(true);
    expect(isFormerEmployee({ account_status: "active", working_status: "resigned" })).toBe(true);
    expect(isFormerEmployee({ account_status: "left", working_status: "active" })).toBe(true);
  });

  it("keeps current staff, including suspended, invited and inactive accounts", () => {
    for (const account_status of ["active", "invited", "inactive", "suspended", null]) {
      expect(isFormerEmployee({ account_status, working_status: "active" })).toBe(false);
    }
  });
});
