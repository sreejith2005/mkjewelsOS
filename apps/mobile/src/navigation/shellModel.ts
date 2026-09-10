import {
  canAccessPage,
  getLauncherMenuForRole,
  getPageForPath,
  type PageId,
  type UserRole,
} from "@jewelos/core";
import type { ThemeName } from "@jewelos/ui-tokens";

export type NativeTopLevelRoute = "Home" | "Tasks" | "Fms" | "Crm";

export type ShellLauncherItem = Readonly<{
  description: string;
  id: PageId;
  label: string;
  path: string;
}>;

export type NativeDestination =
  | Readonly<{ kind: "tab"; route: NativeTopLevelRoute }>
  | Readonly<{ kind: "section"; page: PageId }>;

export type NativeNavigationHandlers = Readonly<{
  navigateSection: (page: PageId) => void;
  navigateTab: (route: NativeTopLevelRoute) => void;
  setPath: (path: string) => void;
}>;

const ROUTE_PATH: Readonly<Record<NativeTopLevelRoute, string>> = {
  Home: "/",
  Tasks: "/tasks",
  Fms: "/tasks/fms",
  Crm: "/crm",
};

const PAGE_ROUTE: Partial<Readonly<Record<PageId, NativeTopLevelRoute>>> = {
  home: "Home",
  checklist_tasks: "Tasks",
  fms_tasks: "Fms",
  crm: "Crm",
};

const TASK_PATHS = new Set([
  "/tasks",
  "/tasks/checklist",
  "/tasks/delegation",
  "/tasks/fms",
  "/tasks/import",
  "/tasks/assigning-left",
]);

export function isTaskPath(path: string): boolean {
  return TASK_PATHS.has(path);
}

export function pathForTopLevelRoute(route: NativeTopLevelRoute): string {
  return ROUTE_PATH[route];
}

export function resolveNativeDestination(path: string): NativeDestination | null {
  const page = getPageForPath(path);
  if (!page) return null;
  const route = PAGE_ROUTE[page];
  return route ? { kind: "tab", route } : { kind: "section", page };
}

/** Execute a web-path navigation request against the native tab shell. */
export function navigatePath(
  path: string,
  role: UserRole,
  handlers: NativeNavigationHandlers,
): boolean {
  const destination = resolveNativeDestination(path);
  if (!destination) return false;
  const page: PageId = destination.kind === "section"
    ? destination.page
    : destination.route === "Home"
      ? "home"
      : destination.route === "Tasks"
        ? "checklist_tasks"
        : destination.route === "Fms"
          ? "fms_tasks"
          : "crm";
  if (!canAccessPage(role, page)) return false;

  handlers.setPath(path);
  if (destination.kind === "tab") handlers.navigateTab(destination.route);
  else handlers.navigateSection(destination.page);
  return true;
}

export function buildLauncherItems(role: UserRole): readonly ShellLauncherItem[] {
  return getLauncherMenuForRole(role);
}

export function themeToggleLabel(name: ThemeName): string {
  return name === "dark" ? "Switch to light mode" : "Switch to dark mode";
}
