import { describe, expect, it } from "vitest";
import { parseInsightsFilter, encodeInsightsSearch, decodeInsightsSearch } from "./insightsFilters";
import { buildAttentionFindings } from "./insights";
describe("insights filter contract", () => {
  it("validates dates, scope and unsupported keys", () => {
    for (const input of [{from:"2026-02-30",to:"2026-03-02"},{from:"2026-03-02",to:"2026-03-01"},{branch_id:"other"},{secret:"bad"}]) {
      expect(() => parseInsightsFilter(input)).toThrow();
    }
  });
  it("round trips shareable filters without private values", () => {
    const f = parseInsightsFilter({preset:"custom",from:"2026-01-01",to:"2026-12-31",tab:"tasks",groupBy:"department"});
    expect(decodeInsightsSearch(encodeInsightsSearch(f))).toEqual(f);
    expect(decodeInsightsSearch("?tab=unknown").tab).toBe("overview");
  });
  it("ranks evidence with explicit denominators without inventing improvements", () => {
    const findings = buildAttentionFindings([{key:"overdue",label:"Overdue work",value:4,previous:null,numerator:null,denominator:null,basis:"current",module:"tasks"}]);
    expect(findings[0]?.metricKey).toBe("overdue");
    expect(findings[0]?.description).toContain("4");
    expect(buildAttentionFindings([])).toEqual([]);
  });
});
