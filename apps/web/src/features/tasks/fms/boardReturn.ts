import { FMS_TASKS_BOARD_BASE } from "@jewelos/core";

const KEY = "jewelos.fms.boardReturn";

/**
 * Remembers the board a card was opened from, so finishing that work returns
 * to the same workflow board (with its filters and scroll position) instead of
 * the workflow list. Per tab, per piece of work; storage may be unavailable.
 */
export function rememberFmsBoardReturn(boardPath: string, workPath: string): void {
  try { window.sessionStorage.setItem(KEY, JSON.stringify({ boardPath, workPath, state: window.history.state })); } catch { /* Returning to the list is fine. */ }
}

/** Where "Back" and "done" go from the work at `currentPath` (the work page's own URL). */
export function fmsTasksReturnPath(currentPath = `${window.location.pathname}${window.location.search}`): string {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null") as { boardPath?: unknown; workPath?: unknown } | null;
    if (saved && typeof saved.boardPath === "string" && saved.workPath === currentPath
      && safeReturnPath(saved.boardPath)) return saved.boardPath;
  } catch { /* Fall back to the workflow list. */ }
  return FMS_TASKS_BOARD_BASE;
}

/** Per-tab board view state: filters, scroll position and the phone's selected stage. */
export function readFmsBoardView<T>(familyId: string): Partial<T> {
  try { const value = JSON.parse(window.sessionStorage.getItem(`jewelos.fms.board.${familyId}`) ?? "{}") as unknown; return typeof value === "object" && value !== null ? value as Partial<T> : {}; }
  catch { return {}; }
}
export function saveFmsBoardView(familyId: string, value: unknown): void {
  try { window.sessionStorage.setItem(`jewelos.fms.board.${familyId}`, JSON.stringify(value)); } catch { /* Optional convenience. */ }
}

/** Only app routes can be a return destination, even if storage was edited. */
function safeReturnPath(path: string): boolean {
  const url = new URL(path, window.location.origin);
  return url.origin === window.location.origin && path.startsWith("/") && !path.startsWith("//")
    && ["/", "/home", "/tasks", "/tasks/in-loop", "/notifications", "/forms", "/fms"].includes(url.pathname);
}

/** Restore the source entry's UI state when navigating back after completion. */
export function returnFromFmsWork(navigate: (path: string) => void): void {
  const current = `${window.location.pathname}${window.location.search}`;
  const path = fmsTasksReturnPath(current);
  let state: unknown = null;
  try {
    const saved: unknown = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null");
    if (saved && typeof saved === "object" && "workPath" in saved && saved.workPath === current && "state" in saved) state = saved.state;
  } catch { /* UI state is optional. */ }
  navigate(path);
  if (`${window.location.pathname}${window.location.search}` === path) window.history.replaceState(state, "", path);
}
