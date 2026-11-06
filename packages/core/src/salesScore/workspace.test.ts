import { describe, expect, it } from "vitest";
import {
  activeFilterCount, conversationFiltersFromQuery, conversationFiltersToQuery, conversationStatus, followUpChoices, formatDuration, formatRecordedTotal,
  groupByIstDay, istDateKey, istDateRange, parseConversationPage, parseDevicePage, parseInsights, parseToday, relativeTime, scoreBand, scoreTrend, share,
  type ConversationCard,
} from "./workspace";

const card = (patch: Partial<ConversationCard> = {}): ConversationCard => ({
  id: "s1", employee_id: "e1", employee_name: "Asha", branch_name: "Store", created_at: "2026-11-05T06:00:00Z", capture_ended_at: null, status: "ready",
  stage: "ready", error_reason: null, expires_at: "2026-11-12T06:00:00Z", retention_expired: false, duration_ms: 240_000, customer_linked: false,
  transcript_ready: true, awaiting_review: false, analysis: null, ...patch,
});

describe("conversation filters in the URL", () => {
  it("round-trips every supported filter", () => {
    const filters = { q: "chain", date_from: "2026-11-01", date_to: "2026-11-05", stage: "ready", outcome: "follow_up", min_score: 60, max_minutes: 30, linked: true, flagged: true } as const;
    expect(conversationFiltersFromQuery(conversationFiltersToQuery(filters))).toEqual(filters);
  });
  it("drops malformed and unknown values instead of sending them", () => {
    expect(conversationFiltersFromQuery("?stage=deleted&outcome=sold&min_score=500&from=yesterday&employee=bob&evil=1")).toEqual({});
  });
  it("counts a range once and ignores search", () => {
    expect(activeFilterCount({ q: "x", min_score: 1, max_score: 9, date_from: "2026-11-01", date_to: "2026-11-02", linked: true })).toBe(3);
  });
  it("produces an empty query for no filters", () => {
    expect(conversationFiltersToQuery({})).toBe("");
  });
});

describe("India-time grouping", () => {
  it("puts a late-evening UTC time on the next IST day", () => {
    expect(istDateKey("2026-11-04T19:00:00Z")).toBe("2026-11-05");
  });
  it("labels today and yesterday and keeps order", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    const groups = groupByIstDay([card({ id: "a", created_at: "2026-11-05T05:00:00Z" }), card({ id: "b", created_at: "2026-11-04T05:00:00Z" }), card({ id: "c", created_at: "2026-11-01T05:00:00Z" })], now);
    expect(groups.map((g) => g.label)).toEqual(["Today", "Yesterday", "Sun, 1 Nov"]);
  });
  it("builds an inclusive day range", () => {
    expect(istDateRange(7, new Date("2026-11-05T10:00:00Z"))).toEqual({ from: "2026-10-30", to: "2026-11-05" });
  });
});

describe("plain wording", () => {
  it("formats durations people read at a glance", () => {
    expect(formatDuration(45_000)).toBe("45 sec");
    expect(formatDuration(240_000)).toBe("4 min");
    expect(formatDuration(3_900_000)).toBe("1 h 05 min");
    expect(formatRecordedTotal(12_600_000)).toBe("3.5 h");
  });
  it("never says Saved while audio is still uploading", () => {
    expect(conversationStatus(card({ stage: "saving", status: "saving" })).label).toBe("Saving");
    expect(conversationStatus(card({ stage: "saving", status: "saving" })).detail).toMatch(/until it says Saved/);
  });
  it("explains an interrupted recording without blame", () => {
    expect(conversationStatus(card({ stage: "needs_attention", error_reason: "capture_interrupted" })).detail).toMatch(/saved before that is kept/);
  });
  it("shows removed conversations as removed", () => {
    expect(conversationStatus(card({ retention_expired: true })).label).toBe("Removed");
  });
  it("tells the employee a manager review is pending", () => {
    expect(conversationStatus(card({ awaiting_review: true })).detail).toMatch(/manager is reviewing/);
  });
  it("bands scores and trends", () => {
    expect([scoreBand(85), scoreBand(70), scoreBand(40)]).toEqual(["strong", "good", "needs_work"]);
    expect([scoreTrend(60, 70), scoreTrend(70, 60), scoreTrend(70, 71), scoreTrend(null, 70)]).toEqual(["up", "down", "flat", null]);
    expect([share(1, 4), share(1, 0)]).toEqual([25, null]);
  });
  it("describes time since last contact", () => {
    const now = new Date("2026-11-05T10:00:00Z");
    expect(relativeTime("2026-11-05T09:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-11-05T09:56:00Z", now)).toBe("4 min ago");
    expect(relativeTime("2026-11-05T07:00:00Z", now)).toBe("3 h ago");
  });
});

describe("follow-up due choices", () => {
  it("offers today only before 5 PM IST", () => {
    expect(followUpChoices(new Date("2026-11-05T06:00:00Z")).map((c) => c.key)).toEqual(["today", "tomorrow", "three_days"]);
    expect(followUpChoices(new Date("2026-11-05T12:00:00Z")).map((c) => c.key)).toEqual(["tomorrow", "three_days"]);
  });
  it("uses IST wall-clock times", () => {
    expect(followUpChoices(new Date("2026-11-05T06:00:00Z"))[1]?.at).toBe("2026-11-06T05:30:00.000Z");
  });
});

describe("contract parsers", () => {
  it("accepts a page and rejects a bad stage", () => {
    const row = { ...card(), analysis: { id: "a", status: "scored", review_state: "approve", score: 82.5, manager_scored: false, outcome: "follow_up", summary: "S", action_count: 2, status_reasons: [] } };
    const page = parseConversationPage({ rows: [row], has_more: false, is_reviewer: true });
    expect(page.rows[0]?.analysis?.score).toBe(82.5);
    expect(() => parseConversationPage({ rows: [{ ...row, stage: "deleted" }], has_more: false })).toThrow();
  });
  it("drops malformed next actions rather than rendering them", () => {
    const today = parseToday({ can_record: true, today: { total: 2 }, recent: [], coaching: { reviewed: 0 }, next_actions: [{ session_id: "s" }, { session_id: "s", analysis_id: "a", action_index: 0, action: "Call", created_at: "2026-11-05T06:00:00Z" }] });
    expect(today.next_actions).toHaveLength(1);
    expect(today.today.total).toBe(2);
    expect(today.coaching.focus).toBeNull();
  });
  it("fills every device status count", () => {
    const page = parseDevicePage({ rows: [], total: 0, counts: { recording: 1 } });
    expect(page.counts).toEqual({ interrupted: 0, recording: 1, paused: 0, saving: 0, idle: 0, not_seen: 0 });
  });
  it("keeps insight outcomes complete and CRM unclaimed by default", () => {
    const insights = parseInsights({ range: { from: "a", to: "b" }, totals: { conversations: 3 }, by_day: [], by_employee: [], outcomes: { follow_up: 1 } });
    expect(insights.outcomes).toEqual({ reported_purchase: 0, follow_up: 1, enquiry: 0, no_purchase: 0, unknown: 0 });
    expect(insights.crm_outcomes_connected).toBe(false);
  });
});
