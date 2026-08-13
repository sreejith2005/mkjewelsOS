import { describe, expect, it } from "vitest";
import { getSidebarNavigation, type ShellNavItem } from "./ApplicationShell";

const nav = [
  { id: "dashboard", label: "Dashboard", path: "/dashboard" },
  { id: "availability", label: "Availability", path: "/availability" },
  { id: "users", label: "Users", path: "/users" },
  { id: "notifications", label: "Notifications", path: "/notifications" },
  { id: "reports", label: "Reports", path: "/reports" },
  { id: "dropdown_master", label: "Dropdown Master", path: "/dropdown-master" },
  { id: "settings", label: "Settings", path: "/settings" },
] as unknown as readonly ShellNavItem[];

describe("getSidebarNavigation", () => {
  it("keeps Notifications out of the sidebar and anchors system pages at the bottom", () => {
    const sidebar = getSidebarNavigation(nav);

    expect(sidebar.primary.map((item) => item.id)).toEqual(["dashboard", "availability", "users"]);
    expect(sidebar.bottom.map((item) => item.id)).toEqual(["reports", "dropdown_master", "settings"]);
  });
});
