import { useState } from "react";
import { View } from "react-native";
import { taskAdminInitialEdit, type TaskAdminEdit } from "@jewelos/core";
import { adminDeleteTask, adminEditTask } from "@jewelos/data/tasks/api";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { DateField } from "@/forms/DateField";
import { ToggleField } from "@/forms/ToggleField";

type ManagedTask = Parameters<typeof taskAdminInitialEdit>[0] & Readonly<{ id: string | null; task_template_id: string | null }>;

export function TaskAdminControls({ task, onChanged }: Readonly<{ task: ManagedTask; onChanged: () => Promise<void> }>) {
  const [mode, setMode] = useState<"edit" | "delete" | null>(null);
  const [edit, setEdit] = useState<TaskAdminEdit>(() => taskAdminInitialEdit(task));
  const [series, setSeries] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = (next: "edit" | "delete") => { setEdit(taskAdminInitialEdit(task)); setSeries(false); setError(null); setReason(""); setMode(next); };
  const save = async () => {
    if (!task.id || busy) return;
    setBusy(true); setError(null);
    try {
      if (mode === "edit") await adminEditTask(task.id, edit);
      else await adminDeleteTask(task.id, series, reason);
      setMode(null); await onChanged();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Task change failed"); }
    finally { setBusy(false); }
  };
  return <View>
    {mode === null ? <View><Button label="Edit task" variant="secondary" onPress={() => open("edit")} /><Button label="Delete task" variant="danger" onPress={() => open("delete")} /></View> : <View>
      <Text variant="title">{mode === "edit" ? "Edit task" : "Delete task"}</Text>
      {error ? <Text tone="danger">{error}</Text> : null}
      {mode === "edit" ? <>
        <TextField label="Title" required maxLength={300} value={edit.title} onChangeText={(title) => setEdit({ ...edit, title })} />
        <TextField label="Description" multiline maxLength={10000} value={edit.description} onChangeText={(description) => setEdit({ ...edit, description })} />
        <SegmentedControl accessibilityLabel="Priority" value={edit.priority} options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }]} onChange={(priority) => setEdit({ ...edit, priority })} />
        <DateField label="Start" mode="datetime" disabled={busy} invalid={false} value={edit.planned.length === 16 ? `${edit.planned}+05:30` : edit.planned} onChange={(planned) => setEdit({ ...edit, planned })} />
        <DateField label="Due" mode="datetime" disabled={busy} invalid={false} value={edit.due.length === 16 ? `${edit.due}+05:30` : edit.due} onChange={(due) => setEdit({ ...edit, due })} />
        {task.task_template_id ? <Text tone="muted">This edits this occurrence. Change future schedules in Recurring / To-Do.</Text> : null}
      </> : <>
        <Text>{`Delete "${task.title}" from active work?`}</Text>
        {task.task_template_id ? <ToggleField disabled={busy} required={false} label="Delete entire recurring series" value={series} onChange={setSeries} /> : null}
        <Text tone="muted">{series ? "Stops generation and removes all unfinished occurrences. Completed history and evidence are preserved." : "Removes this occurrence. Future recurring tasks will continue."}</Text>
        <TextField label="Reason (optional)" multiline maxLength={1000} value={reason} onChangeText={setReason} />
      </>}
      <Button label="Cancel" disabled={busy} variant="secondary" onPress={() => setMode(null)} />
      <Button label={mode === "edit" ? "Save changes" : "Confirm deletion"} variant={mode === "delete" ? "danger" : "primary"} busy={busy} onPress={() => void save()} />
    </View>}
  </View>;
}
