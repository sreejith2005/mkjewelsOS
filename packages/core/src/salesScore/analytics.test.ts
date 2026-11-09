import { describe, expect, it } from "vitest";
import {
  parseSiAnalytics, parseSiSessionPage, siBranchActions, siChange, siCorrelationText, siFilterKey, siFiltersFromQuery, siFiltersToQuery, siFreshnessText,
  siOpportunity, siPeriodRange, siPriorRange, siRank, siRate, siRateText, siServerFilters, siSlotKey, siTier, type SiBranchRow, type SiPeriodTotals,
} from "./analytics";

const B1 = "11111111-1111-4111-8111-111111111111";
const B2 = "22222222-2222-4222-8222-222222222222";
const E1 = "33333333-3333-4333-8333-333333333333";

describe("periods in India time", () => {
  // 18:40 UTC on Mon 5 Oct is 00:10 IST on Tue 6 Oct.
  const lateNight = new Date("2026-10-05T18:40:00Z");
  it("today follows the India date, not UTC", () => {
    expect(siPeriodRange("today", lateNight)).toEqual({ from: "2026-10-06", to: "2026-10-06" });
    expect(siPeriodRange("today", new Date("2026-10-05T18:20:00Z"))).toEqual({ from: "2026-10-05", to: "2026-10-05" });
  });
  it("week starts on Monday and month on the 1st", () => {
    expect(siPeriodRange("week", lateNight)).toEqual({ from: "2026-10-05", to: "2026-10-06" });
    expect(siPeriodRange("week", new Date("2026-10-04T06:00:00Z"))).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(siPeriodRange("month", lateNight)).toEqual({ from: "2026-10-01", to: "2026-10-06" });
  });
  it("custom ranges are validated and bounded to 366 days", () => {
    expect(siPeriodRange("custom", lateNight, { from: "2026-09-01", to: "2026-09-30" })).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(siPeriodRange("custom", lateNight, { from: "2026-09-30", to: "2026-09-01" })).toEqual({ from: "2026-10-01", to: "2026-10-06" });
    expect(siPeriodRange("custom", lateNight, { from: "2024-01-01", to: "2026-09-01" })).toEqual({ from: "2026-10-01", to: "2026-10-06" });
  });
  it("prior period has the same length, immediately before", () => {
    expect(siPriorRange("2026-10-05", "2026-10-06")).toEqual({ from: "2026-10-03", to: "2026-10-04" });
    expect(siPriorRange("2026-10-01", "2026-10-31")).toEqual({ from: "2026-08-31", to: "2026-09-30" });
  });
});

describe("filters", () => {
  const now = new Date("2026-10-05T06:00:00Z");
  it("round-trip through the URL and drop junk", () => {
    const filters = siFiltersFromQuery(`period=custom&from=2026-09-01&to=2026-09-30&branch=${B2},${B1},bad&emp=${E1}&cat=ring&el=nope&crm=lost&stage=ready&product=%20Gold%20chain%20`, now);
    expect(filters).toEqual({ period: "custom", from: "2026-09-01", to: "2026-09-30", branch_ids: [B2, B1], employee_ids: [E1], category: "ring", crm: "lost", stage: "ready", product: "Gold chain" });
    expect(siFiltersFromQuery(siFiltersToQuery(filters), now)).toEqual(filters);
  });
  it("an invalid custom range falls back to this month and says so", () => {
    expect(siFiltersFromQuery("period=custom&from=2026-09-30&to=2026-09-01", now)).toMatchObject({ period: "month", from: "2026-10-01" });
  });
  it("old range links still open", () => {
    expect(siFiltersFromQuery("range=7", now)).toMatchObject({ period: "custom", from: "2026-09-29", to: "2026-10-05" });
  });
  it("send only the keys the server accepts, in a stable order", () => {
    const a = siFiltersFromQuery(`branch=${B2},${B1}&cat=ring`, now);
    const b = siFiltersFromQuery(`cat=ring&branch=${B1},${B2}`, now);
    expect(siServerFilters(a)).toEqual({ from: "2026-10-01", to: "2026-10-05", branch_ids: [B1, B2], category: "ring" });
    expect(siFilterKey(a)).toBe(siFilterKey(b));
    expect(siFilterKey(a)).not.toBe(siFilterKey(siFiltersFromQuery("cat=chain", now)));
    expect(Object.keys(siServerFilters(siFiltersFromQuery("", now)))).toEqual(["from", "to"]);
  });
});

describe("figures: zero, unknown and too few", () => {
  it("never divides by zero", () => {
    expect(siRate(0, 0)).toEqual({ state: "no_data", value: null, part: 0, whole: 0 });
    expect(siRateText(siRate(0, 0))).toBe("No data");
  });
  it("hides rates below the minimum sample", () => {
    expect(siRate(2, 4, 5)).toMatchObject({ state: "insufficient", value: null, whole: 4 });
    expect(siRateText(siRate(2, 4, 5))).toBe("Too few (4)");
  });
  it("shows a real zero as 0%", () => {
    expect(siRate(0, 10, 5)).toMatchObject({ state: "ok", value: 0 });
    expect(siRate(1, 3)).toMatchObject({ state: "ok", value: 33.3 });
  });
  it("compares with the prior period honestly", () => {
    expect(siChange(12, 10, "count").text).toBe("Up 20% vs prior period");
    expect(siChange(5, 0, "count").text).toBe("Up from 0");
    expect(siChange(0, 0, "count").direction).toBe("flat");
    expect(siChange(70, null, "points").text).toBe("No prior figure");
    expect(siChange(62.5, 65, "points").text).toBe("Down 2.5 points vs prior period");
  });
});

const row = (id: string, over: Partial<SiBranchRow> = {}): SiBranchRow => ({
  branch_id: id, branch_name: id, sessions: 10, prior_sessions: 8, scored: 6, average_score: 70, prior_scored: 5, prior_average_score: 65, eligible: 6, confirmed: 3,
  prior_eligible: 4, prior_confirmed: 1, unreviewed: 0, flagged: 0, recorded_ms: 1000, not_linked: 2, interrupted: 0, at_risk: 0, employees: 2, weakest_dimension: null, ...over,
});

describe("rankings", () => {
  it("rank only with enough scored or eligible conversations", () => {
    const rows = [row("a", { average_score: 90, scored: 4 }), row("b", { average_score: 70 }), row("c", { average_score: 80 })];
    const result = siRank(rows, "score");
    expect(result.ranked.map((r) => r.row.branch_id)).toEqual(["c", "b"]);
    expect(result.unranked.map((r) => r.branch_id)).toEqual(["a"]);
    const conversion = siRank([row("a", { eligible: 3, confirmed: 3 }), row("b", { eligible: 10, confirmed: 2 })], "conversion");
    expect(conversion.ranked.map((r) => [r.row.branch_id, r.value])).toEqual([["b", 20]]);
    expect(conversion.unranked).toHaveLength(1);
  });
  it("ties share a rank; volume can toggle", () => {
    const result = siRank([row("a", { sessions: 5 }), row("b", { sessions: 9 }), row("c", { sessions: 5 })], "volume");
    expect(result.ranked.map((r) => r.rank)).toEqual([1, 2, 2]);
  });
  it("tiers need the same minimum", () => {
    expect(siTier({ scored: 5, average_score: 82 })).toBe("strong");
    expect(siTier({ scored: 5, average_score: 59 })).toBe("needs_work");
    expect(siTier({ scored: 4, average_score: 95 })).toBe("insufficient");
  });
});

describe("hypothetical opportunity", () => {
  it("needs interest, a ticket and enough eligible conversations", () => {
    expect(siOpportunity(0, 1, 10, 50_000).state).toBe("none");
    expect(siOpportunity(4, 1, 10, null).state).toBe("no_ticket");
    expect(siOpportunity(4, 1, 3, 50_000).state).toBe("insufficient");
    expect(siOpportunity(4, 2, 10, 50_000)).toMatchObject({ state: "ok", value: 40_000, rate: 20 });
  });
});

const totals = (over: Partial<SiPeriodTotals> = {}) => parseSiAnalytics({ meta: { from: "2026-10-01", to: "2026-10-05" }, current: over, prior: {} }).current;

describe("branch priorities", () => {
  it("lists the urgent work first, naming the figure behind it", () => {
    const actions = siBranchActions([
      row("North", { interrupted: 2, at_risk: 3 }), row("South", { unreviewed: 6, average_score: 55, weakest_dimension: "Needs Discovery", eligible: 10, confirmed: 1 }),
    ], { ...totals(), crm: { ...totals().crm, eligible: 20, confirmed: 8 } });
    expect(actions.map((a) => [a.branch_name, a.priority, a.metric])).toEqual([
      ["North", 1, "interrupted"], ["South", 1, "unreviewed"], ["South", 2, "scored"], ["South", 2, "crm:eligible"], ["North", 3, "at_risk"],
    ]);
    expect(actions[2]?.title).toBe("Coach Needs Discovery");
  });
});

describe("parsing", () => {
  it("fills sparse payloads with zeros and unknowns, never invents values", () => {
    const parsed = parseSiAnalytics({ meta: { from: "2026-10-01", to: "2026-10-05" }, current: { sessions: 3 }, prior: {} });
    expect(parsed.current.sessions).toBe(3);
    expect(parsed.current.average_score).toBeNull();
    expect(parsed.prior.sessions).toBe(0);
    expect(parsed.current.crm.confirmed).toBe(0);
    expect(parsed.by_day).toEqual([]);
    expect(parsed.correlation.employees.r).toBeNull();
    expect(parsed.meta.ticket_inr).toBeNull();
  });
  it("rejects a malformed summary or page", () => {
    expect(() => parseSiAnalytics({})).toThrow();
    expect(() => parseSiSessionPage({ rows: [{}], has_more: false })).toThrow();
  });
  it("reads a drill-down page", () => {
    const page = parseSiSessionPage({ has_more: true, total: 7, rows: [{ session_id: "s", created_at: "2026-10-05T05:00:00Z", employee_id: E1, branch_id: B1, crm_class: "weird", can_open: false }] });
    expect(page.rows[0]).toMatchObject({ crm_class: "not_linked", can_open: false, score: null });
    expect(page.total).toBe(7);
  });
});

describe("wording", () => {
  it("correlation carries N and the caveat", () => {
    expect(siCorrelationText(0.42, 12)).toBe("r = 0.42 over 12: a moderate positive relationship. Correlation is not causation.");
    expect(siCorrelationText(0.9, 3)).toBe("Not enough data (3 pairs; at least 5 needed).");
    expect(siCorrelationText(null, 8)).toContain("Not enough data");
  });
  it("slot keys stay inside the week", () => {
    expect(siSlotKey(1, 23)).toBe("slot:1-23");
    expect(siSlotKey(9, -2)).toBe("slot:7-0");
  });
  it("freshness says what is still on its way", () => {
    const meta = parseSiAnalytics({ meta: { from: "2026-10-01", to: "2026-10-05", generated_at: "2026-10-05T06:00:00Z",
      freshness: { analysis_waiting: 2, oldest_analysis_waiting_at: "2026-10-05T05:45:00Z", analysis_enabled: true } }, current: {}, prior: {} }).meta;
    expect(siFreshnessText(meta, new Date("2026-10-05T06:00:00Z"))).toEqual({ tone: "lag", text: "Figures as of 11:30 am IST. 2 waiting for AI review (oldest 15 min)." });
  });
});
