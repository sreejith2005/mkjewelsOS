export type DashboardMode = "ALL" | "MONTH" | "WEEK" | "DATE_TO_DATE";
export type DashboardRange = { mode: DashboardMode; start: string; end: string };

const KOLKATA_TIME_ZONE = "Asia/Kolkata";
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: KOLKATA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function kolkataDay(value: Date) {
  const parts = dateFormatter.formatToParts(value);
  const get = (type: "year" | "month" | "day") => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(day: string, amount: number) {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function normalizeFilterDate(value?: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : kolkataDay(parsed);
}

export function dashboardRange(input: { mode?: string; startDate?: string; endDate?: string }, now = new Date()): DashboardRange {
  const today = kolkataDay(now);
  const mode = input.mode === "ALL" || input.mode === "WEEK" || input.mode === "DATE_TO_DATE" || input.mode === "MONTH" ? input.mode : "MONTH";

  if (mode === "ALL") return { mode, start: "", end: "" };
  if (mode === "DATE_TO_DATE") {
    let start = normalizeFilterDate(input.startDate) || today;
    let end = normalizeFilterDate(input.endDate || input.startDate) || start;
    if (start > end) [start, end] = [end, start];
    return { mode, start, end };
  }
  if (mode === "WEEK") {
    const utcDay = new Date(`${today}T00:00:00.000Z`).getUTCDay();
    return { mode, start: addDays(today, -(utcDay === 0 ? 6 : utcDay - 1)), end: today };
  }
  return { mode: "MONTH", start: `${today.slice(0, 8)}01`, end: today };
}

function kolkataBoundary(day: string) {
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

export const startInclusive = (range: DashboardRange) => range.mode === "ALL" ? null : kolkataBoundary(range.start);
export const endExclusive = (range: DashboardRange) => range.mode === "ALL" ? null : kolkataBoundary(addDays(range.end, 1));

type Visit = { id: string; event_date: string; created_at?: string; event_type: string; buy_status: string | null; branch_id: string; crm_name: string | null; remark: string | null; reference_number: string | null; client_id: string; branch?: { name: string } | null; client?: { primary_name: string } | null; salesperson?: { name: string } | null };
export type Breakdown = { name: string; visits: number };
export type StatusDistributionItem = { label: string; value: number; color: string };

const statusGroups = {
  readyProduct: new Set(["YES", "YES_AND_ORDER_PLACED", "YES AND ORDER_PLACED"]),
  orderPlaced: new Set(["YES_AND_ORDER_PLACED", "YES AND ORDER_PLACED", "ORDER_PLACED", "ORDER_PLACED_AND_BUYING_NEW_PRODUCT", "ORDER_PLACED_AND_MAKING_NEW_ORDER"]),
  orderPickup: new Set(["ORDER_PICKUP", "ORDER_PICKUP_AND_BUYING_NEW_PRODUCT", "ORDER_PICKUP_AND_MAKING_NEW_ORDER"]),
  repairPlaced: new Set(["REPAIR_PLACED", "REPAIR_PLACED_AND_BUYING_NEW_PRODUCT", "REPAIR_PLACED_AND_MAKING_NEW_ORDER"]),
  repairPickup: new Set(["REPAIR_PICKUP", "REPAIR_PICKUP_AND_BUYING_NEW_PRODUCT", "REPAIR_PICKUP_AND_MAKING_NEW_ORDER"]),
  upsale: new Set(["ORDER_PLACED_AND_BUYING_NEW_PRODUCT", "ORDER_PLACED_AND_MAKING_NEW_ORDER", "ORDER_PICKUP_AND_MAKING_NEW_ORDER", "ORDER_PICKUP_AND_BUYING_NEW_PRODUCT", "REPAIR_PICKUP_AND_BUYING_NEW_PRODUCT", "REPAIR_PICKUP_AND_MAKING_NEW_ORDER", "REPAIR_PLACED_AND_BUYING_NEW_PRODUCT", "REPAIR_PLACED_AND_MAKING_NEW_ORDER"]),
  nonBuyer: new Set(["NO", "PRODUCT_RETURN", "STORE_VISIT", "PRICE_CALCULATION"]),
  productReturn: new Set(["PRODUCT_RETURN"]),
};

function status(visit: Visit) { return visit.buy_status ?? ""; }

function breakdown(visits: Visit[], name: (visit: Visit) => string): Breakdown[] {
  const groups = new Map<string, number>();
  for (const visit of visits) groups.set(name(visit), (groups.get(name(visit)) ?? 0) + 1);
  return [...groups].map(([name, visits]) => ({ name, visits })).sort((a, b) => b.visits - a.visits || a.name.localeCompare(b.name));
}

export function buildDashboardData(visits: Visit[], today: string) {
  const totals = {
    walkIns: visits.length,
    notBought: visits.filter((visit) => statusGroups.nonBuyer.has(status(visit)) && !statusGroups.productReturn.has(status(visit))).length,
    bought: visits.filter((visit) => statusGroups.readyProduct.has(status(visit))).length,
    orderPlaced: visits.filter((visit) => statusGroups.orderPlaced.has(status(visit))).length,
    repairPlaced: visits.filter((visit) => statusGroups.repairPlaced.has(status(visit))).length,
    orderPickup: visits.filter((visit) => statusGroups.orderPickup.has(status(visit))).length,
    repairPickup: visits.filter((visit) => statusGroups.repairPickup.has(status(visit))).length,
    upsale: visits.filter((visit) => statusGroups.upsale.has(status(visit))).length,
    productReturn: visits.filter((visit) => statusGroups.productReturn.has(status(visit))).length,
  };
  const trend = new Map<string, { day: string; total: number; bought: number; notBought: number }>();
  for (const visit of visits) {
    const day = kolkataDay(new Date(visit.event_date));
    const point = trend.get(day) ?? { day, total: 0, bought: 0, notBought: 0 };
    point.total += 1;
    if (statusGroups.readyProduct.has(status(visit))) point.bought += 1;
    if (status(visit) === "NO") point.notBought += 1;
    trend.set(day, point);
  }
  return {
    totals,
    statusDistribution: [
      { label: "TOTAL WALK-INS", value: totals.walkIns, color: "#44403c" }, { label: "TOTAL NOT BOUGHT", value: totals.notBought, color: "#a73f35" }, { label: "TOTAL BOUGHT", value: totals.bought, color: "#217047" }, { label: "TOTAL ORDER PLACE", value: totals.orderPlaced, color: "#b98934" }, { label: "TOTAL REPAIR PLACE", value: totals.repairPlaced, color: "#6b5ca5" }, { label: "TOTAL ORDER PICK UP", value: totals.orderPickup, color: "#287a88" }, { label: "TOTAL REPAIR PICKUP", value: totals.repairPickup, color: "#9a5f2d" }, { label: "TOTAL PRODUCT RETURN", value: totals.productReturn, color: "#6b7280" },
    ] satisfies StatusDistributionItem[],
    branchBreakdown: breakdown(visits, (visit) => visit.branch?.name ?? "UNKNOWN"),
    crmBreakdown: breakdown(visits, (visit) => visit.crm_name ?? "UNKNOWN"),
    recentVisits: visits.filter((visit) => {
      const day = kolkataDay(new Date(visit.event_date));
      return day === today || day === addDays(today, -1);
    }).sort((a, b) => (b.created_at ?? b.event_date).localeCompare(a.created_at ?? a.event_date)).slice(0, 25),
    trend: [...trend.values()].sort((a, b) => a.day.localeCompare(b.day)),
  };
}
