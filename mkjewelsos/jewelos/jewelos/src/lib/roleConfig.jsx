import {
  Home as HomeIcon, LayoutDashboard, Users, ClipboardList, GitBranch,
  FileText, Bell, UserCog, ListFilter, Settings as SettingsIcon,
} from "lucide-react";
import { DEPARTMENTS } from "../data/org.js";

/* ---------------------------------------------------------------------------
   Role-based menu configuration.
   One source of truth for: what appears in the drawer, what appears in the
   bottom bar, and which routes a profile may open at all.
   --------------------------------------------------------------------------- */

export const ALL_MENU_ITEMS = [
  { page: "Home", label: "Home", path: "/", icon: HomeIcon },
  { page: "Dashboard", label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
  { page: "CRM", label: "Customers", path: "/customers", icon: Users },
  { page: "MyTasks", label: "My tasks", path: "/tasks", icon: ClipboardList },
  { page: "FMSBuilder", label: "Workflows", path: "/workflows", icon: GitBranch },
  { page: "Forms", label: "Forms", path: "/forms", icon: FileText },
  { page: "Notifications", label: "Alerts", path: "/alerts", icon: Bell },
  { page: "UserManagement", label: "Team", path: "/team", icon: UserCog },
  { page: "DropdownManager", label: "Dropdowns", path: "/dropdowns", icon: ListFilter },
  { page: "Settings", label: "Settings", path: "/settings", icon: SettingsIcon },
];

export const PATH_OF = Object.fromEntries(ALL_MENU_ITEMS.map((m) => [m.page, m.path]));
export const PAGE_OF = Object.fromEntries(ALL_MENU_ITEMS.map((m) => [m.path, m.page]));

export const ROLE_PAGES = {
  super_admin: ["Home", "Dashboard", "CRM", "MyTasks", "FMSBuilder", "Forms", "Notifications", "UserManagement", "DropdownManager", "Settings"],
  admin: ["Home", "Dashboard", "CRM", "MyTasks", "FMSBuilder", "Forms", "Notifications", "UserManagement", "DropdownManager", "Settings"],
  manager: ["Home", "Dashboard", "CRM", "MyTasks", "FMSBuilder", "Forms", "Notifications", "UserManagement"],
  team_lead: ["Home", "Dashboard", "CRM", "MyTasks", "FMSBuilder", "Forms", "Notifications"],
  staff: ["Home", "CRM", "MyTasks", "Forms", "Notifications"],
};

/* Staff see a menu tuned to their department rather than the generic staff one. */
export const DEPARTMENT_OVERRIDES = {
  workshop: ["Home", "MyTasks", "Forms", "Notifications"],
  inventory: ["Home", "Dashboard", "MyTasks", "Forms", "Notifications"],
  customer_service: ["Home", "CRM", "MyTasks", "Forms", "Notifications"],
  marketing: ["Home", "Dashboard", "CRM", "Forms", "Notifications"],
};

export const BOTTOM_NAV_PAGES = {
  super_admin: ["Home", "MyTasks", "CRM", "FMSBuilder", "Dashboard"],
  admin: ["Home", "MyTasks", "CRM", "FMSBuilder", "Dashboard"],
  manager: ["Home", "MyTasks", "CRM", "Dashboard", "Notifications"],
  team_lead: ["Home", "MyTasks", "CRM", "FMSBuilder", "Notifications"],
  staff: ["Home", "MyTasks", "CRM", "Forms", "Notifications"],
};

export const ROLE_LABELS = {
  super_admin: { label: "Director", chip: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  admin: { label: "Admin", chip: "bg-violet-100 text-violet-800", dot: "bg-violet-500" },
  manager: { label: "Manager", chip: "bg-blue-100 text-blue-800", dot: "bg-blue-500" },
  team_lead: { label: "Team lead", chip: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
  staff: { label: "Staff", chip: "bg-slate-200 text-slate-700", dot: "bg-slate-400" },
};

const deptType = (id) => DEPARTMENTS.find((d) => d.id === id)?.type;

export function allowedPages(profile) {
  if (!profile) return [];
  // Platform owner bypass: a wildcard permission opens everything.
  if (profile.permissions?.includes("*")) return ROLE_PAGES.super_admin;
  const base = ROLE_PAGES[profile.role_level] || ROLE_PAGES.staff;
  if (profile.role_level === "staff") {
    const override = DEPARTMENT_OVERRIDES[deptType(profile.department_id)];
    if (override) return override;
  }
  return base;
}

export const getMenuForRole = (profile) =>
  ALL_MENU_ITEMS.filter((m) => allowedPages(profile).includes(m.page));

export const getBottomNavForRole = (profile) => {
  const allow = allowedPages(profile);
  return (BOTTOM_NAV_PAGES[profile?.role_level] || BOTTOM_NAV_PAGES.staff)
    .filter((p) => allow.includes(p))
    .slice(0, 5)
    .map((p) => ALL_MENU_ITEMS.find((m) => m.page === p));
};

export const canAccessPage = (page, profile) => allowedPages(profile).includes(page);
