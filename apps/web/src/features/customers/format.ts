import { titleCase } from "@/lib/format";
import type { CustomerTimelineEntry } from "./api";

/** Dates on the customer master screens are shown the Indian way, day first. */
export const formatDateTime = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";
export const formatDate = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "";

/** A stored date (YYYY-MM-DD). Without a known year only day and month are shown. */
export function formatProfileDate(value: unknown, yearKnown: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  return yearKnown === false
    ? date.toLocaleDateString("en-IN", { day: "numeric", month: "long" })
    : date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export const RESULT_LABEL: Record<CustomerTimelineEntry["result"], string> = {
  positive: "Positive", negative: "Negative", not_connected: "Not connected", neutral: "Neutral",
};
export const RESULT_TONE: Record<CustomerTimelineEntry["result"], string> = {
  positive: "border-success/40 text-success", negative: "border-danger/40 text-danger",
  not_connected: "border-task-border text-soft-grey", neutral: "border-gold/30 text-champagne",
};

const CHANNEL_LABEL: Record<string, string> = {
  call: "Phone call", video_call: "Video call", whatsapp: "WhatsApp", instagram: "Instagram", instagram_ads: "Instagram ad",
  website: "Website", walk_in: "Store visit", exhibition: "Exhibition", software: "Billing", not_recorded: "Not recorded in the sheet",
};
export const channelLabel = (channel: string) => CHANNEL_LABEL[channel] ?? titleCase(channel);

const FOLLOW_UP_LABEL: Record<string, string> = {
  hot: "Hot follow-up", cold: "Cold follow-up", three_month: "3-month follow-up", call_later: "Call back", retry: "Try again",
  no_show: "Missed appointment", not_bought: "Not-bought follow-up", other: "Follow-up",
};
export const followUpLabel = (kind: string) => FOLLOW_UP_LABEL[kind] ?? titleCase(kind);
export const appointmentLabel = (type: string) => type === "video" ? "Video call appointment" : "Store appointment";
