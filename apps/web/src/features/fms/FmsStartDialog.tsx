import { useMemo, useState } from "react";
import type { Json } from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import type { UserProfile } from "@/types";
import type { FmsData, FmsStartResult } from "./api";
import { startFmsInstance } from "./api";
import { fmsDepartmentLabel } from "./departments";
import { parseFmsContext } from "./runtimeView";
import { fmsStartBranches, fmsStartDepartments, fmsStartUsers, isFmsStartUserAvailable } from "./startScope";

export function FmsStartDialog({ data, profile, initialFlowId, onClose, onStarted }: {
  data: FmsData;
  profile: UserProfile;
  initialFlowId?: string;
  onClose: () => void;
  onStarted: (result: FmsStartResult) => Promise<void>;
}) {
  const flows = data.flows.filter((flow) => flow.status === "published" && flow.is_active);
  const [flowId, setFlowId] = useState(() => flows.some((item) => item.id === initialFlowId) ? initialFlowId! : flows[0]?.id ?? "");
  const flow = flows.find((item) => item.id === flowId);
  const availableBranches = fmsStartBranches(data.branches, profile);
  const defaultBranch = (candidate?: string | null) => availableBranches.some((branch) => branch.id === candidate)
    ? candidate!
    : availableBranches.some((branch) => branch.id === profile.branch_id) ? profile.branch_id : "";
  const initialBranchId = defaultBranch(flow?.branch_id);
  const defaultDepartment = (branchId: string, candidate?: string | null) => {
    const options = fmsStartDepartments(data, branchId, profile);
    return options.some((department) => department.id === candidate)
      ? candidate!
      : options.some((department) => department.id === profile.department_id) ? profile.department_id : "";
  };

  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<"high" | "medium" | "low">("medium");
  const [branchId, setBranchId] = useState(initialBranchId);
  const [departmentId, setDepartmentId] = useState(() => defaultDepartment(initialBranchId, flow?.department_id));
  const [firstAssigneeId, setFirstAssigneeId] = useState("");
  const [context, setContext] = useState("{}");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const firstStage = useMemo(() => data.stages.filter((stage) => stage.fms_flow_id === flowId).sort((a, b) => a.sort_order - b.sort_order)[0], [data.stages, flowId]);
  const firstRule = data.assignees.find((item) => item.fms_stage_id === firstStage?.id);
  const availabilityByUser = useMemo(() => new Map(data.availability.map((item) => [item.user_profile_id, item.status])), [data.availability]);
  const departments = useMemo(() => fmsStartDepartments(data, branchId, profile), [branchId, data, profile]);
  const users = useMemo(() => fmsStartUsers(data, branchId, departmentId), [branchId, data, departmentId]);
  const primary = data.users.find((user) => user.id === firstRule?.user_profile_id);
  const fallback = data.users.find((user) => user.id === firstRule?.fallback_user_profile_id);
  const configuredAssignee = primary && users.some((user) => user.id === primary.id) && isFmsStartUserAvailable(data, primary.id)
    ? primary
    : fallback && users.some((user) => user.id === fallback.id) && isFmsStartUserAvailable(data, fallback.id) ? fallback : undefined;

  const selectFlow = (nextFlowId: string) => {
    const next = flows.find((item) => item.id === nextFlowId);
    const nextBranch = defaultBranch(next?.branch_id);
    setFlowId(nextFlowId);
    setBranchId(nextBranch);
    setDepartmentId(defaultDepartment(nextBranch, next?.department_id));
    setFirstAssigneeId("");
  };

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = parseFmsContext(context) as Json;
      const result = await startFmsInstance({ flowId, title: title.trim(), priority, context: parsed, branchId, departmentId, firstAssigneeId });
      await onStarted(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start workflow");
    } finally {
      setBusy(false);
    }
  };

  return <div className="space-y-4">
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <Field label="Published workflow"><select autoFocus className="field" onChange={(event) => selectFlow(event.target.value)} value={flowId}>{flows.map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></Field>
    <Field label="Instance title"><input className="field" maxLength={200} onChange={(event) => setTitle(event.target.value)} placeholder="What is this run for?" value={title} /></Field>
    <div className="grid gap-3 sm:grid-cols-3">
      <Field label="Priority"><select className="field" onChange={(event) => setPriority(event.target.value as "high" | "medium" | "low")} value={priority}><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></Field>
      <Field label="Branch"><select className="field" onChange={(event) => { setBranchId(event.target.value); setDepartmentId(""); setFirstAssigneeId(""); }} value={branchId}><option value="">Select branch</option>{availableBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Field>
      <Field label="Department"><select className="field" disabled={!branchId} onChange={(event) => { setDepartmentId(event.target.value); setFirstAssigneeId(""); }} value={departmentId}><option value="">Select department</option>{departments.map((department) => <option key={department.id} value={department.id}>{fmsDepartmentLabel(department, data.branches)}</option>)}</select></Field>
    </div>
    <Field label="Starting assignee"><select className="field" disabled={!departmentId} onChange={(event) => setFirstAssigneeId(event.target.value)} value={firstAssigneeId}><option value="">Select a person</option>{users.map((user) => { const status = availabilityByUser.get(user.id); const available = isFmsStartUserAvailable(data, user.id); return <option disabled={!available} key={user.id} value={user.id}>{user.employee_name}{user.employee_code ? ` · ${user.employee_code}` : ""} · {status?.replaceAll("_", " ") ?? "availability not marked"}{user.is_login_enabled ? "" : " · invited"}</option>; })}</select></Field>
    {departmentId && users.length === 0 ? <Notice>No active or invited Users profiles are assigned to this branch and department.</Notice> : null}
    <section className="rounded-xl border border-gold/20 bg-gold/5 p-3"><p className="text-xs font-semibold uppercase tracking-wide text-gold">Starts with Form</p><p className="mt-1 text-sm font-medium text-white">{firstStage?.name ?? "First Form"}</p><p className="mt-1 text-xs text-soft-grey">Choose who receives the first Form. The workflow default is {configuredAssignee?.employee_name ?? "not available in the selected branch and department"}; absent people cannot be selected.</p></section>
    <details><summary className="cursor-pointer text-sm text-soft-grey">Advanced process data</summary><Field label="Structured context (JSON object)"><textarea className="field mt-2 min-h-24 font-mono text-xs" onChange={(event) => setContext(event.target.value)} value={context} /></Field></details>
    <div className="flex gap-2"><Button disabled={busy || !flowId || !title.trim() || !branchId || !departmentId || !firstAssigneeId} onClick={() => void start()}>{busy ? "Starting…" : "Start workflow"}</Button><Button onClick={onClose} variant="ghost">Cancel</Button></div>
  </div>;
}
