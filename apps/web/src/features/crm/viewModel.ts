import { classifyFollowupDue, timelineEventDisplay, type FollowupStatus, type TimelineEventType } from "@jewelos/core";
import type { CrmFollowup, CrmTimeline } from "./types";

export function groupFollowups(items: readonly CrmFollowup[], now = new Date(), timeZone = "Asia/Kolkata") {
  return items.reduce<Record<string, CrmFollowup[]>>((groups, item) => {
    const bucket = item.bucket ?? classifyFollowupDue(item.due_date, item.status as FollowupStatus, now, timeZone);
    (groups[bucket] ??= []).push(item); return groups;
  }, { today: [], overdue: [], upcoming: [], completed: [], cancelled: [] });
}

export function mapTimeline(items: readonly CrmTimeline[]) {
  return [...items].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at) || b.id.localeCompare(a.id)).map((item) => ({ ...item, ...timelineEventDisplay(item.event_type as TimelineEventType) }));
}

export function mergeConfirmation(survivorId: string, duplicateId: string, typed: string): boolean {
  return survivorId !== duplicateId && typed.trim().toUpperCase() === "MERGE";
}

export function createSubmissionGuard() {
  let pending = false;
  return async <T>(operation: () => Promise<T>): Promise<T | undefined> => {
    if (pending) return undefined; pending = true;
    try { return await operation(); } finally { pending = false; }
  };
}

export function staleEditMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("changed since") || message.includes("stale") || message.includes("40001")
    ? "This client changed after you opened it. Refresh the profile before applying your edits."
    : message;
}

export function validateCrmDocumentFile(file: Pick<File, "name" | "size" | "type">): string | null {
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  return allowed.has(file.type) && /\.(jpg|jpeg|png|webp|pdf)$/i.test(file.name) && file.size >= 1 && file.size <= 10 * 1024 * 1024
    ? null
    : "Use a JPG, PNG, WebP, or PDF up to 10 MB.";
}

export async function finalizePrivateUpload<T>(register: () => Promise<T>, cleanup: () => Promise<unknown>): Promise<T> {
  try { return await register(); }
  catch (error) { try { await cleanup(); } catch { /* registration error remains authoritative */ } throw error; }
}
