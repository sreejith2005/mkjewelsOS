import { expect, it } from "vitest";
import { SECTION_PERMISSIONS, previewSectionAccess, sectionOverrideChanges } from "./sectionAccess";
it("shows implemented sections without actions or placeholder sections", () => {
  expect(SECTION_PERMISSIONS.some(item => item.key === "crm.view")).toBe(true);
  expect(SECTION_PERMISSIONS.every(item => item.kind === "module" && item.pageId !== null)).toBe(true);
});
it("inherit reveals department even when the server row has an individual denial", () => {
  const row = { key: "crm.view" as const, roleDefault: false, department: "grant" as const, designation: null, user: "deny" as const, effective: false };
  expect(previewSectionAccess(row, null, "staff")).toEqual({ effective: true, source: "Department" });
  expect(previewSectionAccess(row, "deny", "staff")).toEqual({ effective: false, source: "Individual" });
});
it("keeps authority and action keys out of section changes", () => {
  expect(sectionOverrideChanges({ "crm.view": "deny" }, { "crm.view": null, "forms.manage": "grant" })).toEqual({ "crm.view": null });
});
