/**
 * The desktop sidebar is a hamburger: choosing a section closes it. A deploy can
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
