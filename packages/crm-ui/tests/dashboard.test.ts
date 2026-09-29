import { describe, expect, it } from "vitest";
import { buildDashboardData, dashboardRange, endExclusive, startInclusive } from "@/lib/dashboard";

const visit = (overrides: Record<string, unknown>) => ({ id: crypto.randomUUID(), event_date: "2026-07-24T10:00:00.000Z", created_at: "2026-07-24T10:00:00.000Z", event_type: "VISIT", buy_status: null, branch_id: "branch-a", crm_name: "Anu", remark: null, reference_number: null, client_id: "client-a", branch: { name: "MG Road" }, client: { primary_name: "Client" }, salesperson: null, ...overrides });

describe("legacy dashboard filter and summary parity", () => {
  it("defaults to MONTH using the Asia/Kolkata business date", () => {
    expect(dashboardRange({}, new Date("2026-07-31T20:00:00.000Z"))).toEqual({ mode: "MONTH", start: "2026-08-01", end: "2026-08-01" });
  });

  it("keeps ALL unbounded", () => {
    const range = dashboardRange({ mode: "ALL" }, new Date("2026-07-24T10:00:00.000Z"));
    expect(range).toEqual({ mode: "ALL", start: "", end: "" });
    expect(startInclusive(range)).toBeNull();
    expect(endExclusive(range)).toBeNull();
  });

  it("uses Monday through today for WEEK", () => {
    expect(dashboardRange({ mode: "WEEK" }, new Date("2026-07-26T10:00:00.000Z"))).toEqual({ mode: "WEEK", start: "2026-07-20", end: "2026-07-26" });
    expect(dashboardRange({ mode: "WEEK" }, new Date("2026-07-26T20:00:00.000Z"))).toEqual({ mode: "WEEK", start: "2026-07-27", end: "2026-07-27" });
  });

  it("uses inclusive, normalized, swapped DATE TO DATE boundaries", () => {
    const range = dashboardRange({ mode: "DATE_TO_DATE", startDate: "2026-07-31", endDate: "2026-07-01" }, new Date("2026-07-24T10:00:00.000Z"));
    expect(range).toEqual({ mode: "DATE_TO_DATE", start: "2026-07-01", end: "2026-07-31" });
    expect(startInclusive(range)).toBe("2026-06-30T18:30:00.000Z");
    expect(endExclusive(range)).toBe("2026-07-31T18:30:00.000Z");
  });

  it("uses Asia/Kolkata rather than UTC for DATE TO DATE defaults and date normalization", () => {
    expect(dashboardRange({ mode: "DATE_TO_DATE", startDate: "2026-07-31T20:00:00.000Z" }, new Date("2026-07-31T20:00:00.000Z"))).toEqual({ mode: "DATE_TO_DATE", start: "2026-08-01", end: "2026-08-01" });
  });

  it("matches every legacy summary card status group, including overlapping combined statuses", () => {
    const rows = ["NO", "STORE_VISIT", "PRICE_CALCULATION", "PRODUCT_RETURN", "YES", "YES_AND_ORDER_PLACED", "YES AND ORDER_PLACED", "ORDER_PLACED", "REPAIR_PLACED", "ORDER_PICKUP", "REPAIR_PICKUP", "ORDER_PLACED_AND_BUYING_NEW_PRODUCT", "REPAIR_PLACED_AND_MAKING_NEW_ORDER"].map((buy_status) => visit({ buy_status }));
    const data = buildDashboardData(rows, "2026-07-24");
    expect(data.totals).toEqual({ walkIns: 13, notBought: 3, bought: 3, orderPlaced: 4, repairPlaced: 2, orderPickup: 1, repairPickup: 1, upsale: 2, productReturn: 1 });
    expect(data.statusDistribution.map(({ label, value }) => [label, value])).toEqual([["TOTAL WALK-INS", 13], ["TOTAL NOT BOUGHT", 3], ["TOTAL BOUGHT", 3], ["TOTAL ORDER PLACE", 4], ["TOTAL REPAIR PLACE", 2], ["TOTAL ORDER PICK UP", 1], ["TOTAL REPAIR PICKUP", 1], ["TOTAL PRODUCT RETURN", 1]]);
  });

  it("matches legacy branch and CRM count-only breakdowns", () => {
    const rows = [visit({ branch: { name: "MG Road" }, crm_name: "Anu" }), visit({ branch: { name: "MG Road" }, crm_name: "Anu" }), visit({ branch: { name: "Airport" }, crm_name: "Bala" }), visit({ branch: null, crm_name: null })];
    const data = buildDashboardData(rows, "2026-07-24");
    expect(data.branchBreakdown).toEqual([{ name: "MG Road", visits: 2 }, { name: "Airport", visits: 1 }, { name: "UNKNOWN", visits: 1 }]);
    expect(data.crmBreakdown).toEqual([{ name: "Anu", visits: 2 }, { name: "Bala", visits: 1 }, { name: "UNKNOWN", visits: 1 }]);
  });

  it("matches the legacy trend rule and limits recent visits to today and yesterday in Kolkata", () => {
    const rows = [visit({ id: "today", event_date: "2026-07-24T18:00:00.000Z", created_at: "2026-07-24T18:00:00.000Z", buy_status: "NO" }), visit({ id: "yesterday", event_date: "2026-07-23T10:00:00.000Z", buy_status: "YES" }), visit({ id: "older", event_date: "2026-07-22T10:00:00.000Z", buy_status: "PRODUCT_RETURN" })];
    const data = buildDashboardData(rows, "2026-07-24");
    expect(data.trend).toEqual([{ day: "2026-07-22", total: 1, bought: 0, notBought: 0 }, { day: "2026-07-23", total: 1, bought: 1, notBought: 0 }, { day: "2026-07-24", total: 1, bought: 0, notBought: 1 }]);
    expect(data.recentVisits.map((row) => row.id)).toEqual(["today", "yesterday"]);
  });
});
