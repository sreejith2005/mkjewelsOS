import { describe, expect, it } from "vitest";
import { formatMetric, METRIC_CATALOG, normalizeChartSeries, normalizeDateRange, previousPeriod, safeRate } from "./index";

describe("analytics date ranges", () => {
  const now = new Date("2026-08-10T18:45:00Z");
  it("uses the tenant-local day and an exclusive end", () => expect(normalizeDateRange({preset:"today",timezone:"Asia/Kolkata",now})).toMatchObject({localStart:"2026-08-11",localEndExclusive:"2026-08-12"}));
  it("normalizes Monday-based weeks", () => expect(normalizeDateRange({preset:"this_week",timezone:"Asia/Kolkata",now:new Date("2026-08-12T12:00:00Z")})).toMatchObject({localStart:"2026-08-10",localEndExclusive:"2026-08-17"}));
  it("normalizes month, rolling, and custom ranges", () => {
    expect(normalizeDateRange({preset:"this_month",timezone:"Asia/Kolkata",now}).localEndExclusive).toBe("2026-09-01");
    expect(normalizeDateRange({preset:"last_7_days",timezone:"Asia/Kolkata",now}).localStart).toBe("2026-08-05");
    expect(normalizeDateRange({preset:"last_30_days",timezone:"Asia/Kolkata",now}).localStart).toBe("2026-07-13");
    expect(normalizeDateRange({preset:"custom",timezone:"Asia/Kolkata",from:"2026-08-01",to:"2026-08-10",now}).localEndExclusive).toBe("2026-08-11");
  });
  it("calculates the immediately preceding equal-duration period", () => expect(previousPeriod(normalizeDateRange({preset:"custom",timezone:"Asia/Kolkata",from:"2026-08-01",to:"2026-08-10",now}))).toMatchObject({localStart:"2026-07-22",localEndExclusive:"2026-08-01"}));
  it("rejects invalid or overlong ranges", () => { expect(() => normalizeDateRange({preset:"custom",timezone:"UTC",from:"bad",to:"2026-08-10"})).toThrow(); expect(() => normalizeDateRange({preset:"custom",timezone:"UTC",from:"2025-01-01",to:"2026-08-10"})).toThrow(); });
});

describe("metric catalog and formatting", () => {
  it("has stable unique definitions with truthful empty behavior", () => {
    expect(new Set(METRIC_CATALOG.map((item)=>item.key)).size).toBe(METRIC_CATALOG.length);
    expect(METRIC_CATALOG.every((item)=>item.definition && item.dateWindow && item.scope)).toBe(true);
    expect(METRIC_CATALOG.some((item)=>/revenue|sales conversion|target|product mix|loyalty|vip|score|ranking/i.test(`${item.key} ${item.displayName}`))).toBe(false);
  });
  it("uses null for zero denominators", () => { expect(safeRate(0,0)).toBeNull(); expect(safeRate(3,4)).toBe(75); });
  it("formats counts, percentages, duration, no-data, and not-applicable", () => {
    const rate=METRIC_CATALOG.find((item)=>item.key==="task_completion_rate")!;
    const delay=METRIC_CATALOG.find((item)=>item.key==="average_completion_delay")!;
    expect(formatMetric({key:rate.key,value:75},rate)).toBe("75.0%");
    expect(formatMetric({key:rate.key,value:null},rate)).toBe("No data");
    expect(formatMetric({key:delay.key,value:90},delay)).toBe("1.5 hr");
    expect(formatMetric({key:delay.key,value:null},delay)).toBe("Not applicable");
  });
  it("normalizes bounded chart series", () => expect(normalizeChartSeries([{label:"A",value:Number.NaN},{label:"B",value:2}],1)).toEqual([{label:"A",value:0}]));
});
