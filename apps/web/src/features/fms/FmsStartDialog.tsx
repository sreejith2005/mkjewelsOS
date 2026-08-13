import { useMemo, useState } from "react";
import type { Json } from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import type { FmsData } from "./api";
import { startFmsInstance } from "./api";
import { parseFmsContext } from "./runtimeView";

export function FmsStartDialog({ data, initialFlowId, onClose, onStarted }: { data: FmsData; initialFlowId?: string; onClose: () => void; onStarted: (reference: string) => Promise<void> }) {
  const flows = data.flows.filter((flow) => flow.status === "published" && flow.is_active);
  const [flowId, setFlowId] = useState(() => flows.some((item) => item.id === initialFlowId) ? initialFlowId! : flows[0]?.id ?? "");
  const flow = flows.find((item) => item.id === flowId);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [branchId, setBranchId] = useState(flow?.branch_id ?? "");
  const [departmentId, setDepartmentId] = useState(flow?.department_id ?? "");
  const [context, setContext] = useState("{}");
  const [firstAssigneeId, setFirstAssigneeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstStage = useMemo(() => data.stages.filter((stage) => stage.fms_flow_id === flowId).sort((a, b) => a.sort_order - b.sort_order)[0], [data.stages, flowId]);
  const firstRule = data.assignees.find((item) => item.fms_stage_id === firstStage?.id);
  const eligibleUsers = data.users.filter((user) => user.working_status !== "inactive" && user.working_status !== "resigned" && user.is_login_enabled && (!branchId || user.branch_id === branchId) && (!departmentId || user.department_id === departmentId));
  const candidates = firstRule?.assignee_type === "specific_user"
    ? eligibleUsers.filter((user) => user.id === firstRule.user_profile_id || user.id === firstRule.fallback_user_profile_id)
    : eligibleUsers;
  const start = async () => {
    setBusy(true); setError(null);
    try {
      const parsed = parseFmsContext(context) as Json;
      const result = await startFmsInstance({ flowId, title: title.trim(), priority, context: parsed, branchId: branchId || null, departmentId: departmentId || null, firstAssigneeId: firstAssigneeId || null });
      await onStarted(result.reference_number);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to start flow"); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4">
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <Field label="Published flow"><select autoFocus className="field" onChange={(event) => { const next = flows.find((item) => item.id === event.target.value); setFlowId(event.target.value); setBranchId(next?.branch_id ?? ""); setDepartmentId(next?.department_id ?? ""); setFirstAssigneeId(""); }} value={flowId}>{flows.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></Field>
    <Field label="Instance title"><input className="field" maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="What is this run for?" value={title} /></Field>
    <div className="grid gap-3 sm:grid-cols-3"><Field label="Priority"><select className="field" onChange={(event) => setPriority(event.target.value as never)} value={priority}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></Field><Field label="Branch"><select className="field" disabled={!!flow?.branch_id} onChange={(event) => { setBranchId(event.target.value); setDepartmentId(""); }} value={branchId}><option value="">Select</option>{data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Field><Field label="Department"><select className="field" disabled={!!flow?.department_id} onChange={(event) => setDepartmentId(event.target.value)} value={departmentId}><option value="">Select</option>{data.departments.filter((department) => !branchId || department.branch_id === branchId).map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></Field></div>
    <Field label="Safe structured context (JSON object)"><textarea className="field min-h-24 font-mono text-xs" onChange={(event) => setContext(event.target.value)} value={context} /></Field>
    {candidates.length > 1 && !firstStage?.allow_multiple_doers ? <Field label="Required first-stage assignee"><select className="field" onChange={(event) => setFirstAssigneeId(event.target.value)} value={firstAssigneeId}><option value="">Select eligible user</option>{candidates.map((user) => <option key={user.id} value={user.id}>{user.employee_name}</option>)}</select></Field> : null}
    <Button disabled={busy || !flowId || !title.trim()} onClick={() => void start()}>{busy ? "Starting…" : "Start flow"}</Button><Button onClick={onClose} variant="ghost">Cancel</Button>
  </div>;
}
