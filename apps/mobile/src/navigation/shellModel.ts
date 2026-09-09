import {
  getLauncherMenuForRole,
  getPageForPath,
  type PageId,
  type UserRole,
} from "@jewelos/core";

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
