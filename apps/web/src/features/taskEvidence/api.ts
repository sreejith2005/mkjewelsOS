import { supabase } from "@jewelos/api-client";
import type { EvidenceWorkspace } from "./types";

type EvidenceRpc = (name: "get_task_evidence_workspace", args: { p_filter: Record<string, string | number | undefined> }) => Promise<{ data: unknown; error: { message: string } | null }>;
type PathRpc = (name: "get_task_attachment_path", args: { p_attachment_id: string }) => Promise<{ data: unknown; error: { message: string } | null }>;

export async function fetchTaskEvidenceWorkspace(filter: Record<string, string | number | undefined>): Promise<EvidenceWorkspace> {
  const { data, error } = await (supabase.rpc as unknown as EvidenceRpc)("get_task_evidence_workspace", { p_filter: filter });
  if (error) throw new Error(error.message);
  return data as EvidenceWorkspace;
}

/**
 * The browser never names a Storage object. It asks the database which path an
 * attachment it may read resolves to, then signs that path for 60 seconds.
 */
export async function signedTaskEvidenceUrl(attachmentId: string): Promise<string> {
  const { data, error } = await (supabase.rpc as unknown as PathRpc)("get_task_attachment_path", { p_attachment_id: attachmentId });
  if (error) throw new Error(error.message);
  const signed = await supabase.storage.from("task-attachments").createSignedUrl(data as string, 60);
  if (signed.error) throw new Error(signed.error.message);
  if (!signed.data) throw new Error("Signed URL was not created");
  return signed.data.signedUrl;
}

export async function fetchTaskAttachments(taskId: string) {
  const { data, error } = await supabase
    .from("task_attachments")
    .select("id,file_url,created_at,uploaded_by,original_filename,mime_type,size_bytes")
    .eq("task_instance_id", taskId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}
