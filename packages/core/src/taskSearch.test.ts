import { describe, expect, it } from "vitest";
import { defaultTaskSearch, taskSearchActive, taskSearchFilterCount, taskSearchPayload, decodeTaskSearchPage, taskSearchDateRange } from "./taskSearch";

describe("task search contract", () => {
  it("preserves a shared calendar scope without activating search and rejects unsupported scopes", () => {
    expect(taskSearchActive({ ...defaultTaskSearch(), scope: "today" })).toBe(false);
    expect(taskSearchPayload({ ...defaultTaskSearch(), scope: "overall" })).toMatchObject({ scope: "overall" });
    expect(() => taskSearchPayload({ ...defaultTaskSearch(), scope: "invalid" as "today" })).toThrow();
  });
  it("keeps the ordinary board until search or a filter is applied", () => {
    const defaults = defaultTaskSearch();
    expect(taskSearchActive(defaults)).toBe(false);
    expect(taskSearchActive({ ...defaults, query: "  " })).toBe(false);
    expect(taskSearchActive({ ...defaults, kind: "fms" })).toBe(true);
    expect(taskSearchFilterCount({ ...defaults, query: "client", kind: "crm", from: "2026-01-01", to: "2026-01-31" })).toBe(2);
  });
  it("validates dates and preserves literal search characters at the RPC boundary", () => {
    const defaults = defaultTaskSearch();
    expect(taskSearchPayload({ ...defaults, query: "  50%_ silver  " })).toMatchObject({ query: "50%_ silver", subsection: "any", status: "all" });
    expect(() => taskSearchPayload({ ...defaults, from: "2026-02-30" })).toThrow();
    expect(() => taskSearchPayload({ ...defaults, from: "2026-02-02", to: "2026-02-01" })).toThrow();
    expect(() => taskSearchPayload({ ...defaults, query: "a".repeat(201) })).toThrow();
  });
  it("uses Kolkata calendar dates for quick due ranges", () => {
    expect(taskSearchDateRange("today", new Date("2026-10-18T20:00:00Z"))).toEqual({ from: "2026-10-19", to: "2026-10-19" });
    expect(taskSearchDateRange("week", new Date("2026-10-18T10:00:00Z"))).toEqual({ from: "2026-10-12", to: "2026-10-18" });
  });
  it("validates subsection labels against the bounded returned identifiers", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const page = { ids: [id], total: 100, counts: { pending: 100, overdue: 0, completed: 0, open: 100 }, sections: { [id]: "inLoop" } };
    expect(decodeTaskSearchPage(page).sections[id]).toBe("inLoop");
    expect(() => decodeTaskSearchPage({ ...page, sections: {} })).toThrow();
    expect(() => decodeTaskSearchPage({ ...page, sections: { [id]: "tenant" } })).toThrow();
    expect(decodeTaskSearchPage({ ...page, sections: { [id]: "fms" } }).sections[id]).toBe("fms");
    expect(taskSearchPayload({ ...defaultTaskSearch(), subsection: "fms" })).toMatchObject({ subsection: "fms" });
  });
});
