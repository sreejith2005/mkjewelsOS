/**
 * Role-Based Menu Configuration
 * Controls which pages each role can access in sidebar + bottom nav
 *
 * role_level values (from UserProfile entity):
 *   super_admin | tenant_admin | branch_manager | department_head | team_lead | staff
 *
 * department-based overrides:
 *   If userProfile.department_type === 'sales'         → SALES menu
 *   If userProfile.department_type === 'customer_service' → CRM menu
 *   If userProfile.department_type === 'housekeeping'  → HOUSEKEEPING menu
 */

import { Home, Users, ClipboardList, GitBranch, FileText, Bell, BarChart3, Settings, UserCog, SlidersHorizontal } from 'lucide-react';

export const ALL_MENU_ITEMS = [
  { id: 'Home',            name: 'Home',             icon: Home,               page: 'Home',             group: 'main' },
  { id: 'Dashboard',       name: 'Dashboard',        icon: BarChart3,          page: 'Dashboard',        group: 'main' },
  { id: 'CRM',             name: 'CRM',              icon: Users,              page: 'CRM',              group: 'crm' },
  { id: 'MyTasks',         name: 'My Tasks',         icon: ClipboardList,      page: 'MyTasks',          group: 'tasks' },
  { id: 'FMSBuilder',      name: 'FMS Builder',      icon: GitBranch,          page: 'FMSBuilder',       group: 'tasks' },
  { id: 'Forms',           name: 'Forms',            icon: FileText,           page: 'Forms',            group: 'forms' },
  { id: 'Notifications',   name: 'Notifications',    icon: Bell,               page: 'Notifications',    group: 'system' },
  { id: 'UserManagement',  name: 'User Management',  icon: UserCog,            page: 'UserManagement',   group: 'system' },
  { id: 'DropdownManager', name: 'Dropdown Manager', icon: SlidersHorizontal,  page: 'DropdownManager',  group: 'system' },
  { id: 'Settings',        name: 'Settings',         icon: Settings,           page: 'Settings',         group: 'system' },
];

// Pages each role can access
const ROLE_PAGES = {
  super_admin:      ['Home', 'Dashboard', 'CRM', 'MyTasks', 'FMSBuilder', 'Forms', 'Notifications', 'UserManagement', 'DropdownManager', 'Settings'],
  tenant_admin:     ['Home', 'Dashboard', 'CRM', 'MyTasks', 'FMSBuilder', 'Forms', 'Notifications', 'UserManagement', 'Settings'],
  branch_manager:   ['Home', 'Dashboard', 'CRM', 'MyTasks', 'FMSBuilder', 'Forms', 'Notifications', 'Settings'],
  department_head:  ['Home', 'Dashboard', 'CRM', 'MyTasks', 'FMSBuilder', 'Forms', 'Notifications'],
  team_lead:        ['Home', 'Dashboard', 'CRM', 'MyTasks', 'FMSBuilder', 'Forms', 'Notifications'],
  staff:            ['Home', 'Dashboard', 'CRM', 'MyTasks', 'FMSBuilder', 'Forms', 'Notifications'],
};

// Department-type overrides for `staff` role
const DEPARTMENT_OVERRIDES = {
  sales:            ['Home', 'Dashboard', 'CRM', 'MyTasks', 'FMSBuilder', 'Notifications'],
  customer_service: ['Home', 'CRM', 'MyTasks', 'FMSBuilder', 'Notifications'],
  housekeeping:     ['Home', 'MyTasks', 'FMSBuilder', 'Notifications'],
  workshop:         ['Home', 'MyTasks', 'FMSBuilder', 'Workflows', 'Notifications'],
  inventory:        ['Home', 'MyTasks', 'FMSBuilder', 'Workflows', 'Forms', 'Notifications'],
  marketing:        ['Home', 'CRM', 'Forms', 'FMSBuilder', 'Dashboard', 'Notifications'],
};

// Bottom nav — always max 5 tabs, role-specific
const BOTTOM_NAV_PAGES = {
  super_admin:      ['Home', 'CRM', 'MyTasks', 'Forms', 'Dashboard'],
  tenant_admin:     ['Home', 'CRM', 'MyTasks', 'Forms', 'Dashboard'],
  branch_manager:   ['Home', 'CRM', 'MyTasks', 'Forms', 'Dashboard'],
  department_head:  ['Home', 'CRM', 'MyTasks', 'Forms', 'Dashboard'],
  team_lead:        ['Home', 'CRM', 'MyTasks', 'Notifications', 'Dashboard'],
  staff:            ['Home', 'MyTasks', 'FMSBuilder', 'CRM', 'Dashboard'],
};

const DEPARTMENT_BOTTOM_NAV = {
  sales:            ['Home', 'CRM', 'MyTasks', 'Notifications', 'Dashboard'],
  customer_service: ['Home', 'CRM', 'MyTasks', 'Notifications', 'Dashboard'],
  housekeeping:     ['Home', 'MyTasks', 'Notifications', 'Dashboard', 'Home'],
  workshop:         ['Home', 'MyTasks', 'Workflows', 'Notifications', 'Dashboard'],
};

export function getMenuForRole(userProfile) {
  const role = userProfile?.role_level || 'staff';
  const deptType = userProfile?.department_type;

  let allowedPages = ROLE_PAGES[role] || ROLE_PAGES.staff;

  // Apply department override only for non-manager staff
  if (role === 'staff' && deptType && DEPARTMENT_OVERRIDES[deptType]) {
    allowedPages = DEPARTMENT_OVERRIDES[deptType];
  }

  return ALL_MENU_ITEMS.filter(item => allowedPages.includes(item.id));
}

export function getBottomNavForRole(userProfile) {
  const role = userProfile?.role_level || 'staff';
  const deptType = userProfile?.department_type;

  let pages = BOTTOM_NAV_PAGES[role] || BOTTOM_NAV_PAGES.staff;

  if (role === 'staff' && deptType && DEPARTMENT_BOTTOM_NAV[deptType]) {
    pages = DEPARTMENT_BOTTOM_NAV[deptType];
  }

  // Deduplicate and always include Notifications
  const unique = [...new Set(pages)];
  return ALL_MENU_ITEMS.filter(item => unique.includes(item.id))
    .sort((a, b) => unique.indexOf(a.id) - unique.indexOf(b.id))
    .slice(0, 5);
}

export function canAccessPage(pageName, userProfile) {
  const menu = getMenuForRole(userProfile);
  return menu.some(item => item.page === pageName);
}

export const ROLE_LABELS = {
  super_admin:     { label: 'Super Admin', color: 'bg-red-100 text-red-700' },
  tenant_admin:    { label: 'Admin',       color: 'bg-purple-100 text-purple-700' },
  branch_manager:  { label: 'Manager',     color: 'bg-blue-100 text-blue-700' },
  department_head: { label: 'Dept. Head',  color: 'bg-indigo-100 text-indigo-700' },
  team_lead:       { label: 'Team Lead',   color: 'bg-cyan-100 text-cyan-700' },
  staff:           { label: 'Staff',       color: 'bg-slate-100 text-slate-600' },
};