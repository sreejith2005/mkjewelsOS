export const TASK_VIEWS = ["all", "checklist", "upload", "awaiting_evidence", "overdue", "completed", "remaining"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export type EvidenceFilters = Readonly<{
  from: string;
  to: string;
  branch_id?: string;
  department_id?: string;
  user_profile_id?: string;
  search?: string;
  view: TaskView;
  /** Echoed back once migration 0285 is applied. */
  kind?: string;
  page: number;
  page_size: number;
}>;

export type EvidenceStats = Readonly<{
  tasks_total: number;
  upload_tasks: number;
  upload_tasks_with_evidence: number;
  upload_tasks_awaiting_evidence: number;
  completed: number;
  remaining: number;
  overdue: number;
  evidence_files: number;
  evidence_bytes: number;
}>;

export type TaskAttachmentSummary = Readonly<{
  attachment_id: string;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_at: string;
  uploaded_by_name: string | null;
}>;

/**
 * One assigned task, whatever kind it is. A checklist task and an upload task
 * are the same row here; `is_upload_work` says which the doer sees, and
 * `attachments` carries whatever came back against it. Since migration 0285
 * the list also holds FMS steps and start forms (`task_type` 'fms', no
 * evidence); `work_kind` names the kind and `work_context` says where it came
 * from. Both are absent from an older server.
 */
export type TaskRow = Readonly<{
  task_id: string;
  task_title: string;
  task_type: string;
  task_status: string;
  requires_upload: boolean;
  is_upload_work: boolean;
  overdue: boolean;
  branch_name: string | null;
  department_name: string | null;
  assignee_names: string | null;
  planned_datetime: string;
  due_datetime: string | null;
  actual_datetime: string | null;
  work_kind?: string | null;
  work_context?: string | null;
  attachments: readonly TaskAttachmentSummary[];
}>;

export type OutstandingRow = Readonly<{
  task_id: string;
  task_title: string;
  task_status: string;
  assignee_names: string | null;
  branch_name: string | null;
  department_name: string | null;
  planned_datetime: string;
  due_datetime: string | null;
  overdue: boolean;
}>;

export type EvidenceWorkspace = Readonly<{
  filters: EvidenceFilters;
  stats: EvidenceStats;
  tasks: readonly TaskRow[];
  tasks_total: number;
  /** Per-kind totals of the whole scope (0285); `stats` stays Tasks-section only. */
  kind_counts?: Readonly<Record<"all" | "one_time" | "recurring" | "crm" | "fms", number>>;
  missing: readonly OutstandingRow[];
  missing_total: number;
}>;
