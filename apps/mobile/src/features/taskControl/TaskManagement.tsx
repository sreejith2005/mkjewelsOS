import { getSupabase } from "@jewelos/api-client/client";
import { TaskAdminControls } from "@/features/tasks/TaskAdminControls";
import { useAsyncData } from "@/lib/useAsyncData";
import { Banner, LoadingState } from "@/ui/states";

export function TaskManagement({ taskId, onChanged }: Readonly<{ taskId: string; onChanged: () => Promise<void> }>) {
  const state = useAsyncData(async () => {
    const { data, error } = await getSupabase().from("task_instances").select("*").eq("id", taskId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("This task is no longer available.");
    return data;
  }, [taskId]);
  if (state.loading) return <LoadingState label="Loading task..." />;
  if (state.error) return <Banner tone="danger">{state.error}</Banner>;
  return state.data ? <TaskAdminControls key={taskId} task={state.data} onChanged={onChanged} /> : null;
}
