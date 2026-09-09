import {
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

export function buildLauncherItems(role: UserRole): readonly ShellLauncherItem[] {
  return getLauncherMenuForRole(role);
}

export function themeToggleLabel(name: ThemeName): string {
  return name === "dark" ? "Switch to light mode" : "Switch to dark mode";
}
