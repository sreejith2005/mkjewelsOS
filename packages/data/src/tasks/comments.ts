import { getSupabase as db } from "@jewelos/api-client/client";

/** One follow-up remark on a task. Authorship and access are resolved by the database. */
export type TaskComment = Readonly<{
  id: string;
  comment: string;
  createdAt: string;
  authorId: string;
  authorName: string;
}>;

export const TASK_COMMENT_MAX_LENGTH = 1_000;

/** Lists a task's remarks, oldest first. `list_task_comments` refuses callers who cannot read the task. */
export async function loadTaskComments(taskId: string): Promise<TaskComment[]> {
  const { data, error } = await db().rpc("list_task_comments", { p_task_id: taskId });
  if (error) throw new Error(`Load remarks: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: row.id,
    comment: row.comment,
    createdAt: row.created_at,
    authorId: row.author_id,
    authorName: row.author_name,
  }));
}

/** Adds a remark through the audited RPC; doers, looped-in users, the creator and elevated roles may comment. */
export async function addTaskComment(taskId: string, comment: string): Promise<string> {
  const text = comment.trim();
  if (!text) throw new Error("Write a remark before sending it.");
  if (text.length > TASK_COMMENT_MAX_LENGTH) throw new Error(`Remarks can be at most ${TASK_COMMENT_MAX_LENGTH} characters.`);
  const { data, error } = await db().rpc("add_task_comment_with_audit", { p_task_id: taskId, p_comment: text });
  if (error) throw new Error(`Add remark: ${error.message}`);
  return data;
}
