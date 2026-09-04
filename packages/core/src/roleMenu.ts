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

export function canAccessPage(role: UserRole, page: PageId): boolean {
  return allowedPages(role).includes(page);
}

export function getPageForPath(path: string): PageId | undefined {
  // Task evidence used to be its own destination; it is now a panel inside Task
  // Control, so old links and bookmarks land on the workspace that absorbed it.
  if (path === "/task-evidence") return "task_templates";
  if (path === "/tasks/checklist" || path === "/tasks/delegation" || path === "/tasks/import" || path === "/tasks/assigning-left") return "checklist_tasks";
  return ALL_MENU_ITEMS.find((item) => item.path === path)?.id;
}
