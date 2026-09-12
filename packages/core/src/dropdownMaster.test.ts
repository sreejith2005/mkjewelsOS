import { describe, expect, it } from "vitest";
import {
  dropdownMasterCounts,
  filterDropdownMasterItems,
  isDropdownMasterItemActive,
  type DropdownMasterItemLike,
} from "./dropdownMaster.ts";

const items: DropdownMasterItemLike[] = [
  { master_type: "designation", label: "Sales Executive", value: "sales_executive", is_active: true },
  { master_type: "designation", label: "Store Manager", value: "store_manager", is_active: false },
  { master_type: "designation", label: "Cashier", value: "cashier", is_active: null },
  { master_type: "week_off", label: "Sunday", value: "sunday", is_active: true },
];

describe("isDropdownMasterItemActive", () => {
  it("treats only an explicit false as inactive", () => {
    expect(isDropdownMasterItemActive({ master_type: "x", label: "a", value: "a", is_active: true })).toBe(true);
    expect(isDropdownMasterItemActive({ master_type: "x", label: "a", value: "a", is_active: null })).toBe(true);
    expect(isDropdownMasterItemActive({ master_type: "x", label: "a", value: "a" })).toBe(true);
    expect(isDropdownMasterItemActive({ master_type: "x", label: "a", value: "a", is_active: false })).toBe(false);
  });
});

describe("filterDropdownMasterItems", () => {
  it("keeps only the selected category", () => {
    expect(filterDropdownMasterItems(items, "week_off", "all", "")).toHaveLength(1);
  });

  it("matches the label, the value, or the category", () => {
    expect(filterDropdownMasterItems(items, "designation", "all", "store_manager")).toHaveLength(1);
    expect(filterDropdownMasterItems(items, "designation", "all", "Cashier")).toHaveLength(1);
    expect(filterDropdownMasterItems(items, "designation", "all", "designation")).toHaveLength(3);
  });

  it("ignores surrounding space and case in the search term", () => {
    expect(filterDropdownMasterItems(items, "designation", "all", "  STORE  ")).toHaveLength(1);
  });

  it("splits on status, counting a null is_active as active", () => {
    expect(filterDropdownMasterItems(items, "designation", "active", "")).toHaveLength(2);
    expect(filterDropdownMasterItems(items, "designation", "inactive", "")).toHaveLength(1);
  });
});

describe("dropdownMasterCounts", () => {
  it("counts the whole category for Total and Inactive", () => {
    const visible = filterDropdownMasterItems(items, "designation", "all", "");
    expect(dropdownMasterCounts(items, "designation", visible)).toEqual({ total: 3, active: 2, inactive: 1 });
  });

  // The approved web page does exactly this: Active narrows with the search
  // box while Total and Inactive do not, so the three do not have to sum.
  it("counts only the visible rows for Active", () => {
    const visible = filterDropdownMasterItems(items, "designation", "all", "cashier");
    expect(dropdownMasterCounts(items, "designation", visible)).toEqual({ total: 3, active: 1, inactive: 1 });
  });

  it("leaves Total and Inactive standing when nothing matches the search", () => {
    const visible = filterDropdownMasterItems(items, "designation", "all", "no such item");
    expect(dropdownMasterCounts(items, "designation", visible)).toEqual({ total: 3, active: 0, inactive: 1 });
  });

  it("is all zeroes for a category with no items", () => {
    expect(dropdownMasterCounts(items, "crm_source", [])).toEqual({ total: 0, active: 0, inactive: 0 });
  });
});
