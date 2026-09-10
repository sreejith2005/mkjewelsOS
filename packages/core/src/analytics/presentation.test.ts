import { describe, expect, it } from "vitest";
import { DASHBOARD_RANGE_OPTIONS, dashboardHeadingForRole } from "./presentation";

describe("dashboardHeadingForRole", () => {
  it.each(["super_admin", "admin", "manager", "hr"] as const)(
    "shows the manager heading to %s",
    (role) => expect(dashboardHeadingForRole(role)).toBe("Manager View"),
  );

  it.each(["crm", "staff", "doer", "housekeeping"] as const)(
    "shows the personal heading to %s",
    (role) => expect(dashboardHeadingForRole(role)).toBe("My Performance"),
  );
});

it("keeps the approved dashboard range order and API values", () => {
  expect(DASHBOARD_RANGE_OPTIONS).toEqual([
    { value: "today", label: "Today" },
    { value: "this_week", label: "This Week" },
    { value: "this_month", label: "This Month" },
    { value: "last_7_days", label: "Last 7 Days" },
    { value: "last_30_days", label: "Last 30 Days" },
    { value: "custom", label: "Custom" },
  ]);
});
