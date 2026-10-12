import { getAppHelp } from "../../../../packages/core/src/assistant/appHelp.ts";
import type { PageId } from "../../../../packages/core/src/roleMenu.ts";
import { ACCESS_DENIED, type ToolOutcome } from "./shared.ts";

/**
 * `get_app_help`: repo-maintained help, only for sections the caller can open
 * right now (permission and section availability, as the app shell decides).
 */
export function getAppHelpOutcome(section: PageId, accessibleSections: readonly PageId[]): ToolOutcome {
  if (!accessibleSections.includes(section)) return ACCESS_DENIED;
  const help = getAppHelp(section);
  if (!help) return { result: { found: false, message: "No help is written for this section yet." }, isError: false };
  return { result: { found: true, ...help }, isError: false };
}
