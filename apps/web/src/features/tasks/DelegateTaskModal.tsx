import { useMemo, useState, type FormEvent } from "react";
import { Search, UserRoundPlus } from "lucide-react";
import { Button, Modal, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { TaskBundle, TaskUser } from "./api";

export function DelegateTaskModal({ canManage, currentUserId, onClose, onDelegate, task, users }: {
  canManage: boolean;
  currentUserId: string;
  onClose: () => void;
  onDelegate: (fromUserId: string, toUserId: string, reason: string) => Promise<void>;
  task: TaskBundle;
  users: TaskUser[];
}) {
  const ownAssignment = task.assignees.find((assignee) => assignee.id === currentUserId)?.id ?? "";
  const [fromUserId, setFromUserId] = useState(ownAssignment || (task.assignees.length === 1 ? task.assignees[0]!.id : ""));
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const assignedIds = useMemo(() => new Set(task.assignees.map((assignee) => assignee.id)), [task.assignees]);
  const candidates = useMemo(() => users.filter((user) =>
    user.id
    && !assignedIds.has(user.id)
    && `${user.employee_name ?? ""} ${user.employee_code ?? ""}`.toLowerCase().includes(search.toLowerCase())),
  [assignedIds, search, users]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onDelegate(fromUserId, selected, reason);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to delegate task");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal onClose={onClose} title="Delegate task" tone="light">
      <form className="flex flex-col gap-4" onSubmit={(event) => void submit(event)}>
        <p className="text-sm text-task-text-muted">{task.title}. Only the selected active assignment moves; other doers remain unchanged and the reason is audited.</p>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {canManage && task.assignees.length > 1 ? <label><span className="mb-1 block text-xs font-semibold text-task-text">Move assignment from</span><select className="task-field" onChange={(event) => setFromUserId(event.target.value)} value={fromUserId}><option value="">Select current doer</option>{task.assignees.map((assignee) => <option key={assignee.id} value={assignee.id}>{assignee.name}</option>)}</select></label> : null}
        <label className="relative"><span className="sr-only">Search users</span><Search className="pointer-events-none absolute left-3 top-3 size-4 text-task-text-muted" /><input className="task-field pl-9" onChange={(event) => setSearch(event.target.value)} placeholder="Search users" value={search} /></label>
        <div className="flex max-h-60 flex-col gap-2 overflow-y-auto">
          {candidates.map((user) => (
            <button className={cn("rounded-xl border p-3 text-left", selected === user.id ? "border-task-accent bg-task-accent-soft" : "border-task-border bg-task-bg")} key={user.id} onClick={() => setSelected(user.id ?? "")} type="button">
              <span className="block text-sm font-semibold text-task-text">{user.employee_name}</span>
              <span className="text-xs capitalize text-task-text-muted">{user.user_role?.replace("_", " ")}</span>
            </button>
          ))}
        </div>
        <label><span className="mb-1 block text-xs font-semibold text-task-text">Reason</span><textarea className="task-field min-h-20" onChange={(event) => setReason(event.target.value)} required value={reason} /></label>
        <div className="flex justify-end gap-3">
          <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={onClose} type="button" variant="secondary">Cancel</Button>
          <Button className="bg-task-accent text-task-text hover:bg-task-accent/90" disabled={!fromUserId || !selected || !reason.trim() || saving} type="submit"><UserRoundPlus />{saving ? "Delegating…" : "Delegate"}</Button>
        </div>
      </form>
    </Modal>
  );
}
