import { getSupabase as db } from "@jewelos/api-client/client";
import { countLeaveDays, validateLeaveDates, type LeaveHalf, type ReturnHalf, type Tables } from "@jewelos/core";
import { newRequestKey, uploadBody, type UploadSource } from "../runtime";

export type LeaveRequest = Tables<"leave_requests">;
export type LeaveDraft = Readonly<{
  leaveType: string;
  duration: LeaveHalf;
  reason: string;
  leaveStart: string;
  leaveEnd: string;
  workStartDate: string;
  workStartIn: ReturnHalf;
}>;

const extensionFor: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

function fail(error: { message: string } | null, action: string): void {
  if (error) throw new Error(`${action}: ${error.message}`);
}

export async function leaveTypes(): Promise<Array<{ value: string; label: string }>> {
  const { data, error } = await db().from("dropdown_masters").select("value,label")
    .eq("master_type", "leave_type").eq("is_active", true).order("sort_order");
  fail(error, "Load leave types");
  return data ?? [];
}

export async function canSubmitLeave(): Promise<boolean> {
  const { data, error } = await db().rpc("leave_applicant_eligible");
  fail(error, "Check leave access");
  return data === true;
}

export async function listLeaveRequests(applicantId?: string, status?: "pending"): Promise<LeaveRequest[]> {
  const rows: LeaveRequest[] = [];
  for (let offset = 0; ; offset += 200) {
    let query = db().from("leave_requests").select("*").order("submitted_at", { ascending: false }).range(offset, offset + 199);
    if (applicantId) query = query.eq("applicant_id", applicantId);
    if (status) query = query.eq("status", status);
    const { data, error } = await query;
    fail(error, "Load leave requests");
    rows.push(...(data ?? []));
    if (!data || data.length < 200) return rows;
  }
}

export async function uploadLeaveImage(tenantId: string, applicantId: string, kind: "tl" | "handover", file: UploadSource): Promise<string> {
  const extension = extensionFor[file.type];
  if (!extension || file.size < 1 || file.size > 5 * 1024 * 1024 || !/\.(jpe?g|png|webp)$/i.test(file.name)) {
    throw new Error("Choose a JPG, PNG, or WebP image up to 5 MB");
  }
  const path = `${tenantId}/${applicantId}/${kind}/${newRequestKey()}.${extension}`;
  const { error } = await db().storage.from("leave-approvals").upload(path, uploadBody(file), { contentType: file.type, upsert: false });
  fail(error, "Upload approval image");
  return path;
}

async function cleanUnlinked(path: string): Promise<void> {
  await db().storage.from("leave-approvals").remove([path]);
}

export async function submitLeave(draft: LeaveDraft, tenantId: string, applicantId: string, image: UploadSource): Promise<string> {
  validateLeaveDates(draft.leaveStart, draft.leaveEnd, draft.workStartDate);
  countLeaveDays(draft.duration, draft.leaveStart, draft.leaveEnd, draft.workStartDate, draft.workStartIn);
  if (!draft.leaveType || !draft.reason.trim()) throw new Error("Leave type and reason are required");
  const path = await uploadLeaveImage(tenantId, applicantId, "tl", image);
  try {
    const { data, error } = await db().rpc("submit_leave_request", {
      p_leave_type: draft.leaveType, p_duration: draft.duration, p_reason: draft.reason.trim(),
      p_leave_start: draft.leaveStart, p_leave_end: draft.leaveEnd,
      p_work_start_date: draft.workStartDate, p_work_start_in: draft.workStartIn, p_tl_approval_path: path,
    });
    fail(error, "Submit leave");
    if (!data) throw new Error("Leave request was not created");
    return data;
  } catch (error) {
    try { await cleanUnlinked(path); } catch { /* Preserve the authoritative request error. */ }
    throw error;
  }
}

export async function editPendingLeave(id: string, dates: Pick<LeaveDraft, "leaveStart" | "leaveEnd" | "workStartDate" | "workStartIn">): Promise<void> {
  validateLeaveDates(dates.leaveStart, dates.leaveEnd, dates.workStartDate);
  const { error } = await db().rpc("edit_pending_leave", {
    p_id: id, p_leave_start: dates.leaveStart, p_leave_end: dates.leaveEnd,
    p_work_start_date: dates.workStartDate, p_work_start_in: dates.workStartIn,
  });
  fail(error, "Edit leave");
}

export async function submitHandover(id: string, tenantId: string, applicantId: string, recipientId: string, image: UploadSource): Promise<void> {
  const path = await uploadLeaveImage(tenantId, applicantId, "handover", image);
  try {
    const { error } = await db().rpc("submit_leave_handover", { p_id: id, p_handover_to: recipientId, p_approval_path: path });
    fail(error, "Submit handover");
  } catch (error) {
    try { await cleanUnlinked(path); } catch { /* Preserve the authoritative handover error. */ }
    throw error;
  }
}

export async function reviewLeave(id: string, approve: boolean, remark: string): Promise<void> {
  const { error } = await db().rpc("review_leave_request", { p_id: id, p_approve: approve, p_remark: remark });
  fail(error, "Review leave");
}

export async function signedLeaveImage(path: string): Promise<string> {
  const { data, error } = await db().storage.from("leave-approvals").createSignedUrl(path, 60);
  fail(error, "Open approval image");
  if (!data) throw new Error("Approval image could not be opened");
  return data.signedUrl;
}
