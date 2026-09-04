export type EvidenceFilters = Readonly<{
  from: string;
  to: string;
  branch_id?: string;
  department_id?: string;
  user_profile_id?: string;
  search?: string;
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

export type EvidenceRow = Readonly<{
  attachment_id: string;
  task_id: string;
  task_title: string;
  task_type: string;
  task_status: string;
  requires_upload: boolean;
  branch_name: string | null;
  department_name: string | null;
  assignee_names: string | null;
  uploaded_at: string;
  uploaded_by_name: string | null;
  original_filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  planned_datetime: string;
  actual_datetime: string | null;
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
  evidence: readonly EvidenceRow[];
  evidence_total: number;
  missing: readonly OutstandingRow[];
  missing_total: number;
}>;
