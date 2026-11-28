import { describe, expect, it } from "vitest";
import {
  customerCellText, customerConditionComplete, customerFilterCount, customerFilterOperators, customerTableRequest,
  EMPTY_CUSTOMER_TABLE_STATE, type CustomerFilterGroup,
} from "./table";

describe("customer table request (migration 0454)", () => {
  it("sends only complete conditions and keeps nested groups", () => {
    const filter: CustomerFilterGroup = { id: "root", match: "all", items: [
      { id: "1", field: "city", op: "is_any_of", value: ["Mumbai"] },
      { id: "2", field: "store", op: "contains", value: "" },
      { id: "3", match: "any", items: [
        { id: "4", field: "last_attempt_at", op: "in_last_days", value: " 30 " },
        { id: "5", field: "do_not_call", op: "is_true", value: null },
      ] },
      { id: "6", match: "all", items: [{ id: "7", field: "pincode", op: "is_any_of", value: [] }] },
    ] };
    const request = customerTableRequest({ ...EMPTY_CUSTOMER_TABLE_STATE, filter, query: " asha " }, 2);
    expect(request.filter).toEqual({ match: "all", items: [
      { field: "city", op: "is_any_of", value: ["Mumbai"] },
      { match: "any", items: [{ field: "last_attempt_at", op: "in_last_days", value: "30" }, { field: "do_not_call", op: "is_true" }] },
    ] });
    expect(request.q).toBe("asha");
    expect(request.offset).toBe(100);
    expect(customerFilterCount(filter)).toBe(3);
  });

  it("leaves the filter out when nothing is complete", () => {
    expect("filter" in customerTableRequest(EMPTY_CUSTOMER_TABLE_STATE, 0)).toBe(false);
  });

  it("offers operators by type and checks values", () => {
    expect(customerFilterOperators("boolean")).toEqual(["is_true", "is_false"]);
    expect(customerConditionComplete({ id: "a", field: "dob", op: "on", value: "2026-11-28" })).toBe(true);
    expect(customerConditionComplete({ id: "a", field: "dob", op: "on", value: "28/11/2026" })).toBe(false);
    expect(customerConditionComplete({ id: "a", field: "interaction_count", op: "between", value: ["1", ""] })).toBe(false);
  });

  it("formats cells", () => {
    expect(customerCellText("list", ["a", "b"])).toBe("a, b");
    expect(customerCellText("boolean", true)).toBe("Yes");
    expect(customerCellText("date", "2026-09-18")).toMatch(/^18 Sept? 2026$/);
    expect(customerCellText("text", null)).toBe("");
  });
});
