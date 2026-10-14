import { hasPermission, isKiaraCrmPath, type AccessContext, type KiaraTab } from "@jewelos/core";
import type { AskKiaraOutcome } from "@jewelos/data/assistant/api";
import { pageDecision, type ShellAccess } from "@/navigation/shellModel";

/**
 * Native Ask Kiara decisions (Phase 8). Screen aids only: every RPC and the
 * ask-kiara function re-check the permission and the section.
 */

/** Production web origin; the release build carries the same value in EXPO_PUBLIC_JEWELOS_WEB_ORIGIN. */
export const KIARA_PRODUCTION_WEB_ORIGIN = "https://mkjewels-os.vercel.app";

/** Knowledge base and Limits stay on the web (owner decision 2026-10-12). */
export const KIARA_WEB_ONLY_TABS: readonly KiaraTab[] = ["knowledge", "limits"];

export type KiaraNativeTab = Readonly<{ id: KiaraTab; label: string; webOnly: boolean }>;

/** The tabs a user sees, in the web order, with the permission each needs. */
export function kiaraTabs(access: AccessContext): readonly KiaraNativeTab[] {
  const tabs: ReadonlyArray<readonly [KiaraTab, string, boolean]> = [
    ["chat", "Chat", true],
    ["questions", "Questions for you", hasPermission(access, "assistant.answer_escalations")],
    ["knowledge", "Knowledge base", hasPermission(access, "assistant.manage_knowledge")],
    ["insights", "Insights", hasPermission(access, "assistant.view_insights")],
    ["limits", "Limits", hasPermission(access, "assistant.manage_limits")],
  ];
  return tabs.filter(([, , shown]) => shown).map(([id, label]) => ({ id, label, webOnly: KIARA_WEB_ONLY_TABS.includes(id) }));
}

/** The tab to show: the requested one when this user has it, otherwise the chat. */
export function visibleKiaraTab(access: AccessContext, requested: KiaraTab): KiaraTab {
  return kiaraTabs(access).some((tab) => tab.id === requested) ? requested : "chat";
}

/** The web page an "Open on web" button opens (the build's web origin, else production). */
export function kiaraWebUrl(origin: string | null | undefined, tab: KiaraTab = "chat"): string {
  const base = `${(origin || KIARA_PRODUCTION_WEB_ORIGIN).replace(/\/+$/, "")}/ask-kiara`;
  return tab === "chat" ? base : `${base}?tab=${tab}`;
}

/** The mic beside Send (`assistant.voice`; the transcribe function checks it again). */
export function canUseKiaraVoice(access: AccessContext): boolean {
  return hasPermission(access, "assistant.voice");
}

/** The navigation badge counts only for answerers who can open the section, as on web. */
export function kiaraBadgeEnabled(shell: ShellAccess): boolean {
  return hasPermission(shell.access, "assistant.answer_escalations") && pageDecision(shell, "ask_kiara") === "allowed";
}

/** "99+" above 99, nothing at 0. */
export function kiaraBadgeLabel(count: number): string | null {
  if (!count || count < 0) return null;
  return count > 99 ? "99+" : String(count);
}

/**
 * Where an in-answer link goes in the app. The CRM tab shows the web CRM from
 * its start page, so a CRM record or list link opens the CRM tab.
 */
export function kiaraNativeLinkTarget(path: string): string {
  const bare = path.split(/[?#]/)[0] ?? path;
  return isKiaraCrmPath(bare) ? "/crm" : path;
}

/**
 * How far the keyboard covers the chat. With edge-to-edge Android may not
 * shrink the window, so the composer is lifted by the overlap between the
 * chat's frame and the keyboard's top edge (0 when Android already resized).
 */
export function keyboardOverlap(frameBottom: number, keyboardTop: number | null): number {
  if (keyboardTop === null || !Number.isFinite(frameBottom) || !Number.isFinite(keyboardTop)) return 0;
  return Math.max(0, Math.round(frameBottom - keyboardTop));
}

/**
 * A streamed question that never reached the function (the connection itself
 * failed) is retried once with the JSON contract and the same request id; the
 * server never counts one request id twice.
 */
export function shouldRetryAsJson(outcome: AskKiaraOutcome, started: boolean): boolean {
  return !outcome.ok && !started && outcome.transport === true;
}
