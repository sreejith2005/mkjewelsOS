/**
 * The FMS clipboard: the system clipboard where the browser allows it, plus a
 * same-tab copy so copy and paste between two workflows still works when the
 * browser refuses clipboard access. It only ever holds a copied workflow
 * fragment (authoring definitions), never application records.
 */
const SESSION_KEY = "jewelos.fms.clipboard.v1";
let memory: string | null = null;

export type FmsClipboardTarget = "system" | "app";

export async function writeFmsClipboard(text: string): Promise<FmsClipboardTarget> {
  memory = text;
  try { window.sessionStorage.setItem(SESSION_KEY, text); } catch { /* storage unavailable: the in-memory copy still works in this tab */ }
  try {
    if (!navigator.clipboard?.writeText) return "app";
    await navigator.clipboard.writeText(text);
    return "system";
  } catch { return "app"; }
}

/** The last fragment copied in this tab, if any. */
export function readAppFmsClipboard(): string | null {
  if (memory) return memory;
  try { return window.sessionStorage.getItem(SESSION_KEY); } catch { return null; }
}

/** Reads the system clipboard when permitted, otherwise the copy kept in this tab. */
export async function readFmsClipboard(): Promise<string | null> {
  try {
    const text = navigator.clipboard?.readText ? await navigator.clipboard.readText() : "";
    if (text.trim()) return text;
  } catch { /* permission refused: fall back below */ }
  return readAppFmsClipboard();
}
