import { describe, expect, it } from "vitest";
import { activeCustomerFilterCount, customerListFilterPayload, daysAgoLabel, EMPTY_CUSTOMER_LIST_FILTERS } from "./list";

describe("customer master list filters", () => {
  it("sends nothing for an untouched filter set", () => {
    expect(customerListFilterPayload(EMPTY_CUSTOMER_LIST_FILTERS)).toEqual({});
    expect(activeCustomerFilterCount(EMPTY_CUSTOMER_LIST_FILTERS)).toBe(0);
  });

  it("maps each filter to the RPC key", () => {
    const filters = { ...EMPTY_CUSTOMER_LIST_FILTERS, query: "  98200 00001 ", segment: "lead" as const, lifecycleStage: "visited" as const,
      city: "Mumbai", community: "JAIN", firstSource: "runo", contact: "not_90" as const, followUpDue: true, sort: "name" as const };
    expect(customerListFilterPayload(filters)).toEqual({
      q: "98200 00001", segment: "lead", lifecycle_stage: "visited", cities: ["Mumbai"], communities: ["JAIN"],
      first_sources: ["runo"], not_contacted_days: 90, follow_up_due: true, sort: "name",
    });
    expect(activeCustomerFilterCount(filters)).toBe(8);
  });

  it("maps the reached-recently window", () => {
    expect(customerListFilterPayload({ ...EMPTY_CUSTOMER_LIST_FILTERS, contact: "within_30" })).toEqual({ contacted_within_days: 30 });
  });

  it("labels how long ago a customer was reached", () => {
    const now = new Date(2026, 10, 14, 15, 0);
    expect(daysAgoLabel(null, now)).toBeNull();
    expect(daysAgoLabel(new Date(2026, 10, 14, 9, 0).toISOString(), now)).toBe("Today");
    expect(daysAgoLabel(new Date(2026, 10, 13, 23, 0).toISOString(), now)).toBe("Yesterday");
    expect(daysAgoLabel(new Date(2026, 10, 2, 9, 0).toISOString(), now)).toBe("12 days ago");
    expect(daysAgoLabel(new Date(2026, 0, 5, 9, 0).toISOString(), now)).toContain("2026");
  });
});
