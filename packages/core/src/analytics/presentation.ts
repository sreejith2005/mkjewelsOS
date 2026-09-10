import type { UserRole } from "../roleMenu";

export const DASHBOARD_RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "this_week", label: "This Week" },
  { value: "this_month", label: "This Month" },
  { value: "last_7_days", label: "Last 7 Days" },
  { value: "last_30_days", label: "Last 30 Days" },
  { value: "custom", label: "Custom" },
] as const;

export type DashboardRange = (typeof DASHBOARD_RANGE_OPTIONS)[number]["value"];

export function dashboardHeadingForRole(role: UserRole): string {
  return ["super_admin", "admin", "manager", "hr"].includes(role)
    ? "Manager View"
    : "My Performance";
}
