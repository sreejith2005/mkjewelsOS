import { isLittleText } from "@jewelos/core";
import type { KiaraDocumentStatus, KiaraUploadStage, KiaraVisibility } from "@jewelos/data/assistant/knowledge";

export const STATUS_LABELS: Readonly<Record<KiaraDocumentStatus, string>> = {
  processing: "Processing",
  active: "Active",
  inactive: "Inactive",
  suggested: "Suggested",
  failed: "Failed",
  deleted: "Deleted",
};

export const STATUS_TONES: Readonly<Record<KiaraDocumentStatus, string>> = {
  processing: "border-task-border bg-task-muted text-task-text",
  active: "border-success/40 bg-success/10 text-success",
  inactive: "border-task-border bg-task-muted text-task-text-muted",
  suggested: "border-task-accent/40 bg-task-accent-soft text-task-text",
  failed: "border-danger/40 bg-danger/10 text-danger",
  deleted: "border-task-border bg-task-muted text-task-text-muted",
};

export const VISIBILITY_LABELS: Readonly<Record<KiaraVisibility, string>> = {
  everyone: "Everyone",
  departments: "Only these departments",
  managers_and_above: "Managers and above",
};

export const VISIBILITY_HELP: Readonly<Record<KiaraVisibility, string>> = {
  everyone: "Every employee can get answers from it. People in the tagged departments see it first.",
  departments: "Only people in the tagged departments (in every branch), plus Admins and Super Admin.",
  managers_and_above: "Managers, Admins, and Super Admin only. HR is not included.",
};

/** Department tags as a short line ("Sales, Drivers" or "All departments"). */
export function departmentsText(tags: readonly string[]): string {
  return tags.length ? tags.join(", ") : "No department";
}

export const STAGE_LABELS: Readonly<Record<KiaraUploadStage | "queued", string>> = {
  queued: "Waiting",
  checking: "Checking",
  registering: "Registering",
  uploading: "Uploading",
  extracting: "Extracting text",
  ready: "Ready",
  failed: "Failed",
};

/** Warnings shown next to a document: what Kiara cannot read. */
export function documentWarnings(input: Readonly<{ word_count: number | null; image_count: number | null; status: KiaraDocumentStatus }>): string[] {
  const warnings: string[] = [];
  if (input.status !== "processing" && input.status !== "failed" && input.word_count !== null && isLittleText(input.word_count)) warnings.push("Little text extracted");
  if ((input.image_count ?? 0) > 0) warnings.push(`${input.image_count} picture${input.image_count === 1 ? "" : "s"} ignored`);
  return warnings;
}

export function formatUpdated(value: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value));
}
