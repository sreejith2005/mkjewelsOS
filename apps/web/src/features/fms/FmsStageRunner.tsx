import { useMemo, useState } from "react";
import { deriveFmsTransitionCapability, type FmsStageDefinition } from "@jewelos/core";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { AssigneePicker } from "@/components/assignees/AssigneePicker";
import { FormRenderer, type DynamicOptions } from "@/features/forms/FormRenderer";
import { submitForm, type FormBundle } from "@/features/forms/api";
import {
  claimFmsStage,
  completeFmsStage,
  escalateFmsStage,
  moveFmsStageBackward,
  reassignFmsStage,
  requestFmsRevision,
  reviewFmsStage,
  signedFmsEvidenceUrl,
  updateFmsChecklistItem,
  uploadFmsEvidence,
  type FmsChecklistItem,
  type FmsData,
  type FmsEvidence,
  type FmsInstance,
  type FmsInstanceStage,
  type FmsStageRow,
} from "./api";
import type { UserProfile } from "@/types";
import { eligibleFmsUsers, isInitialFmsDefinition, priorFmsDefinitions, shouldOpenInitialFmsForm } from "./runtimeView";

type ManagedAction = "reassign" | "backward" | "revision" | "escalate";

export function FmsStageRunner({ instance, instanceStages, stage, definition, definitions, checklist, evidence, users, branches, departments, profile, forms, formOptions, onRefresh }: {
  instance: FmsInstance;
  instanceStages: FmsInstanceStage[];
  stage: FmsInstanceStage;
  definition: FmsStageRow;
  definitions: FmsStageRow[];
  checklist: FmsChecklistItem[];
  evidence: FmsEvidence[];
  users: FmsData["users"];
  branches: Array<{ id: string; label: string }>;
  departments: Array<{ id: string; label: string }>;
  profile: UserProfile;
  forms: FormBundle[];
  formOptions: DynamicOptions;
  onRefresh: () => Promise<void>;
}) {
  const requiresLinkedForm = isInitialFmsDefinition(definitions, definition);
  const shouldOpenInitialForm = shouldOpenInitialFmsForm(definitions, definition, stage);
  const [remark, setRemark] = useState("");
  const [outcome, setOutcome] = useState("");
  const [nextAssignee, setNextAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(shouldOpenInitialForm);
  const [managedAction, setManagedAction] = useState<ManagedAction | null>(null);
  const [fromUser, setFromUser] = useState("");
  const [targetUser, setTargetUser] = useState("");
  const [targetStage, setTargetStage] = useState("");
  const [actionReason, setActionReason] = useState("");
  const plannedRule = definition.planned_time_rule && typeof definition.planned_time_rule === "object" ? definition.planned_time_rule as Record<string, unknown> : {};
  const isYesNoDecision = plannedRule.decisionMode === "yes_no";

  const stageContract = useMemo(() => ({
    type: definition.step_type,
    canReject: definition.can_reject ?? false,
    canRequestRevision: definition.can_request_revision ?? false,
    canMoveBackward: definition.can_move_backward ?? false,
    canEscalate: definition.can_escalate ?? false,
  }) as Pick<FmsStageDefinition, "type" | "canReject" | "canRequestRevision" | "canMoveBackward" | "canEscalate">, [definition]);
  const capability = deriveFmsTransitionCapability({ viewerId: profile.id, viewerRole: profile.user_role, assignedIds: stage.assigned_to ?? [], instanceStatus: instance.status, stageStatus: stage.status as never, stage: stageContract });
  const linkedForm = forms.find((form) => form.id === definition.form_template_id);
  const eligible = eligibleFmsUsers(users, instance);
  const branchNames = useMemo(() => new Map(branches.map((branch) => [branch.id, branch.label])), [branches]);
  const departmentNames = useMemo(() => new Map(departments.map((department) => [department.id, department.label])), [departments]);
  const pickerPeople = useMemo(() => eligible.map((user) => ({ id: user.id, employee_name: user.employee_name, employee_code: user.employee_code ?? null, branch_id: user.branch_id, department_id: user.department_id, user_role: user.user_role })), [eligible]);
  const priorStages = priorFmsDefinitions(definitions, instanceStages, instance.fms_flow_id, definition);
  const canClaim = (stage.assigned_to ?? []).includes(profile.id) && ["pending", "in_progress", "in_review", "overdue"].includes(stage.status) && ["active", "overdue"].includes(instance.status);

  const work = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try { await fn(); await onRefresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "FMS action failed"); }
    finally { setBusy(false); }
  };
  const checklistPayload = Object.fromEntries(checklist.map((item) => [item.item_key, item.is_completed]));
  const openManagedAction = (action: ManagedAction) => {
    setManagedAction(action);
    setFromUser(stage.assigned_to?.[0] ?? "");
    setTargetUser("");
    setTargetStage(priorStages.at(-1)?.id ?? "");
    setActionReason("");
  };
  const runManagedAction = async () => {
    if (!managedAction || !actionReason.trim()) return;
    if (managedAction === "reassign" && fromUser && targetUser) await work(() => reassignFmsStage(stage.id, fromUser, targetUser, actionReason));
    if (managedAction === "backward" && targetStage) await work(() => moveFmsStageBackward(stage.id, targetStage, actionReason, targetUser || null));
    if (managedAction === "revision" && targetStage) await work(() => requestFmsRevision(stage.id, targetStage, actionReason, targetUser || null));
    if (managedAction === "escalate") await work(() => escalateFmsStage(stage.id, actionReason));
    setManagedAction(null);
  };

  return <section className="space-y-3 rounded-2xl border border-gold/20 p-4">
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-semibold text-white">{definition.name}</h3><p className="text-sm text-soft-grey">{definition.method}</p></div><span className="rounded-full bg-gold/10 px-3 py-1 text-xs text-gold">{stage.status.replaceAll("_", " ")}</span></div>
    <p className="text-xs text-soft-grey">Assigned: {(stage.assigned_to ?? []).map((id) => users.find((user) => user.id === id)?.employee_name ?? "Historical user").join(", ") || "Automatic"} · Due {stage.planned_datetime ? new Date(stage.planned_datetime).toLocaleDateString("en-IN") : "—"}{stage.delay_minutes && stage.delay_minutes > 0 ? " · overdue" : ""}</p>
    {canClaim ? <Button disabled={busy} onClick={() => void work(() => claimFmsStage(stage.id))} variant="secondary">Claim stage</Button> : null}
    {checklist.length ? <fieldset><legend className="mb-2 text-sm text-champagne">Checklist</legend>{checklist.map((item) => <label className="mb-1 block text-sm" key={item.id}><input checked={item.is_completed} disabled={(!capability.canComplete && !capability.canApprove) || busy} onChange={(event) => void work(() => updateFmsChecklistItem(item.id, event.target.checked))} type="checkbox" /> {item.label}{item.is_required ? " *" : ""}</label>)}</fieldset> : null}
    {evidence.length ? <div className="flex flex-wrap gap-2">{evidence.map((item) => <Button key={item.id} onClick={() => void signedFmsEvidenceUrl(item.storage_path).then((url) => window.open(url, "_blank", "noopener,noreferrer"))} variant="secondary">View {item.original_filename}</Button>)}</div> : null}
    {definition.requires_upload ? <Field label="Evidence (JPG, PNG, WebP, PDF; max 10 MB)"><input accept=".jpg,.jpeg,.png,.webp,.pdf" className="field" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void work(() => uploadFmsEvidence(stage.id, profile.tenant_id, file)); }} type="file" /></Field> : null}
    {definition.form_template_id ? stage.form_submission_id ? <Notice tone="success">Linked form version submitted and locked.</Notice> : linkedForm ? <Button onClick={() => setShowForm(true)} variant="secondary">Fill {requiresLinkedForm ? "required" : "optional"} form · {linkedForm.name} v{linkedForm.version}</Button> : requiresLinkedForm ? <Notice tone="danger">The exact pinned form version is not visible.</Notice> : <Notice>Optional linked form is not currently visible. You can still complete this step.</Notice> : null}
    {(capability.canComplete || capability.canApprove) ? <>
      <div className="grid gap-2 sm:grid-cols-2">{isYesNoDecision ? <Field label="Decision *"><div className="grid grid-cols-2 gap-2"><button className={`rounded-lg border p-2 ${outcome === "yes" ? "border-success bg-success/10 text-success" : "border-gold/20 text-soft-grey"}`} onClick={() => setOutcome("yes")} type="button">Yes</button><button className={`rounded-lg border p-2 ${outcome === "no" ? "border-danger bg-danger/10 text-danger" : "border-gold/20 text-soft-grey"}`} onClick={() => setOutcome("no")} type="button">No</button></div></Field> : <Field label="Outcome"><input className="field" maxLength={500} onChange={(event) => setOutcome(event.target.value)} value={outcome} /></Field>}<Field label={definition.requires_remark ? "Remark *" : "Remark"}><textarea className="field" maxLength={4000} onChange={(event) => setRemark(event.target.value)} value={remark} /></Field></div>
      {definition.requires_next_doer_handoff ? <AssigneePicker branchNames={branchNames} departmentNames={departmentNames} label="Next-stage assignee" multiple={false} onChange={(ids) => setNextAssignee(ids[0] ?? "")} people={pickerPeople} selectedIds={nextAssignee ? [nextAssignee] : []}/> : null}
      <div className="flex flex-wrap gap-2">
        {capability.canComplete ? <Button disabled={busy || (isYesNoDecision && !outcome)} onClick={() => void work(() => completeFmsStage(stage.id, outcome, remark, checklistPayload, nextAssignee || null))}>{isYesNoDecision ? "Submit decision" : "Complete stage"}</Button> : null}
        {capability.canApprove ? <Button disabled={busy} onClick={() => void work(() => reviewFmsStage(stage.id, "approved", remark, nextAssignee || null))}>Approve</Button> : null}
        {capability.canReject ? <Button disabled={busy} onClick={() => window.confirm("Reject this stage?") && void work(() => reviewFmsStage(stage.id, "rejected", remark, nextAssignee || null))} variant="danger">Reject</Button> : null}
        {capability.canRequestRevision && priorStages.length ? <Button disabled={busy} onClick={() => openManagedAction("revision")} variant="secondary">Request revision</Button> : null}
        {capability.canMoveBackward && priorStages.length ? <Button disabled={busy} onClick={() => openManagedAction("backward")} variant="secondary">Move backward</Button> : null}
        {capability.canEscalate ? <Button disabled={busy} onClick={() => openManagedAction("escalate")} variant="secondary">Escalate</Button> : null}
      </div>
    </> : <p className="text-xs text-soft-grey">{capability.reason}</p>}
    {capability.canReassign && (stage.assigned_to?.length ?? 0) > 0 ? <Button disabled={busy} onClick={() => openManagedAction("reassign")} variant="secondary">Reassign</Button> : null}
    {showForm && linkedForm ? <Modal onClose={() => setShowForm(false)} title={`${requiresLinkedForm ? "Required" : "Optional"} form: ${linkedForm.name} v${linkedForm.version}`} wide><FormRenderer definition={{ name: linkedForm.name, description: linkedForm.description ?? undefined, fields: linkedForm.fields }} dynamicOptions={formOptions} onSubmit={async (answers) => { await submitForm(linkedForm.id, answers, "fms_stage", stage.id); setShowForm(false); await onRefresh(); }} /></Modal> : null}
    {managedAction ? <Modal onClose={() => setManagedAction(null)} title={managedAction.replace("_", " ")}>
      <div className="space-y-3">
        {managedAction === "reassign" ? <Field label="Current assignee"><select className="field" onChange={(event) => setFromUser(event.target.value)} value={fromUser}>{(stage.assigned_to ?? []).map((id) => <option key={id} value={id}>{users.find((user) => user.id === id)?.employee_name ?? "Historical user"}</option>)}</select></Field> : null}
        {managedAction === "reassign" ? <AssigneePicker branchNames={branchNames} departmentNames={departmentNames} label="New eligible assignee" multiple={false} onChange={(ids) => setTargetUser(ids[0] ?? "")} people={pickerPeople.filter((user) => !(stage.assigned_to ?? []).includes(user.id))} selectedIds={targetUser ? [targetUser] : []}/> : null}
        {managedAction === "backward" || managedAction === "revision" ? <><Field label="Earlier stage"><select className="field" onChange={(event) => setTargetStage(event.target.value)} value={targetStage}>{priorStages.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field><AssigneePicker branchNames={branchNames} departmentNames={departmentNames} label="Optional assignee" multiple={false} onChange={(ids) => setTargetUser(ids[0] ?? "")} people={pickerPeople} selectedIds={targetUser ? [targetUser] : []}/></> : null}
        <Field label="Reason *"><textarea className="field" maxLength={1000} onChange={(event) => setActionReason(event.target.value)} value={actionReason} /></Field>
        <div className="flex gap-2"><Button disabled={busy || !actionReason.trim() || (managedAction === "reassign" && !targetUser) || ((managedAction === "backward" || managedAction === "revision") && !targetStage)} onClick={() => void runManagedAction()}>Confirm</Button><Button onClick={() => setManagedAction(null)} variant="ghost">Cancel</Button></div>
      </div>
    </Modal> : null}
  </section>;
}
