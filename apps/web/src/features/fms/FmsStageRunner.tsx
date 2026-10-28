import {FmsCustomerLink} from "./FmsCustomerLink";
import { fmsOutcomeReplacesStage } from "@jewelos/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Circle, FileText, History, Paperclip } from "lucide-react";
import { deriveFmsTransitionCapability, describeDue, fmsPlannedRuleFormSectionKey, fmsStageFormDefinition, fmsStageCompletionChecklist, fmsEmployeeStatusLabel, hasFmsFormAssignmentSource, type FmsStageDefinition, type FmsWorkResult, type FmsTransitionRequest } from "@jewelos/core";
import { FmsWorkOutcome } from "./FmsWorkOutcome";
import { useFmsHandoffConfirmation } from "./useFmsHandoffConfirmation";
import { useFmsEarlierAnswers } from "./earlierAnswers";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { AssigneePicker } from "@/components/assignees/AssigneePicker";
import { FormRenderer, type DynamicOptions } from "@/features/forms/FormRenderer";
import { type FormBundle } from "@/features/forms/api";
import {
  claimFmsStage,
  escalateFmsStage,
  moveFmsStageBackward,
  reassignFmsStage,
  requestFmsRevision,
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
import { eligibleFmsUsers, isInitialFmsDefinition, priorFmsDefinitions, shouldOpenFmsForm } from "./runtimeView";

type ManagedAction = "reassign" | "backward" | "revision" | "escalate";

type RuntimeDecisionOption = Readonly<{ key: string; label: string }>;

export function runtimeDecisionOptions(plannedRule: Record<string, unknown>): readonly RuntimeDecisionOption[] {
  const configured = plannedRule.decisionOptions;
  if (Array.isArray(configured)) {
    return configured.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const key = (item as Record<string, unknown>).key;
      const label = (item as Record<string, unknown>).label;
      return typeof key === "string" && key && typeof label === "string" && label.trim() ? [{ key, label: label.trim() }] : [];
    });
  }
  return plannedRule.decisionMode === "yes_no" ? [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }] : [];
}

export function FmsStageRunner({ instance, instanceStages, stage, definition, definitions, checklist, evidence, users, branches, departments, profile, forms, formOptions, onRefresh, requestedFormTemplateId, onResult, compact = false }: {
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
  onResult?: (result: FmsWorkResult) => void;
  requestedFormTemplateId?: string;
  /** The assigned-work page already names the record; skip the stage/assignee/due header. */
  compact?: boolean;
}) {
  const requiresLinkedForm = isInitialFmsDefinition(definitions, definition) || hasFmsFormAssignmentSource(definition.planned_time_rule)
    || !!(definition.planned_time_rule && typeof definition.planned_time_rule === "object" && !Array.isArray(definition.planned_time_rule) && definition.planned_time_rule.completionFormRequired === true);
  const shouldOpenInitialForm = shouldOpenFmsForm(definitions, definition, stage, requestedFormTemplateId);
  const [remark, setRemark] = useState("");
  const [outcome, setOutcome] = useState("");
  const [nextAssignee, setNextAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(shouldOpenInitialForm);
  // On the assigned-work page the form opens in the page itself, under the earlier answers, instead of a dialog over them.
  const inlineForm = compact;
  const inlineFormRef = useRef<HTMLElement>(null);
  const openEarlier = useFmsEarlierAnswers();
  useEffect(() => { if (inlineForm && showForm) inlineFormRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" }); }, [inlineForm, showForm]);
  const actor = useMemo(() => ({ id: profile.id, name: profile.employee_name }), [profile.id, profile.employee_name]);
  const { confirmWork, result, confirmation } = useFmsHandoffConfirmation(stage.id, actor);
  const completeWork = async (request: FmsTransitionRequest) => {
    const saved = await confirmWork(request);
    if (saved) onResult?.(saved);
    return saved;
  };
  const [managedAction, setManagedAction] = useState<ManagedAction | null>(null);
  const [fromUser, setFromUser] = useState("");
  const [targetUser, setTargetUser] = useState("");
  const [targetStage, setTargetStage] = useState("");
  const [actionReason, setActionReason] = useState("");
  const plannedRule = definition.planned_time_rule && typeof definition.planned_time_rule === "object" ? definition.planned_time_rule as Record<string, unknown> : {};
  const decisionOptions = runtimeDecisionOptions(plannedRule);
  const isDecision = decisionOptions.length > 0;

  const stageContract = useMemo(() => ({
    type: definition.step_type,
    canReject: definition.can_reject ?? false,
    canRequestRevision: definition.can_request_revision ?? false,
    canMoveBackward: definition.can_move_backward ?? false,
    canEscalate: definition.can_escalate ?? false,
  }) as Pick<FmsStageDefinition, "type" | "canReject" | "canRequestRevision" | "canMoveBackward" | "canEscalate">, [definition]);
  const capability = deriveFmsTransitionCapability({ viewerId: profile.id, viewerRole: profile.user_role, assignedIds: stage.assigned_to ?? [], instanceStatus: instance.status, stageStatus: stage.status as never, stage: stageContract });
  const linkedForm = forms.find((form) => form.id === definition.form_template_id);
  /** The doer answers only the stage's linked section; the server enforces the same scope. */
  const stageForm = useMemo(() => linkedForm ? fmsStageFormDefinition({ sla: { dueDate: "", formSectionKey: fmsPlannedRuleFormSectionKey(definition.planned_time_rule) } }, { name: linkedForm.name, description: linkedForm.description ?? undefined, sections: linkedForm.sections, fields: linkedForm.fields }) : undefined, [definition.planned_time_rule, linkedForm]);
  const sectionUnavailable = !!linkedForm && !stageForm;
  const sectionTitle = fmsPlannedRuleFormSectionKey(definition.planned_time_rule) ? stageForm?.sections?.[0]?.title : undefined;
  const formTitle = linkedForm ? `${linkedForm.name}${sectionTitle ? ` · ${sectionTitle}` : ""}` : "";
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

  if (result && fmsOutcomeReplacesStage(result.state)) return <FmsWorkOutcome result={result} viewerId={profile.id} />;

  const canAct = capability.canComplete || capability.canApprove;
  const legacyNextAssignee = !!definition.requires_next_doer_handoff && instance.assignment_version !== 2;
  const requiredChecklist = checklist.filter((item) => item.is_required);
  const requirements = fmsStageCompletionChecklist({
    formRequired: !!definition.form_template_id && requiresLinkedForm, formSubmitted: !!stage.form_submission_id, formName: linkedForm?.name,
    decisionRequired: isDecision, decisionChosen: !!outcome,
    requiredChecklistOpen: requiredChecklist.filter((item) => !item.is_completed).length, requiredChecklistTotal: requiredChecklist.length,
    evidenceRequired: !!definition.requires_upload, evidenceCount: evidence.length,
    remarkRequired: !!definition.requires_remark, remarkProvided: !!remark.trim(),
    nextAssigneeRequired: legacyNextAssignee, nextAssigneeChosen: !!nextAssignee,
  });
  const formPending = !!definition.form_template_id && !stage.form_submission_id && !!linkedForm;
  const due = describeDue(stage.planned_datetime, undefined, { completed: stage.status === "completed" });
  const assignedNames = (stage.assigned_to ?? []).map((id) => users.find((user) => user.id === id)?.employee_name ?? "Historical user").join(", ") || "Automatic";

  return <section aria-label={`Your work: ${definition.name}`} className={compact ? "space-y-4" : "space-y-4 rounded-2xl border border-gold/20 bg-task-bg p-4 sm:p-5"}>
    <FmsCustomerLink instanceId={instance.id}/>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {instance.status === "on_hold" ? <Notice>The workflow is on hold for manager review. Your saved form and assigned work are preserved.</Notice> : null}
    {result ? <FmsWorkOutcome result={result} viewerId={profile.id} /> : null}
    {compact ? definition.method ? <p className="text-sm text-task-text-muted">{definition.method}</p> : null : <header className="space-y-1">
      <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 break-words text-lg font-semibold text-task-text">{definition.name}{stage.visit_number && stage.visit_number > 1 ? ` (visit ${stage.visit_number})` : ""}</h3><span className="rounded-full bg-gold/10 px-3 py-1 text-xs font-semibold text-gold-secondary">{fmsEmployeeStatusLabel(stage.status)}</span></div>
      {definition.method ? <p className="text-sm text-task-text-muted">{definition.method}</p> : null}
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-task-text-muted"><span>Assigned to {assignedNames}</span><span className={due.tone === "overdue" || (stage.delay_minutes ?? 0) > 0 ? "font-semibold text-danger" : undefined}>{due.label}{(stage.delay_minutes ?? 0) > 0 && due.tone !== "overdue" ? " · Overdue" : ""}</span></p>
    </header>}
    {canClaim ? <Button disabled={busy} onClick={() => void work(() => claimFmsStage(stage.id))} variant="secondary">Claim stage</Button> : null}
    {canAct && requirements.length ? <div className="rounded-xl border border-task-border bg-task-muted/50 p-3">
      <p className="text-sm font-semibold text-task-text">Before you complete this step</p>
      <ul className="mt-2 space-y-1.5">{requirements.map((item) => <li className="flex items-start gap-2 text-sm" key={item.key}>
        {item.done ? <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" /> : <Circle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-task-text-muted" />}
        <span className={item.done ? "text-task-text-muted line-through" : "text-task-text"}>{item.label}<span className="sr-only">{item.done ? " (done)" : " (still to do)"}</span></span>
      </li>)}</ul>
    </div> : null}
    {checklist.length ? <fieldset className="space-y-2"><legend className="mb-1 text-sm font-semibold text-task-text">Checklist</legend>{checklist.map((item) => <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border border-task-border px-3 py-2 text-sm text-task-text has-[:checked]:border-gold has-[:checked]:bg-gold/10" key={item.id}><input checked={item.is_completed} disabled={!canAct || busy} onChange={(event) => void work(() => updateFmsChecklistItem(item.id, event.target.checked))} type="checkbox" /><span className="min-w-0 break-words">{item.label}{item.is_required ? <span aria-hidden="true" className="ml-1 text-danger">*</span> : null}</span></label>)}</fieldset> : null}
    {definition.requires_upload || evidence.length ? <div className="space-y-2">
      <p className="text-sm font-semibold text-task-text">Evidence</p>
      {evidence.length ? <div className="flex flex-wrap gap-2">{evidence.map((item) => <Button className="max-w-full whitespace-normal break-words text-left" key={item.id} onClick={() => void signedFmsEvidenceUrl(item.storage_path).then((url) => window.open(url, "_blank", "noopener,noreferrer"))} variant="secondary"><Paperclip aria-hidden="true" className="size-4" />View {item.original_filename}</Button>)}</div> : null}
      {definition.requires_upload ? <Field label={evidence.length ? "Add another file (JPG, PNG, WebP or PDF, up to 10 MB)" : "Upload evidence (JPG, PNG, WebP or PDF, up to 10 MB)"}><input accept=".jpg,.jpeg,.png,.webp,.pdf" className="field" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void work(() => uploadFmsEvidence(stage.id, profile.tenant_id, file)); }} type="file" /></Field> : null}
    </div> : null}
    {canAct ? <div className="grid gap-3 sm:grid-cols-2">
      {isDecision ? <fieldset className="space-y-2 sm:col-span-2"><legend className="label">Decision *</legend><div className="grid gap-2 sm:grid-cols-2">{decisionOptions.map((option) => <button aria-pressed={outcome === option.key} className={`min-h-12 rounded-lg border px-3 py-2 text-left text-sm ${outcome === option.key ? "border-gold bg-gold/10 font-semibold text-task-text" : "border-task-border text-task-text-muted hover:border-gold/50"}`} key={option.key} onClick={() => setOutcome(option.key)} type="button">{option.label}</button>)}</div></fieldset>
        : <Field label="Outcome (optional)"><input className="field" maxLength={500} onChange={(event) => setOutcome(event.target.value)} value={outcome} /></Field>}
      <Field label={definition.requires_remark ? "Remark *" : "Remark (optional)"}><textarea className="field" maxLength={4000} onChange={(event) => setRemark(event.target.value)} value={remark} /></Field>
    </div> : null}
    {canAct && legacyNextAssignee ? <AssigneePicker branchNames={branchNames} departmentNames={departmentNames} label="Next-stage assignee" multiple={false} onChange={(ids) => setNextAssignee(ids[0] ?? "")} people={pickerPeople} selectedIds={nextAssignee ? [nextAssignee] : []}/> : null}
    {definition.form_template_id ? stage.form_submission_id ? <Notice tone="success">The form has been submitted and saved.</Notice>
      : sectionUnavailable ? <Notice tone="danger">This step's form section is no longer in the linked form. Ask your manager to check the workflow.</Notice>
      : !linkedForm ? requiresLinkedForm ? <Notice tone="danger">This step's form is not available to your account. Ask your manager to check the workflow.</Notice> : <Notice>The optional form is not available right now. You can still complete this step.</Notice> : null : null}
    <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      {formPending && linkedForm && stageForm && !(inlineForm && showForm) ? <Button className="min-h-12" onClick={() => setShowForm(true)} variant={requiresLinkedForm ? "primary" : "secondary"}><FileText aria-hidden="true" className="size-4" />{requiresLinkedForm ? `Fill the form: ${formTitle}` : `Fill the optional form: ${formTitle}`}</Button> : null}
      {canAct ? <>
        {capability.canComplete && !(formPending && requiresLinkedForm) ? <Button className="min-h-12" disabled={busy || (isDecision && !outcome) || (requiresLinkedForm && !stage.form_submission_id)} onClick={() => void work(() => completeWork({ kind: "complete", instanceStageId: stage.id, outcome, remark, checklist: checklistPayload, ...(nextAssignee ? { nextAssigneeId: nextAssignee } : {}) }))}>{isDecision ? "Submit decision" : "Complete stage"}</Button> : null}
        {capability.canApprove ? <Button className="min-h-12" disabled={busy} onClick={() => void work(() => completeWork({ kind: "review", instanceStageId: stage.id, decision: "approved", remark, ...(nextAssignee ? { nextAssigneeId: nextAssignee } : {}) }))}>Approve</Button> : null}
        {capability.canReject ? <Button className="min-h-12" disabled={busy} onClick={() => void work(() => completeWork({ kind: "review", instanceStageId: stage.id, decision: "rejected", remark, ...(nextAssignee ? { nextAssigneeId: nextAssignee } : {}) }))} variant="danger">Reject</Button> : null}
      </> : null}
    </div>
    {formPending && requiresLinkedForm && capability.canComplete ? <p className="text-xs text-task-text-muted">Submitting the form also completes this step, using the details above.</p> : null}
    {!canAct ? <p className="text-sm text-task-text-muted">{capability.reason}</p> : null}
    {(canAct && ((capability.canRequestRevision || capability.canMoveBackward) && priorStages.length || capability.canEscalate)) || (capability.canReassign && (stage.assigned_to?.length ?? 0) > 0) ? <details className="rounded-xl border border-task-border px-3">
      <summary className="min-h-11 cursor-pointer content-center text-sm font-medium text-task-text-muted">More actions</summary>
      <div className="flex flex-wrap gap-2 pb-3">
        {canAct && capability.canRequestRevision && priorStages.length ? <Button disabled={busy} onClick={() => openManagedAction("revision")} variant="secondary">Request revision</Button> : null}
        {canAct && capability.canMoveBackward && priorStages.length ? <Button disabled={busy} onClick={() => openManagedAction("backward")} variant="secondary">Move backward</Button> : null}
        {canAct && capability.canEscalate ? <Button disabled={busy} onClick={() => openManagedAction("escalate")} variant="secondary">Escalate</Button> : null}
        {capability.canReassign && (stage.assigned_to?.length ?? 0) > 0 ? <Button disabled={busy} onClick={() => openManagedAction("reassign")} variant="secondary">Reassign</Button> : null}
      </div>
    </details> : null}
    {showForm && linkedForm && stageForm ? (() => {
      const title = requiresLinkedForm ? formTitle : `Optional form: ${formTitle}`;
      const renderer = <FormRenderer definition={stageForm} dynamicOptions={formOptions} templateId={linkedForm.id} onSubmit={async (answers) => {
        if (!await completeWork({ kind: "stage_form", formTemplateId: linkedForm.id, answers, instanceStageId: stage.id, outcome, remark, checklist: checklistPayload, ...(nextAssignee ? { nextAssigneeId: nextAssignee } : {}) })) return false;
        setShowForm(false); await onRefresh(); return true;
      }} workflowHint {...(inlineForm && openEarlier ? { extraAction: <Button aria-label="See earlier answers" className="min-h-12 shrink-0 px-3" onClick={openEarlier} title="Earlier answers" type="button" variant="secondary"><History aria-hidden="true" className="size-5" /><span className="hidden sm:inline">Earlier answers</span></Button> } : {})} />;
      return inlineForm
        ? <section aria-label={`Your form: ${title}`} className="scroll-mt-24 space-y-3 rounded-2xl border border-gold/30 bg-task-muted/40 p-3 sm:p-5" ref={inlineFormRef}>
            <header className="flex flex-wrap items-start justify-between gap-2 px-1"><h2 className="min-w-0 flex-1 break-words text-lg font-semibold text-task-text">{title}</h2>{openEarlier ? <Button className="min-h-11" onClick={openEarlier} type="button" variant="ghost"><History aria-hidden="true" className="size-4" />Earlier answers</Button> : null}</header>
            {renderer}
          </section>
        : <Modal onClose={() => setShowForm(false)} title={title} mobileFullscreen wide>{renderer}</Modal>;
    })() : null}
    {confirmation}
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
