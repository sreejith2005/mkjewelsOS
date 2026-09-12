import { getSupabase as db } from "@jewelos/api-client/client";

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
