/**
 * The desktop sidebar toggles between names and an icon rail; choosing a section shrinks it
 * to icons (MK1 audit 2026-11-07, previously it hid completely). A deploy can
 * make the next page chunk stale, and `lazyPage` then reloads the browser; the
 * open/closed choice is kept for the browser session so that reload does not
 * reopen it. Storage is a convenience only, so any failure means "open".
 */
const SIDEBAR_OPEN_KEY = "jewelos.sidebarOpen";

export function readSidebarOpen(): boolean {
  try { return window.sessionStorage.getItem(SIDEBAR_OPEN_KEY) !== "false"; } catch { return true; }
}

export function rememberSidebarOpen(open: boolean): void {
  try { window.sessionStorage.setItem(SIDEBAR_OPEN_KEY, String(open)); } catch { /* storage unavailable: keep the in-memory state */ }
}
