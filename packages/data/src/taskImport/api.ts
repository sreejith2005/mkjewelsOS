import { getSupabase as db } from "@jewelos/api-client/client";
import type { Json, TaskBulkImportPayload, TaskImportCanonicalRow } from "@jewelos/core";

/**
 * The follow-up half of a bulk task import: rows whose employee name was blank
 * or unrecognised, waiting for an administrator to choose someone. Parsing a
 * spreadsheet stays a desktop job; assigning what it left behind does not.
 */
export type AssigningLeftRecord = Readonly<{
  record_kind: "task" | "template";
  id: string;
  title: string;
  destination: string;
  branch_id: string | null;
  department_id: string | null;
  starts_at: string | null;
  verification_pending: boolean;
  created_at: string;
}>;

export type TaskImportIdentityCandidate = Readonly<{
  id: string;
  employee_name: string;
  email: string;
  branch_id: string;
  department_id: string;
  manager_id: string | null;
  import_aliases: string[];
}>;

export type TaskImportValidation = Readonly<{
  valid: boolean;
  canonical_hash: string;
  summary: Readonly<{
    requested_count: number;
    valid_count: number;
    error_count: number;
    one_time_count: number;
    recurring_count: number;
    initial_instance_count: number;
  }>;
  issues: readonly Readonly<{
    sheet: string;
    row: number;
    field: string;
    reason: string;
    guidance: string;
    severity: "error" | "warning";
  }>[];
}>;

export type TaskImportBatch = Readonly<{
  id: string;
  created_at: string;
  safe_file_label: string | null;
  requested_count: number;
  valid_count: number;
  error_count: number;
  one_time_count: number;
  recurring_count: number;
  initial_instance_count: number;
  outcome: string;
  created_by: string;
}>;

export type TaskImportChunkOutcome = Readonly<{
  created: number;
  rejected: number;
  replayed: number;
  assigning_left_count: number;
  outcome: string;
  issues: readonly Readonly<{ row: number; field: string; reason: string; guidance: string; code: string }>[];
}>;

type TaskImportRpcClient = {
  rpc(name: "validate_task_bulk_import", args: { p_payload: Json; p_import_hash: string }): Promise<{ data: unknown; error: { message: string } | null }>;
  rpc(name: "import_task_bulk_with_audit", args: { p_payload: Json; p_import_hash: string; p_file_label: string }): Promise<{ data: unknown; error: { message: string } | null }>;
  rpc(name: "begin_task_bulk_import", args: { p_import_hash: string; p_file_label: string; p_requested_count: number }): Promise<{ data: unknown; error: { message: string } | null }>;
  rpc(name: "commit_task_bulk_import_chunk", args: { p_batch_id: string; p_rows: Json }): Promise<{ data: unknown; error: { message: string } | null }>;
  rpc(name: "save_task_import_identity_alias_with_audit", args: { p_source_label: string; p_user_profile_id: string }): Promise<{ data: unknown; error: { message: string } | null }>;
  rpc(name: "reconcile_task_import_assignments", args: { p_rows: Json }): Promise<{ data: unknown; error: { message: string } | null }>;
};

type AssigningLeftRpcClient = {
  rpc(name: "list_assigning_left_tasks", args?: undefined): Promise<{ data: unknown; error: { message: string } | null }>;
  rpc(name: "list_task_import_identity_candidates", args?: undefined): Promise<{ data: unknown; error: { message: string } | null }>;
  rpc(
    name: "assign_imported_task_with_audit",
    args: { p_record_kind: string; p_record_id: string; p_user_profile_id: string },
  ): Promise<{ data: unknown; error: { message: string } | null }>;
};

function unwrap<T>(result: { data: unknown; error: { message: string } | null }, label: string): T {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data as T;
}

const client = () => db() as unknown as AssigningLeftRpcClient;
const importClient = () => db() as unknown as TaskImportRpcClient;

export async function validateTaskBulkImport(payload: TaskBulkImportPayload, hash: string): Promise<TaskImportValidation> {
  return unwrap<TaskImportValidation>(await importClient().rpc("validate_task_bulk_import", {
    p_payload: payload as unknown as Json,
    p_import_hash: hash,
  }), "Validate task import");
}

export async function submitTaskBulkImport(payload: TaskBulkImportPayload, hash: string, fileLabel: string): Promise<{ batch_id: string; created_count: number; replayed: boolean; outcome: string }> {
  return unwrap(await importClient().rpc("import_task_bulk_with_audit", {
    p_payload: payload as unknown as Json,
    p_import_hash: hash,
    p_file_label: fileLabel,
  }), "Import tasks");
}

export async function loadTaskImportBatches(): Promise<TaskImportBatch[]> {
  const result = await db().from("task_import_batches")
    .select("id,created_at,safe_file_label,requested_count,valid_count,error_count,one_time_count,recurring_count,initial_instance_count,outcome,created_by")
    .order("created_at", { ascending: false })
    .limit(20);
  if (result.error) throw new Error(`Load import history: ${result.error.message}`);
  return result.data as TaskImportBatch[];
}

export async function beginCurrentSheetTaskImport(hash: string, fileLabel: string, requestedCount: number): Promise<{ batch_id: string; outcome: string; replayed: boolean }> {
  return unwrap(await importClient().rpc("begin_task_bulk_import", {
    p_import_hash: hash,
    p_file_label: fileLabel,
    p_requested_count: requestedCount,
  }), "Begin task import");
}

export async function commitCurrentSheetTaskImportChunk(batchId: string, rows: readonly TaskImportCanonicalRow[]): Promise<TaskImportChunkOutcome> {
  return unwrap(await importClient().rpc("commit_task_bulk_import_chunk", {
    p_batch_id: batchId,
    p_rows: rows as unknown as Json,
  }), "Commit task import chunk");
}

export async function saveTaskImportIdentityAlias(sourceLabel: string, userProfileId: string): Promise<{ saved: boolean }> {
  return unwrap(await importClient().rpc("save_task_import_identity_alias_with_audit", {
    p_source_label: sourceLabel,
    p_user_profile_id: userProfileId,
  }), "Remember employee name");
}

export async function reconcileTaskImportAssignments(rows: readonly TaskImportCanonicalRow[]): Promise<{ updated_count: number }> {
  return unwrap(await importClient().rpc("reconcile_task_import_assignments", {
    p_rows: rows as unknown as Json,
  }), "Reconcile imported assignments");
}

export async function loadAssigningLeftTasks(): Promise<AssigningLeftRecord[]> {
  return unwrap<AssigningLeftRecord[]>(await client().rpc("list_assigning_left_tasks"), "Load Assigning Left");
}

export async function loadTaskImportIdentityCandidates(): Promise<TaskImportIdentityCandidate[]> {
  return unwrap<TaskImportIdentityCandidate[]>(
    await client().rpc("list_task_import_identity_candidates"),
    "Load identity candidates",
  );
}

export type AssignImportedTaskResult = Readonly<{ assignment_status: "assigned" | "assigning_left" }>;

export async function assignImportedTask(
  recordKind: "task" | "template",
  recordId: string,
  userProfileId: string,
): Promise<AssignImportedTaskResult> {
  return unwrap<AssignImportedTaskResult>(
    await client().rpc("assign_imported_task_with_audit", {
      p_record_kind: recordKind,
      p_record_id: recordId,
      p_user_profile_id: userProfileId,
    }),
    "Assign imported task",
  );
}
