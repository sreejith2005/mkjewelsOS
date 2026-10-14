import { formatQuotaReset, isQuotaExhausted, type KiaraQuota } from "./quota.ts";

/**
 * Ask Kiara screen rules shared by the web page and the Android screen: which
 * tab and item a link opens, the composer's lock message, the suggestions, and
 * the date wording. Only presentation; the database decides access and limits.
 */

export const KIARA_TABS = ["chat", "questions", "knowledge", "insights", "limits"] as const;
export type KiaraTab = (typeof KIARA_TABS)[number];

export type KiaraLocation = Readonly<{ tab: KiaraTab; escalationId: string | null; conversationId: string | null }>;

/** The tab and item a URL query opens (notification links use `?conversation=` and `?tab=questions&escalation=`). */
export function kiaraLocation(search: string): KiaraLocation {
  const params = new URLSearchParams(search);
  const tab = params.get("tab");
  return {
    tab: (KIARA_TABS as readonly (string | null)[]).includes(tab) ? tab as KiaraTab : "chat",
    escalationId: params.get("escalation"),
    conversationId: params.get("conversation"),
  };
}

export const KIARA_SUGGESTIONS = [
  "What is pending for me today?",
  "Aaj mera kya pending hai?",
  "How do I apply for leave?",
  "Mere overdue tasks kaun se hain?",
] as const;

/** The character counter appears from this length on. */
export const KIARA_DRAFT_COUNTER_FROM = 1800;

/** Adds spoken words to whatever is already typed, within the input limit. Never sends. */
export function appendKiaraTranscript(draft: string, text: string, maxLength: number): string {
  const words = text.trim();
  if (!words) return draft;
  const joined = draft.trim() ? `${draft.replace(/\s+$/, "")} ${words}` : words;
  return joined.slice(0, maxLength);
}

/** Why the composer is locked (daily limit, full chat), or null when it is open. */
export function kiaraComposerDisabledReason(input: Readonly<{
  quota: KiaraQuota | null;
  activeConversationId: string | null;
  questionCount: number;
  conversationLimit: number;
}>): string | null {
  const { quota } = input;
  if (quota && isQuotaExhausted(quota)) return `You have used all ${quota.limit} questions for today. They reset at ${formatQuotaReset(quota)}.`;
  if (input.activeConversationId !== null && input.questionCount >= input.conversationLimit) return "This chat is full. Press \"New chat\" to keep asking.";
  return null;
}

/** "5 min ago", "3 h ago", "2 days ago". */
export function kiaraRelativeAge(value: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** "12 Oct, 4:05 pm", or null for a missing or invalid time. */
export function kiaraDateTime(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true }).format(date);
}

/** "12 Oct" for a date (or timestamp) string, or null. */
export function kiaraShortDay(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date);
}

export const kiaraPlural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`;
