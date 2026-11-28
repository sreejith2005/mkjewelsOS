/**
 * Plain-language meaning of the short codes customer-sheets-sync stores in
 * customer.ingest_state.last_error (never sheet content). A code may carry a
 * detail after ":" — a tab or column name, or a count.
 */
export interface SheetSyncProblem {
  /** What went wrong, in one sentence. */
  readonly problem: string;
  /** What to do about it. */
  readonly fix: string;
}

const SHARE = "Share the Google Sheet (Viewer is enough) with the same service-account email the working sheets are shared with (open a sheet that reads fine → Share to see it), then wait for the next read (about 5 minutes).";

/** How long a scheduled sheet may go unread before the Customers page warns. */
export const SHEET_STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export function describeSheetSyncError(code: string | null | undefined): SheetSyncProblem {
  const raw = (code ?? "").trim();
  const split = raw.indexOf(":");
  const name = split < 0 ? raw : raw.slice(0, split);
  const detail = split < 0 ? "" : raw.slice(split + 1).trim();
  if (name === "too_many_rows_missing") return {
    problem: `${detail ? `${Number(detail).toLocaleString("en-IN")} rows` : "Many rows"} that were read before are no longer in the sheet, so removing them was stopped to protect the data.`,
    fix: "If the tab fills itself from a formula (IMPORTRANGE, QUERY and so on), the formula may be failing for a while under load; this clears itself on the next read once the rows are back, and nothing is deleted meanwhile. Otherwise check whether rows were deleted, cut or moved to another tab by mistake, or a filter hides them. Put them back if it was a mistake; if they were meant to go, ask for this sheet to be re-read.",
  };
  if (name === "sheet_not_shared") return { problem: "JewelOS is not allowed to open this Google Sheet.", fix: SHARE };
  if (name === "sheet_not_found") return { problem: "The Google Sheet could not be found. It may have been deleted, or replaced by a copy with a new link.", fix: "Restore the sheet from Google Drive's Trash, or send the new sheet link so it can be connected again." };
  if (name === "sheet_tab_not_found") return { problem: `The tab ${detail ? `"${detail}"` : "this sheet is read from"} is not in the Google Sheet. It was probably renamed or deleted.`, fix: `Rename the tab back${detail ? ` to "${detail}"` : ""}, or send the new tab name so it can be updated.` };
  if (name === "key_column_missing") return { problem: `The header row is missing ${detail ? `the column(s) ${detail}` : "a column used to tell rows apart"}.`, fix: "Rename the column back to its exact old name (spelling and spaces matter), or check that the header row was not moved or deleted." };
  if (name === "sheet_range_refused") return { problem: "Google refused the read range. The tab's layout may have changed (rows or columns removed at the top).", fix: "Check that the header row is still on the same row as before. If the layout changed on purpose, ask for the sheet to be reconnected." };
  if (name.startsWith("sheet_read_timeout")) return { problem: `Google took too long to send the rows${/row_(\d+)/.exec(name) ? ` starting at row ${/row_(\d+)/.exec(name)![1]}` : ""}.`, fix: "Usually temporary; the next reads retry with fewer rows. If it lasts more than an hour, the sheet may be very slow (many formulas or images) — tell the developer." };
  if (name === "sheet_read_failed_429") return { problem: "Google limited how often the sheets can be read.", fix: "Temporary; it continues by itself in the next runs. Nothing to do unless it lasts more than an hour." };
  if (/^sheet_read_failed_5\d\d$/.test(name)) return { problem: `Google could not serve the sheet (error ${name.slice(-3)}).`, fix: "Temporary on Google's side; the next read retries. Nothing to do unless it lasts more than an hour." };
  if (name.startsWith("sheet_read_failed")) return { problem: `Google refused the read${name.length > 18 ? ` (error ${name.slice(18)})` : ""}.`, fix: "Check the sheet is still shared and opens normally. If it does, tell the developer with this message." };
  if (name === "google_key_invalid" || name === "google_auth_failed") return { problem: "JewelOS could not sign in to Google with its service account.", fix: "The Google service-account key secret is wrong or was revoked. Tell the developer; this affects every sheet." };
  if (/^(store|apply|finish|state)_failed/.test(name)) return {
    problem: `The rows were read but saving them in the database failed (${name}${name.endsWith("57014") ? ": it took too long" : ""}).`,
    fix: name.endsWith("57014") ? "Usually clears by itself as later runs save smaller batches. If it lasts more than an hour, tell the developer with this message." : "Tell the developer with this message; nothing in the sheet needs changing.",
  };
  return { problem: raw ? `The read stopped with "${raw}".` : "The read stopped with an unknown problem.", fix: "Tell the developer with this message." };
}
