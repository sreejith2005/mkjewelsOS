import {
  calculateTaskChecklistProgress,
  type TaskChecklistProgress,
  type TaskChecklistProgressItem,
} from "./taskChecklist";
import { effectiveTaskDeadline, isTaskFeedItemOverdue, type TaskFeedLike } from "./taskFeed";
import type { TaskMutationCapability } from "./taskCapabilities";

/**
 * The task a card is drawn for, reduced to the fields that decide its
 * behaviour. Each client passes its own row type; only these fields matter.
 */
export type TaskCardInput = TaskFeedLike &
  Readonly<{
    task_type: string | null;
    status: string | null;
    requires_form: boolean | null;
    requires_upload: boolean | null;
  }>;

export type TaskCardState = Readonly<{
  /** The deadline, in the revised then due then planned order the feed uses. */
  deadline: string | null;
  overdue: boolean;
  completed: boolean;
  blocked: boolean;
  /**
   * The viewer may look but not act. An FMS stage is read-only in the unified
   * feed whatever the viewer's capability, because its actions belong to the
   * workflow runner rather than to the task list.
   */
  readOnly: boolean;
  /** The card collapses to a single "fill the form" action, because the form is the work. */
  formOnlyAction: boolean;
  /** Whether completion may be attempted at all. */
  canComplete: boolean;
  /** Offer the plain completion action. */
  showDirectComplete: boolean;
  /** Offer upload-and-complete instead, because evidence is still owed. */
  showDirectUpload: boolean;
  /**
   * Evidence is owed before completion. A checklist never owes evidence, even
   * when an older import copied the sheet's upload flag onto it.
   */
  requiresEvidence: boolean;
  /** Elevated viewers may re-date a delegation task. */
  showReviseForm: boolean;
  checklistProgress: TaskChecklistProgress;
}>;

/**
 * Decides what a task card offers, for every client.
 *
 * This lives in core rather than inside a component because the web app and the
 * React Native app must not be able to disagree about it. An earlier mobile
 * rewrite reconstructed these rules by hand from the web component and got them
 * wrong; extracting them is what stops that recurring.
 *
 * Two rules here are deliberate and have been mistaken for bugs before:
 *
 *  - **An outstanding checklist never withholds the completion action.**
 *    Imported occurrences each carry one required item repeating the task
 *    headline, and gating completion behind it left every such task
 *    uncompletable. Completing closes the remaining items server-side
 *    (migration 0142), so the checklist records the work rather than gating it.
 *  - **An FMS task is read-only in the feed**, regardless of capability.
 *
 * The server re-checks all of it. What this returns decides what is *shown*,
 * never what is *allowed*.
 */
export function deriveTaskCardState(input: {
  task: TaskCardInput;
  hasAttachment: boolean;
  hasFormSubmission: boolean;
  checklists: readonly TaskChecklistProgressItem[];
  capability: TaskMutationCapability;
  now?: Date | string;
}): TaskCardState {
  const { task, hasAttachment, hasFormSubmission, checklists, capability } = input;

  const completed = task.status === "completed";
  const blocked = task.status === "blocked";
  const readOnly = !capability.canMutate || task.task_type === "fms";
  const formOnlyAction = Boolean(task.requires_form) && !completed;
  // Checklists are a click-to-complete task type. Older imports copied the
  // sheet's evidence flag onto checklist records (repaired by migration 0148),
  // so the rule is normalised here rather than trusted from the row.
  const requiresEvidence = Boolean(task.requires_upload);

  const canComplete =
    (!requiresEvidence || hasAttachment) && (!task.requires_form || hasFormSubmission);

  const showDirectComplete = !formOnlyAction && !readOnly && !completed && !blocked;

  return {
    deadline: effectiveTaskDeadline(task),
    overdue: isTaskFeedItemOverdue(task, input.now ?? new Date()),
    completed,
    blocked,
    readOnly,
    formOnlyAction,
    canComplete,
    showDirectComplete,
    showDirectUpload: showDirectComplete && requiresEvidence && !hasAttachment,
    requiresEvidence,
    showReviseForm:
      !formOnlyAction &&
      capability.canUseElevatedActions &&
      task.task_type === "delegation" &&
      !completed &&
      !blocked,
    checklistProgress: calculateTaskChecklistProgress(checklists),
  };
}

/**
 * The `linked_module` a task's form submission must be filed under.
 *
 * `submit_form_with_audit` accepts only `checklist_task` or `delegation_task`
 * and re-checks the value against the task's own `task_type` (migration 0009),
 * so a submission filed under anything else is refused outright. Both clients
 * derive it here rather than repeating the ternary.
 */
export function taskFormLinkedModule(taskType: string | null | undefined): "checklist_task" | "delegation_task" {
  return taskType === "delegation" ? "delegation_task" : "checklist_task";
}

/**
 * The file types a task accepts as evidence: photos, PDFs and short videos
 * (MP4 from Android, QuickTime from iPhone, WebM/3GPP from older phones).
 * Migration 0259 enforces the same list and limits on the bucket and RPCs.
 */
export const TASK_EVIDENCE_VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/3gpp"] as const;
export const TASK_EVIDENCE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf", ...TASK_EVIDENCE_VIDEO_MIME_TYPES] as const;
export const TASK_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const TASK_EVIDENCE_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

const TASK_EVIDENCE_EXTENSION_TYPES: Readonly<Record<string, (typeof TASK_EVIDENCE_MIME_TYPES)[number]>> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime", webm: "video/webm", "3gp": "video/3gpp",
};

/** The `accept` value for an evidence file input. Extensions help pickers that report no MIME type. */
export const TASK_EVIDENCE_ACCEPT = [...TASK_EVIDENCE_MIME_TYPES, ...Object.keys(TASK_EVIDENCE_EXTENSION_TYPES).map((extension) => `.${extension}`)].join(",");

/**
 * The content type to upload a picked file with, or `null` when it is not
 * accepted. Some Android pickers report a video with no type (or a generic
 * binary type), so the file extension is used as a fallback.
 */
export function taskEvidenceContentType(file: Readonly<{ name?: string; type: string }>): string | null {
  if ((TASK_EVIDENCE_MIME_TYPES as readonly string[]).includes(file.type)) return file.type;
  if (file.type && file.type !== "application/octet-stream") return null;
  const extension = file.name?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (extension && TASK_EVIDENCE_EXTENSION_TYPES[extension]) || null;
}

/**
 * Why a picked file cannot be used as task evidence, or `null` when it can.
 * Both clients check before uploading so a person sees the rule instead of a
 * storage error; the bucket policy remains the authority.
 */
export function taskEvidenceFileError(file: Readonly<{ name?: string; size: number; type: string }>): string | null {
  const contentType = taskEvidenceContentType(file);
  if (contentType?.startsWith("video/") && file.size > TASK_EVIDENCE_VIDEO_MAX_BYTES) return "Videos can be up to 50 MB. Record a shorter clip and try again.";
  if (file.size < 1 || !contentType || (!contentType.startsWith("video/") && file.size > TASK_EVIDENCE_MAX_BYTES)) return "Upload a photo or PDF up to 10 MB, or a video up to 50 MB.";
  return null;
}
