import { useEffect, useState } from "react";
import { supabase } from "@jewelos/api-client";
import type { Tables } from "@jewelos/core";
import { Notice } from "@/components/ui";
import { TaskAdminControls } from "@/features/tasks/TaskAdminControls";

/** Fetch current editable fields only when a filtered task is selected. RLS applies. */
export function TaskManagement({ taskId, onChanged }: Readonly<{ taskId: string; onChanged: () => Promise<void> }>) {
  const [result, setResult] = useState<{ id: string; task: Tables<"task_instances"> | null; error: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await supabase.from("task_instances").select("*").eq("id", taskId).maybeSingle();
        if (!cancelled) setResult({ id: taskId, task: data, error: error?.message ?? (data ? null : "This task is no longer available.") });
      } catch (caught) {
        if (!cancelled) setResult({ id: taskId, task: null, error: caught instanceof Error ? caught.message : "Could not load task." });
      }
    })();
    return () => { cancelled = true; };
  }, [taskId]);
  if (!result || result.id !== taskId) return <p role="status">Loading task…</p>;
  if (result.error) return <Notice tone="danger">{result.error}</Notice>;
  return result.task ? <TaskAdminControls embedded key={taskId} task={result.task} onChanged={onChanged} /> : null;
}
