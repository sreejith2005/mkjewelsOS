import { FMS_TASKS_BOARD_BASE, fmsTaskBoardFamily } from "@jewelos/core";

const KEY = "jewelos.fms.boardReturn";

/**
 * Remembers the board a card was opened from, so finishing that work returns
 * to the same workflow board (with its filters and scroll position) instead of
 * the workflow list. Per tab, per piece of work; storage may be unavailable.
 */
export function rememberFmsBoardReturn(boardPath: string, workPath: string): void {
  try { window.sessionStorage.setItem(KEY, JSON.stringify({ boardPath, workPath })); } catch { /* Returning to the list is fine. */ }
}

/** Where "Back" and "done" go from the work at `currentPath` (the work page's own URL). */
export function fmsTasksReturnPath(currentPath = `${window.location.pathname}${window.location.search}`): string {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(KEY) ?? "null") as { boardPath?: unknown; workPath?: unknown } | null;
    if (saved && typeof saved.boardPath === "string" && saved.workPath === currentPath
      && fmsTaskBoardFamily(new URL(saved.boardPath, window.location.origin).search)) return saved.boardPath;
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
