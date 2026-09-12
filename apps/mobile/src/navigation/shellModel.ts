import {
  getAccessibleMenu,
  getLauncherMenuForRole,
  getPageForPath,
  resolvePageAccess,
  type AccessContext,
  type MenuItem,
  type PageAccessDecision,
  type PageId,
  type SectionControls,
} from "@jewelos/core";
import type { ThemeName } from "@jewelos/ui-tokens";

/** The two high-frequency destinations retained in compact bottom navigation. */
export const COMPACT_DOCK_PATHS = ["/", "/tasks"] as const;

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

/** Everything the shell's one access decision needs, as on web. */
export type ShellAccess = Readonly<{ access: AccessContext; controls: SectionControls }>;

const ROUTE_PATH: Readonly<Record<NativeTopLevelRoute, string>> = {
  Home: "/",
  Tasks: "/tasks",
  Fms: "/fms",
  Crm: "/crm",
};

/**
 * The unified FMS section (`fms_builder`) is its own tab. `fms_tasks` — what
 * `@jewelos/core` still resolves `/tasks/fms` form deep links to — lands on the
 * same tab, because that section absorbed the old workflow-task page.
 */
const PAGE_ROUTE: Partial<Readonly<Record<PageId, NativeTopLevelRoute>>> = {
  home: "Home",
  checklist_tasks: "Tasks",
  fms_builder: "Fms",
  fms_tasks: "Fms",
  crm: "Crm",
};

const ROUTE_PAGE: Readonly<Record<NativeTopLevelRoute, PageId>> = {
  Home: "home",
  Tasks: "checklist_tasks",
  Fms: "fms_builder",
  Crm: "crm",
};

const TASK_PATHS = new Set([
  "/tasks",
  "/tasks/checklist",
  "/tasks/delegation",
  "/tasks/import",
  "/tasks/assigning-left",
]);

export function isTaskPath(path: string): boolean {
  return TASK_PATHS.has(path);
}

export function pathForTopLevelRoute(route: NativeTopLevelRoute): string {
  return ROUTE_PATH[route];
}

export function pageForTopLevelRoute(route: NativeTopLevelRoute): PageId {
  return ROUTE_PAGE[route];
}

export function resolveNativeDestination(path: string): NativeDestination | null {
  // `/tasks/fms` is authorized as Tasks on both clients, but natively the FMS
  // tab owns that workspace. A link carrying assigned-work parameters is
  // resolved by `fmsAssignedWorkRoute` at the call site; a bare path lands here.
  if (path === "/tasks/fms" || path.startsWith("/tasks/fms?")) return { kind: "tab", route: "Fms" };
  const page = getPageForPath(path);
  if (!page) return null;
  const route = PAGE_ROUTE[page];
  return route ? { kind: "tab", route } : { kind: "section", page };
}

/**
 * The same decision the web shell makes: feature availability first, then the
 * user's permission. A disabled section still opens — onto its maintenance
 * notice — exactly as the web route does; only a denied one is refused.
 */
export function pageDecision(shell: ShellAccess, page: PageId): PageAccessDecision {
  return resolvePageAccess(shell.access, shell.controls, page);
}

/** Execute a web-path navigation request against the native tab shell. */
export function navigatePath(path: string, shell: ShellAccess, handlers: NativeNavigationHandlers): boolean {
  const destination = resolveNativeDestination(path);
  if (!destination) return false;
  // Authorize by the page the path itself maps to, not by the page the tab
  // stands for. `/tasks/fms` is assigned work owned by Tasks, but it opens the
  // FMS tab, whose own page is the builder — gating on the tab would refuse an
  // employee their own assigned step.
  const page = getPageForPath(path)
    ?? (destination.kind === "section" ? destination.page : ROUTE_PAGE[destination.route]);
  if (pageDecision(shell, page) === "denied") return false;

  handlers.setPath(path);
  if (destination.kind === "tab") handlers.navigateTab(destination.route);
  else handlers.navigateSection(destination.page);
  return true;
}

/** Sections this user may open right now, in menu order. */
export function accessibleMenu(shell: ShellAccess): readonly MenuItem[] {
  return getAccessibleMenu(shell.access, shell.controls);
}

/**
 * The Super Admin launcher lists every implemented section with its
 * description; keep only the ones this user can open. This is the web
 * shell's launcher rule verbatim.
 */
export function buildLauncherItems(shell: ShellAccess): readonly ShellLauncherItem[] {
  const accessible = new Set(accessibleMenu(shell).map((item) => item.id));
  return getLauncherMenuForRole("super_admin").filter((item) => accessible.has(item.id));
}

export function themeToggleLabel(name: ThemeName): string {
  return name === "dark" ? "Switch to light mode" : "Switch to dark mode";
}
