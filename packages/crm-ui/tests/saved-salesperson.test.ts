import { describe, expect, it } from "vitest";
import { savedSalespersonName } from "@/lib/saved-salesperson";
describe("saved attending salesperson", () => {
  it("preserves a historical selected label instead of showing the audit actor", () => {
    expect(savedSalespersonName({ SALESPERSON: "Recorded Seller" }, "Super Admin")).toBe("Recorded Seller");
  });
  it("uses the native snapshot before legacy or linked labels", () => {
    expect(savedSalespersonName({ submitted_fields: { salesperson: "Native Seller" }, SALESPERSON: "Old Label" }, "Actor")).toBe("Native Seller");
  });
  it("keeps account attribution when no selection was recorded", () => {
    expect(savedSalespersonName({}, "Linked Seller")).toBe("Linked Seller");
    expect(savedSalespersonName(null, null)).toBeNull();
  });
});
