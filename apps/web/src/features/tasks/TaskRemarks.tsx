import { useCallback, useEffect, useState, type FormEvent } from "react";
import { MessageSquare, SendHorizontal } from "lucide-react";
import { addTaskComment, loadTaskComments, TASK_COMMENT_MAX_LENGTH, type TaskComment } from "@jewelos/data/tasks/comments";
import { Button, Notice } from "@/components/ui";
import { formatIndiaDateTime } from "./TaskDetails";

/**
 * Follow-up remarks for one task. Mounted only inside an expanded card, so a collapsed feed
 * issues no remark requests. `list_task_comments` / `add_task_comment_with_audit` decide access.
 */
export function TaskRemarks({ taskId }: Readonly<{ taskId: string }>) {
  const [comments, setComments] = useState<TaskComment[] | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setComments(await loadTaskComments(taskId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load remarks");
    }
  }, [taskId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await addTaskComment(taskId, draft);
      setDraft("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to add the remark");
    } finally {
      setSending(false);
    }
  };

  return <section aria-label="Remarks" className="flex flex-col gap-3 rounded-xl border border-task-border bg-task-bg p-3">
    <h3 className="flex items-center gap-2 text-sm font-semibold text-task-text"><MessageSquare className="size-4 text-gold" />Remarks</h3>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {comments === null && !error ? <p className="text-sm text-task-text-muted">Loading remarks…</p> : null}
    {comments?.length === 0 ? <p className="text-center text-sm text-task-text-muted">No remarks yet. Looped-in users and participants can add follow-up comments here.</p> : null}
    {comments?.length ? <ul className="flex flex-col gap-2">
      {comments.map((item) => <li className="rounded-lg bg-task-muted p-2" key={item.id}>
        <div className="flex items-center justify-between gap-2 text-xs"><span className="font-semibold text-task-text">{item.authorName}</span><span className="text-task-text-muted">{formatIndiaDateTime(item.createdAt)}</span></div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-task-text">{item.comment}</p>
      </li>)}
    </ul> : null}
    <form className="flex items-end gap-2" onSubmit={(event) => void submit(event)}>
      <textarea aria-label="Add your comment" className="task-field min-h-10 flex-1 rounded-2xl" disabled={sending} maxLength={TASK_COMMENT_MAX_LENGTH} onChange={(event) => setDraft(event.target.value)} placeholder="Add your comment..." rows={1} value={draft} />
      <Button aria-label="Send remark" className="shrink-0 bg-task-accent text-task-text hover:bg-task-accent/90" disabled={sending || !draft.trim()} type="submit"><SendHorizontal /></Button>
    </form>
  </section>;
}
