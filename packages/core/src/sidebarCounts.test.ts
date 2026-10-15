import { describe, expect, it } from "vitest";
import { decodeSidebarCounts, sidebarCountLabel } from "./sidebarCounts";

describe("personal sidebar counts", () => {
  it("preserves exact counts and discards invalid or unknown entries", () => {
    expect(decodeSidebarCounts({ checklist_tasks: 1203, availability: 2, home: -1, notifications: 1.5, unknown: 99, forms_library: "3" })).toEqual({ checklist_tasks: 1203, availability: 2 });
    expect(decodeSidebarCounts(null)).toEqual({});
  });
  it("shows exact positive counts and leaves zero or unavailable labels alone", () => {
    expect(sidebarCountLabel("Tasks", 1203)).toBe("Tasks (1203)");
    expect(sidebarCountLabel("Tasks", 0)).toBe("Tasks");
    expect(sidebarCountLabel("Tasks", undefined)).toBe("Tasks");
  });
});
