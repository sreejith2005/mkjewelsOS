export const USER_ROLES = [
  "super_admin",
  "admin",
  "manager",
  "hr",
  "crm",
  "staff",
  "doer",
  "housekeeping",
] as const;

export type UserRole = (typeof USER_ROLES)[number];

export const PAGE_IDS = [
  "home",
  "dashboard",
  "crm",
  "checklist_tasks",
  "recurring_todo",
  "task_templates",
  // Retired as a destination: evidence is now a panel inside Task Control. The id
  // stays because the database section-availability contract still declares it.
  "task_evidence",
  "delegation_tasks",
  "fms_tasks",
  "fms_builder",
  "forms_library",
  "meeting_ai",
  "notifications",
  "users",
  "availability",
  "reports",
  "dropdown_master",
  "settings",
] as const;

export type PageId = (typeof PAGE_IDS)[number];

export type MenuItem = Readonly<{
  id: PageId;
  label: string;
  path: string;
}>;

export type LauncherMenuItem = MenuItem & Readonly<{ description: string }>;

export const ALL_MENU_ITEMS: readonly MenuItem[] = [
  { id: "home", label: "Home", path: "/" },
  { id: "dashboard", label: "Dashboard", path: "/dashboard" },
  { id: "crm", label: "CRM", path: "/crm" },
  { id: "checklist_tasks", label: "Tasks", path: "/tasks" },
  { id: "recurring_todo", label: "Recurring / To-Do", path: "/recurring-todo" },
  { id: "task_templates", label: "Task Control", path: "/task-templates" },
  { id: "fms_builder", label: "FMS", path: "/fms" },
  { id: "forms_library", label: "Forms Library", path: "/forms" },
  { id: "meeting_ai", label: "Meeting AI", path: "/meeting-ai" },
  { id: "notifications", label: "Notifications", path: "/notifications" },
  { id: "users", label: "Users", path: "/users" },
  { id: "availability", label: "Availability", path: "/availability" },
  { id: "reports", label: "Reports", path: "/reports" },
  { id: "dropdown_master", label: "Dropdown Master", path: "/dropdown-master" },
  { id: "settings", label: "Settings", path: "/settings" },
] as const;

export const IMPLEMENTED_PAGE_IDS: readonly PageId[] = [
  "home",
  "dashboard",
  "checklist_tasks",
  "recurring_todo",
  "task_templates",
  "users",
  "availability",
  "dropdown_master",
  "forms_library",
  "fms_tasks",
  "fms_builder",
  "notifications",
  "crm",
  "reports",
  "settings",
] as const;

const IMPLEMENTED_PAGES = new Set<PageId>(IMPLEMENTED_PAGE_IDS);

const APP_DESCRIPTIONS: Partial<Readonly<Record<PageId, string>>> = {
  home: "See today's authorized work, linked forms, FMS stages, and activity.",
  dashboard: "Review truthful operational analytics and transparent formulas.",
  crm: "Manage clients, walk-ins, interactions, follow-ups, and documents.",
  fms_tasks: "Run assigned stages and authorized workflows.",
  fms_builder: "Run live workflows and design versioned process flows.",
  users: "Browse employees by department and manage authorized accounts.",
  availability: "Record real working availability.",
  recurring_todo: "Manage recurring schedules, personal work, verification, follow-ups, and coverage.",
  task_templates: "Track progress, chase overdue work, review evidence, and manage every task template in one place.",
  dropdown_master: "Maintain active master values.",
  reports: "Preview fixed reports and manage private CSV exports.",
  settings: "Manage account preferences and authorized organization defaults.",
};

const COMMON_WORK_PAGES: readonly PageId[] = [
  "home",
  "dashboard",
  "checklist_tasks",
  "fms_builder",
  "forms_library",
  "meeting_ai",
  "notifications",
  "availability",
  "reports",
  "settings",
];

export const ROLE_PAGES: Readonly<Record<UserRole, readonly PageId[]>> = {
  super_admin: PAGE_IDS,
  admin: PAGE_IDS.filter((page) => page !== "dropdown_master"),
  manager: [...COMMON_WORK_PAGES, "crm", "users", "reports", "task_templates"],
  hr: [
    "home",
    "dashboard",
    "checklist_tasks",
    "notifications",
    "users",
    "availability",
    "reports",
    "settings",
    "task_templates",
  ],
  crm: [...COMMON_WORK_PAGES, "crm", "reports"],
  staff: COMMON_WORK_PAGES,
  doer: ["home", "dashboard", "checklist_tasks", "fms_builder", "notifications", "availability", "reports", "settings"],
  housekeeping: [
    "home",
    "dashboard",
    "checklist_tasks",
    "notifications",
    "availability",
    "reports",
    "settings",
  ],
};

export function allowedPages(role: UserRole): readonly PageId[] {
  return ROLE_PAGES[role];
}

export function getMenuForRole(role: UserRole): readonly MenuItem[] {
  const allowed = new Set(allowedPages(role));
  return ALL_MENU_ITEMS.filter((item) => allowed.has(item.id));
}

export function isImplementedPage(page: PageId): boolean {
  return IMPLEMENTED_PAGES.has(page);
}

export function getImplementedMenuForRole(role: UserRole): readonly MenuItem[] {
  return getMenuForRole(role).filter((item) => isImplementedPage(item.id));
}

export function getLauncherMenuForRole(role: UserRole): readonly LauncherMenuItem[] {
  return getImplementedMenuForRole(role).flatMap((item) => {
    const description = APP_DESCRIPTIONS[item.id];
    return description ? [{ ...item, description }] : [];
  });
}

export function canAccessPage(role: UserRole, page: PageId): boolean {
  return allowedPages(role).includes(page);
}

export function getPageForPath(path: string): PageId | undefined {
  // Task evidence used to be its own destination; it is now a panel inside Task
  // Control, so old links and bookmarks land on the workspace that absorbed it.
  if (path === "/task-evidence") return "task_templates";
  if (path === "/tasks/fms") return "fms_tasks";
  if (path === "/tasks/checklist" || path === "/tasks/delegation" || path === "/tasks/import" || path === "/tasks/assigning-left") return "checklist_tasks";
  // Permission management lives inside Settings; the page itself additionally
  // requires the protected permissions.manage permission.
  if (path === "/settings/permissions") return "settings";
  // FMS form deep links point at /tasks/fms; the unified FMS section absorbs them.
  if (path === "/tasks/fms") return "fms_builder";
  return ALL_MENU_ITEMS.find((item) => item.path === path)?.id;
}
