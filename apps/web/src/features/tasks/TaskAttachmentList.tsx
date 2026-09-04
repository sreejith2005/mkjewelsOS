import { useCallback, useEffect, useState } from "react";
import { FileText, Image as ImageIcon } from "lucide-react";
import { fetchTaskAttachments, signedTaskEvidenceUrl } from "@/features/taskEvidence/api";

type Attachment = Awaited<ReturnType<typeof fetchTaskAttachments>>[number];

const fileSize = (bytes: number | null) => bytes === null ? "" : bytes < 1024 ? ` · ${bytes} B` : bytes < 1_048_576 ? ` · ${(bytes / 1024).toFixed(0)} KB` : ` · ${(bytes / 1_048_576).toFixed(1)} MB`;

/**
 * Uploaded evidence attached to one task. The list is fetched only when a task
 * is expanded, and each file opens through a signed link requested at click
 * time so no durable object URL is ever rendered.
 */
export function TaskAttachmentList({ taskId }: { taskId: string }) {
  const [rows, setRows] = useState<readonly Attachment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTaskAttachments(taskId)
      .then((data) => { if (!cancelled) setRows(data); })
      .catch((failure: unknown) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Attachments could not load."); });
    return () => { cancelled = true; };
  }, [taskId]);

  const open = useCallback(async (attachmentId: string) => {
    setError(null);
    try { window.open(await signedTaskEvidenceUrl(attachmentId), "_blank", "noopener,noreferrer"); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The file could not be opened."); }
  }, []);

  if (error) return <p className="text-xs text-task-overdue">{error}</p>;
  if (!rows || rows.length === 0) return null;

  return <div>
    <p className="text-[11px] font-semibold tracking-wide text-task-text-muted">Uploaded evidence</p>
    <ul className="mt-1 flex flex-col gap-1">
      {rows.map((row) => <li key={row.id}>
        <button
          className="flex w-full items-center gap-2 rounded-lg border border-task-border px-3 py-2 text-left text-sm hover:bg-task-muted"
          onClick={() => void open(row.id)}
          type="button"
        >
          {row.mime_type?.startsWith("image/") ? <ImageIcon className="size-4 shrink-0 text-task-text-muted" /> : <FileText className="size-4 shrink-0 text-task-text-muted" />}
          <span className="min-w-0 flex-1 truncate">{row.original_filename ?? "Uploaded file"}</span>
          <span className="shrink-0 text-xs text-task-text-muted">
            {new Date(row.created_at ?? "").toLocaleDateString("en-IN", { dateStyle: "medium" })}{fileSize(row.size_bytes)}
          </span>
        </button>
      </li>)}
    </ul>
  </div>;
}
