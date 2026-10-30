import { FmsAssignmentEditor } from "./FmsAssignmentEditor";
import { FmsTaskNaming } from "./FmsTaskNaming";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Eye, FilePlus2, GitBranch, Import, Link2, Pencil, Plus, Trash2, X } from "lucide-react";
import {
  FMS_ASSIGNMENT_LABELS,
  FMS_BRANCH_OPERATORS,
  fmsStageNeedsAssignment,
  fmsFieldOptions,
  fmsRouteAnswerSelection,
  fmsAssignmentFields,
  fmsStageFormFields,
  fmsStageFormSectionKey,
  hasFmsStageFallback,
  hasFmsStageRouting,
  type FmsBranchOperator,
  type FmsBranchRule,
  type FmsChecklistItemDefinition,
  type FmsFormFieldRef,
  type FmsSlaRule,
  type FmsStageDefinition,
  type FmsTimingMethod,
} from "@jewelos/core";
import { Button, Field } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { FmsData } from "./api";
import { newerFormVersion } from "./definition";

const humanTypes: readonly FmsStageDefinition["type"][] = ["form", "task", "approval"];
const timingOptions: readonly { value: FmsTimingMethod; label: string; help: string }[] = [
  { value: "completion_date", label: "Completion date", help: "Complete by the selected calendar date." },
  { value: "tat_hours", label: "TAT (hours)", help: "Working target measured from an earlier step." },
  { value: "days_before_date", label: "Days before date", help: "Due a fixed number of days before a future date." },
  { value: "specific_time", label: "Specific clock time", help: "Due on a selected date at a selected time." },
];
/** Route conditions offered on an ordinary step. `default` stays reserved for the fallback. */
const routeOperators: readonly { value: FmsBranchOperator; label: string }[] = [
  { value: "equals", label: "is" },
  { value: "not_equals", label: "is not" },
  { value: "in", label: "is one of" },
  { value: "contains", label: "contains" },
  { value: "not_empty", label: "is answered" },
];
const VALUE_FREE_OPERATORS: ReadonlySet<string> = new Set(["not_empty", "default"]);

const optionCheckboxes = [
  { key: "requiresUpload", label: "Require evidence" },
  { key: "requiresRemark", label: "Require remark" },
  { key: "requiresNextDoerHandoff", label: "Choose next assignee" },
  { key: "canReject", label: "Can reject" },
  { key: "canRequestRevision", label: "Can request revision" },
  { key: "canEscalate", label: "Can escalate" },
] as const;

/** What the inspector can ask the builder to do with a step's questionnaire. */
export type FmsStageQuestionnaireActions = Readonly<{
  canManage: boolean;
  busy: boolean;
  /** Opens the questionnaire editor for this step (new, existing or draft). */
  edit: () => void;
  /** Picks a section of an existing Form to copy into this step's questionnaire. */
  importSection: () => void;
  /** Picks a section of an existing Form to use as-is (pinned version). */
  linkSection: () => void;
  preview: () => void;
  discardDraft: () => void;
}>;

export function FmsStageEditor({ stage, stages, data, onChange, onDelete, assignmentVersion = 1, questionnaire }: { assignmentVersion?: 1 | 2 | undefined; stage: FmsStageDefinition; stages: readonly FmsStageDefinition[]; data: FmsData; onChange: (value: FmsStageDefinition) => void; onDelete: () => void; questionnaire?: FmsStageQuestionnaireActions | undefined }) {
  const update = (patch: Partial<FmsStageDefinition>) => onChange({ ...stage, ...patch });
  const updateSla = (patch: Partial<FmsSlaRule>) => update({ sla: { ...stage.sla, ...patch } });
  const stageIndex = stages.findIndex((item) => item.key === stage.key);
  const firstStage = stageIndex === 0;
  const earlierStages = stages.slice(0, Math.max(0, stageIndex));
  const earlierDecisions = earlierStages.filter((item) => item.sla.decisionMode === "decision" || item.sla.decisionMode === "yes_no");
  const others = stages;
  const human = humanTypes.includes(stage.type);
  const canChooseNext = !["branch", "parallel_start", "end"].includes(stage.type);
  /** A Decision Step from an earlier version keeps its outcomes; new steps are never asked to choose. */
  const decision = stage.sla.decisionMode === "decision" || stage.sla.decisionMode === "yes_no";
  /** Route and assignment questions come from the linked section only; the full list explains removed ones. */
  const formFields = fmsStageFormFields(stage, data.formFields);
  const allFormFields = stage.formTemplateId ? data.formFields[stage.formTemplateId] ?? [] : [];
  const assignmentFields = fmsAssignmentFields(formFields);
  const invalidAssignment = !!stage.sla.assignmentFieldKey && !assignmentFields.some((field) => field.key === stage.sla.assignmentFieldKey);
  const decisionCondition = stage.sla.conditional && "decisionStageKey" in stage.sla.conditional ? stage.sla.conditional : undefined;
  const deadlineOn = stage.sla.deadlineEnabled !== false;
  const assignedName = stage.assigneeRules.find((rule) => rule.type === "specific_user")?.userProfileId;
  const assignedSummary = assignedName ? data.users.find((user) => user.id === assignedName)?.employee_name ?? "Named employee"
    : stage.sla.assignment?.followFormAssignee ? "Assigned To from the previous form" : stage.sla.assignment ? FMS_ASSIGNMENT_LABELS[stage.sla.assignment.mode] : "Workflow default";
  const enabledControls = optionCheckboxes.filter(({ key }) => stage[key]).map(({ label }) => label);

  const changeBranchRule = (index: number, patch: Partial<FmsBranchRule>) => update({ branchRules: stage.branchRules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule).map((rule, order) => ({ ...rule, order })) });
  const moveBranchRule = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= stage.branchRules.length) return;
    const rules = [...stage.branchRules];
    [rules[index], rules[target]] = [rules[target]!, rules[index]!];
    update({ branchRules: rules.map((rule, order) => ({ ...rule, order })) });
  };

  return <div className="space-y-4 pb-8" data-fms-editor>
    <Field label="Step name"><input autoFocus className="field" data-fms-focus="name" maxLength={150} onChange={(event) => update({ name: event.target.value })} placeholder="e.g. Introduction call" value={stage.name} /></Field>

    {human ? <StageQuestions actions={questionnaire} data={data} firstStage={firstStage} stage={stage} update={update} updateSla={updateSla} /> : null}

    {canChooseNext ? <StageRouting key={stage.key} allFields={allFormFields} decision={decision} fields={formFields} others={others} stage={stage} changeRule={changeBranchRule} moveRule={moveBranchRule} update={update} updateSla={updateSla} /> : null}

    {human && fmsStageNeedsAssignment(stages, stage.key) && assignmentVersion === 2 ? <InspectorSection defaultOpen summary={assignedSummary} title="Assigned to">
      <FmsAssignmentEditor stage={stage} stages={stages} data={data} onChange={onChange} />
    </InspectorSection> : null}

    {human ? <InspectorSection summary={taskNamingSummary(stage, firstStage)} title="Task naming">
      <FmsTaskNaming stage={stage} stages={stages} fields={data.formFields} onChange={onChange} />
    </InspectorSection> : null}

    <InspectorSection
      focus="deadline"
      onSwitch={(on) => updateSla({ deadlineEnabled: on })}
      summary={deadlineOn ? timingSummary(stage.sla) : "Off"}
      switchLabel="Set deadline"
      switched={deadlineOn}
      title="When / Deadline"
    >
      <div aria-label="Deadline method" className="grid gap-2 sm:grid-cols-2" role="group">{timingOptions.map((option) => <button aria-pressed={timingMethod(stage.sla) === option.value} className={cn("min-h-11 rounded-xl border p-3 text-left transition", timingMethod(stage.sla) === option.value ? "border-gold bg-gold/10 text-white" : "border-gold/20 text-soft-grey hover:border-gold/60")} key={option.value} onClick={() => updateSla({ timingMethod: option.value })} type="button"><span className="block text-sm font-semibold">{option.label}</span><span className="mt-0.5 block text-xs text-soft-grey">{option.help}</span></button>)}</div>
      <div className="mt-3"><TimingFields earlierStages={earlierStages} sla={stage.sla} updateSla={updateSla} /></div>
    </InspectorSection>

    {human ? <InspectorSection summary={stage.method ? truncate(stage.method, 36) : "None"} title="Instructions">
      <textarea aria-label="How / instructions" className="field min-h-16 md:text-sm" onChange={(event) => update({ method: event.target.value })} placeholder="e.g. Get WhatsApp PO confirmation" value={stage.method ?? ""} />
    </InspectorSection> : null}

    {human ? <InspectorSection summary={stage.checklist.length ? `${stage.checklist.length} item${stage.checklist.length === 1 ? "" : "s"}` : "None"} title="Checklist">
      <ChecklistEditor items={stage.checklist} onChange={(checklist) => update({ checklist })} />
    </InspectorSection> : null}

    {human ? <InspectorSection summary={enabledControls.length ? truncate(enabledControls.join(", "), 36) : "Standard"} title="Completion controls">
      <div className="grid gap-2 text-sm sm:grid-cols-2">{optionCheckboxes.filter(option => assignmentVersion !== 2 || option.key !== "requiresNextDoerHandoff").map(({ key, label }) => <label className="flex min-h-10 items-center gap-2 rounded-lg border border-gold/15 px-2" key={key}><input checked={stage[key]} onChange={(event) => update({ [key]: event.target.checked })} type="checkbox" />{label}</label>)}</div>
    </InspectorSection> : null}

    {!firstStage && human && (earlierDecisions.length || decisionCondition) ? <InspectorSection
      focus="condition"
      onSwitch={(on) => { const target = earlierDecisions.at(-1); updateSla({ conditional: on && target ? { decisionStageKey: target.key, decisionOptionKey: target.sla.decisionOptions?.[0]?.key ?? "" } : undefined }); }}
      summary={decisionCondition ? "On" : "Always runs"}
      switchLabel="Enable conditional step"
      switched={!!decisionCondition}
      title="Run this step only if"
    >
      {decisionCondition ? <div className="grid gap-3 sm:grid-cols-2"><DynamicDecisionCondition condition={decisionCondition} decisions={earlierDecisions} updateSla={updateSla} /></div> : null}
    </InspectorSection> : null}

    {stage.type === "branch" ? <BranchEditor stage={stage} others={others} update={update} changeRule={changeBranchRule} moveRule={moveBranchRule} /> : null}
    {stage.type === "parallel_start" ? <section className="space-y-2" data-fms-focus="parallel"><h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold-secondary">Parallel paths</h4>{others.map((item) => <label className="block rounded-lg border border-gold/15 p-2 text-sm" key={item.key}><input checked={stage.parallelTargetStageKeys.includes(item.key)} onChange={(event) => update({ parallelTargetStageKeys: event.target.checked ? [...stage.parallelTargetStageKeys, item.key] : stage.parallelTargetStageKeys.filter((key) => key !== item.key) })} type="checkbox" /> {item.name}</label>)}</section> : null}
    {stage.type === "parallel_join" ? <section className="space-y-3" data-fms-focus="parallel"><Field label="Join when"><select className="field" onChange={(event) => update({ joinRule: event.target.value as "all" | "any" | "specific" })} value={stage.joinRule ?? "all"}><option value="all">All paths complete</option><option value="any">Any path completes</option><option value="specific">Specific paths complete</option></select></Field>{stage.joinRule === "specific" ? others.map((item) => <label className="block text-sm" key={item.key}><input checked={stage.joinRequiredStageKeys.includes(item.key)} onChange={(event) => update({ joinRequiredStageKeys: event.target.checked ? [...stage.joinRequiredStageKeys, item.key] : stage.joinRequiredStageKeys.filter((key) => key !== item.key) })} type="checkbox" /> {item.name}</label>) : null}</section> : null}

    <InspectorSection summary="Technical details" title="Advanced settings">
      <div className="space-y-3">
        <Field label="Stable key"><input className="field" onChange={(event) => update({ key: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} value={stage.key} /></Field>
        {human && assignmentVersion !== 2 ? <><Field label="User question that assigns later steps"><select aria-invalid={invalidAssignment} className="field" data-fms-focus="assignment" onChange={(event) => updateSla({ assignmentFieldKey: event.target.value || undefined })} value={stage.sla.assignmentFieldKey ?? ""}>
          <option value="">Use workflow default assignees</option>
          {invalidAssignment ? <option disabled value={stage.sla.assignmentFieldKey}>Unavailable question: {stage.sla.assignmentFieldKey}</option> : null}
          {assignmentFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
        </select></Field><p className="text-xs text-soft-grey">A required, always visible User question. Its answer sets the default for later steps.</p></> : null}
      </div>
    </InspectorSection>

    {!firstStage ? <Button onClick={onDelete} type="button" variant="danger"><Trash2 className="size-4" />Delete step</Button> : <p className="rounded-lg border border-gold/20 bg-gold/5 p-3 text-xs text-soft-grey">This Form starts the workflow. It can be reconfigured but not removed.</p>}
  </div>;
}

/**
 * A compact, collapsible inspector section. Open/closed is only presentation:
 * collapsing never changes a stored value. An optional switch is the real
 * setting (for example "Set deadline"); turning it on opens the section.
 */
export function InspectorSection({ title, summary, children, defaultOpen = false, switched, onSwitch, switchLabel, focus }: { title: string; summary?: ReactNode; children: ReactNode; defaultOpen?: boolean; switched?: boolean | undefined; onSwitch?: ((on: boolean) => void) | undefined; switchLabel?: string | undefined; focus?: string | undefined }) {
  const [open, setOpen] = useState(defaultOpen);
  return <details className="group rounded-xl border border-gold/15 open:border-gold/30" onToggle={(event) => setOpen(event.currentTarget.open)} open={open}>
    <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
      <ChevronRight aria-hidden className="size-4 shrink-0 text-soft-grey transition group-open:rotate-90" />
      <span className="text-sm font-semibold text-champagne">{title}</span>
      {summary ? <span className="ml-auto min-w-0 truncate text-xs text-soft-grey">{summary}</span> : <span className="ml-auto" />}
      {onSwitch ? <input aria-label={switchLabel ?? title} checked={!!switched} className="size-5 shrink-0 accent-gold" onChange={(event) => { onSwitch(event.target.checked); if (event.target.checked) setOpen(true); }} onClick={(event) => event.stopPropagation()} role="switch" type="checkbox" /> : null}
    </summary>
    <div className="border-t border-gold/10 px-3 pb-3 pt-3" data-fms-focus={focus}>{switched === false ? <p className="text-xs text-soft-grey">Off. Switch it on to set it up.</p> : children}</div>
  </details>;
}

function taskNamingSummary(stage: FmsStageDefinition, firstStage: boolean): string {
  const naming = stage.sla.taskDisplay?.recordNaming;
  if (!naming) return firstStage ? "Automatic" : "Workflow's record name";
  if (naming.mode === "field") return "From a form answer";
  return naming.mode === "form_default" ? "Form's record-name question" : "Automatic";
}

function timingSummary(sla: FmsSlaRule): string {
  const method = timingMethod(sla);
  if (method === "tat_hours") return sla.tatMinutes ? `TAT ${sla.tatUnit === "minutes" ? `${sla.tatMinutes}m` : `${sla.tatMinutes / 60}h`}` : "TAT not set";
  if (method === "days_before_date") return sla.futureDate ? `${sla.daysBefore ?? 0}d before ${sla.futureDate}` : "Date not set";
  if (method === "specific_time") return sla.dueDate && sla.clockTime ? `${sla.dueDate} ${sla.clockTime}` : "Not set";
  return sla.dueDate || "Date not set";
}

const truncate = (text: string, length: number) => text.length > length ? `${text.slice(0, length - 1)}…` : text;

/**
 * Questions & form: what the doer fills in. A step can build its own
 * questionnaire, copy a section from another Form, link an existing Form (or
 * one of its sections) as-is, or have no questions at all.
 */
function StageQuestions({ stage, data, firstStage, actions, update, updateSla }: { stage: FmsStageDefinition; data: FmsData; firstStage: boolean; actions?: FmsStageQuestionnaireActions | undefined; update: (patch: Partial<FmsStageDefinition>) => void; updateSla: (patch: Partial<FmsSlaRule>) => void }) {
  const [choosing, setChoosing] = useState<"link" | null>(null);
  useEffect(() => setChoosing(null), [stage.key]);
  const form = data.forms.find((item) => item.id === stage.formTemplateId);
  const sectionKey = fmsStageFormSectionKey(stage);
  const section = sectionKey && stage.formTemplateId ? data.formSections?.[stage.formTemplateId]?.find((item) => item.key === sectionKey) : undefined;
  const questionCount = fmsStageFormFields(stage, data.formFields).filter((field) => field.type !== "section_header" && field.type !== "divider").length;
  const draft = !!stage.sla.questionnaire?.draftFormId;
  const owned = stage.sla.questionnaire?.origin === "stage";
  const linked = !!stage.formTemplateId;
  const canManage = actions?.canManage ?? false;
  const busy = actions?.busy ?? false;
  const remove = () => {
    if (stage.branchRules.some((rule) => rule.source === "form_answer") && !window.confirm("Routes on this step use its questions. Remove the questions anyway? Those routes will need a new condition.")) return;
    update({ formTemplateId: undefined, sla: { ...stage.sla, formSectionKey: undefined, questionnaire: undefined, completionFormRequired: undefined } });
  };
  const action = (label: string, Icon: typeof Pencil, onClick: () => void, disabled = false) => <Button className="min-h-9 px-2.5 text-xs" disabled={disabled || busy} onClick={onClick} type="button" variant="secondary"><Icon className="size-4" />{label}</Button>;

  return <section aria-label="Questions & Form" className="space-y-2 rounded-xl border border-gold/25 bg-gold/[0.03] p-3" data-fms-focus="form">
    <div className="flex items-center justify-between gap-2"><h4 className="text-sm font-semibold text-champagne">Questions &amp; Form</h4>{draft ? <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold-secondary">Unpublished changes</span> : null}</div>
    {linked && choosing !== "link" ? <>
      <div className="rounded-lg border border-gold/15 bg-obsidian/40 px-3 py-2">
        <p className="truncate text-sm font-semibold text-white">{form ? form.name : "Unavailable form"}</p>
        <p className="text-xs text-soft-grey">{questionCount} question{questionCount === 1 ? "" : "s"}{section ? ` · ${section.title}` : sectionKey ? " · section unavailable" : ""}{form ? ` · v${form.version}` : ""}{owned ? " · built for this step" : ""}</p>
      </div>
      {!form ? <p className="rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger">This Form is no longer an available published version. Choose another before publishing.</p> : null}
      <NewerVersion data={data} stage={stage} update={update} />
      <div className="flex flex-wrap gap-1.5">
        {canManage ? action(draft ? "Continue editing" : owned ? "Edit" : "Edit a copy", Pencil, () => actions?.edit()) : null}
        {action("Preview", Eye, () => actions?.preview(), !form)}
        <Button className="min-h-9 px-2.5 text-xs" disabled={busy} onClick={() => setChoosing("link")} type="button" variant="ghost">Change source</Button>
        {!firstStage ? <Button className="min-h-9 px-2.5 text-xs" disabled={busy} onClick={remove} type="button" variant="ghost"><X className="size-4" />Remove</Button> : null}
        {draft ? <Button className="min-h-9 px-2.5 text-xs" disabled={busy} onClick={() => actions?.discardDraft()} type="button" variant="ghost">Discard changes</Button> : null}
      </div>
      {!firstStage ? <FormScope data={data} stage={stage} updateSla={updateSla} /> : null}
    </> : <>
      {draft && !linked ? <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gold/25 p-2 text-xs text-champagne">A questionnaire draft is saved for this step.{canManage ? <Button className="min-h-9 px-2.5 text-xs" disabled={busy} onClick={() => actions?.edit()} type="button" variant="secondary"><Pencil className="size-4" />Continue editing</Button> : null}<Button className="min-h-9 px-2.5 text-xs" disabled={busy} onClick={() => actions?.discardDraft()} type="button" variant="ghost">Discard</Button></div> : null}
      <div className="grid grid-cols-2 gap-1.5">
        {canManage ? <ChoiceButton icon={FilePlus2} label="Create questionnaire" onClick={() => actions?.edit()} disabled={busy || draft} /> : null}
        {canManage ? <ChoiceButton icon={Import} label="Import section" onClick={() => actions?.importSection()} disabled={busy} /> : null}
        <ChoiceButton icon={Link2} label="Link existing form" onClick={() => setChoosing("link")} pressed={choosing === "link"} disabled={busy} />
        {!firstStage ? <ChoiceButton label="No questionnaire" onClick={() => { if (linked) remove(); setChoosing(null); }} pressed={!linked && choosing !== "link"} disabled={busy} /> : null}
      </div>
      {choosing === "link" ? <div className="space-y-2">
        <LinkedForm data={data} firstStage={firstStage} stage={stage} update={(patch) => { update({ ...patch, sla: { ...stage.sla, ...(patch.sla ?? {}), questionnaire: undefined } }); setChoosing(null); }} />
        {!firstStage && data.formSections && Object.keys(data.formSections).length ? <Button className="min-h-9 px-2.5 text-xs" onClick={() => actions?.linkSection()} type="button" variant="ghost">Link one section of a form…</Button> : null}
        {linked ? <Button className="min-h-9 px-2.5 text-xs" onClick={() => setChoosing(null)} type="button" variant="ghost">Cancel</Button> : null}
      </div> : null}
      {firstStage && !linked ? <p className="text-xs text-soft-grey">The first step's form collects the workflow's starting details.</p> : null}
    </>}
  </section>;
}

function ChoiceButton({ label, icon: Icon, onClick, pressed, disabled }: { label: string; icon?: typeof Pencil; onClick: () => void; pressed?: boolean; disabled?: boolean }) {
  return <button aria-pressed={pressed} className={cn("flex min-h-11 items-center gap-2 rounded-lg border px-2.5 text-left text-xs font-semibold transition disabled:opacity-50", pressed ? "border-gold bg-gold/10 text-white" : "border-gold/20 text-champagne hover:border-gold/60")} disabled={disabled} onClick={onClick} type="button">{Icon ? <Icon aria-hidden className="size-4 shrink-0 text-gold-secondary" /> : null}{label}</button>;
}

function NewerVersion({ data, stage, update }: { data: FmsData; stage: FmsStageDefinition; update: (patch: Partial<FmsStageDefinition>) => void }) {
  const newer = newerFormVersion(data.forms, stage.formTemplateId);
  if (!newer) return null;
  return <p className="rounded-lg border border-gold/30 bg-gold/5 p-2 text-xs text-champagne">Version {newer.version} is published. <button className="font-semibold text-gold-secondary underline" onClick={() => update({ formTemplateId: newer.id })} type="button">Use v{newer.version}</button>, then check this step's routes.</p>;
}

/**
 * Outgoing routing for an ordinary step. With no rules the step keeps the
 * historical single successor; adding rules turns it into an ordered switch
 * whose fallback stays `defaultNextStageKey`, so published flows are unaffected.
 */
function StageRouting({ stage, others, fields, allFields, decision, update, updateSla, changeRule, moveRule }: { stage: FmsStageDefinition; others: readonly FmsStageDefinition[]; fields: readonly FmsFormFieldRef[]; allFields: readonly FmsFormFieldRef[]; decision: boolean; update: (patch: Partial<FmsStageDefinition>) => void; updateSla: (patch: Partial<FmsSlaRule>) => void; changeRule: (index: number, patch: Partial<FmsBranchRule>) => void; moveRule: (index: number, direction: -1 | 1) => void }) {
  const routed = hasFmsStageRouting(stage);
  const [expandedId, setExpandedId] = useState<string | null>(() => stage.branchRules.at(-1)?.id ?? null);
  const sectionRef = useRef<HTMLElement>(null);
  const addRoute = () => {
    const source = stage.formTemplateId && fields.length ? "form_answer" as const : decision ? "outcome" as const : "context" as const;
    const route: FmsBranchRule = { id: crypto.randomUUID(), source, operator: "equals", ...(source === "form_answer" ? { sourceKey: fields[0]?.key } : {}), value: source === "outcome" ? stage.sla.decisionOptions?.[0]?.key ?? "" : "", order: stage.branchRules.length, nextStageKey: undefined };
    update({ branchRules: [...stage.branchRules, route].map((rule, order) => ({ ...rule, order })) });
    setExpandedId(route.id);
    sectionRef.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  };
  return <section aria-label="Routing" className="relative space-y-2.5 rounded-xl border border-gold/15 p-3" data-fms-focus="routing" ref={sectionRef}>
    <div className="sticky top-0 z-10 flex items-center justify-between gap-2 bg-obsidian py-1"><h4 className="text-sm font-semibold text-champagne">Routing{routed ? <span className="ml-2 text-xs font-normal text-soft-grey">{stage.branchRules.length}</span> : null}</h4><Button aria-label="Add conditional route" className="min-h-11 shrink-0 px-2.5 text-xs" onClick={addRoute} type="button" variant="secondary"><GitBranch className="size-4" />Add condition</Button></div>
    {routed ? <p className="text-xs text-soft-grey">Last added at the top. Checked in number order (1 first); the first match wins.</p> : null}
    {decision ? <DecisionOptions options={stage.sla.decisionOptions ?? [{ key: "yes", label: "Yes" }, { key: "no", label: "No" }]} update={(decisionOptions) => updateSla({ decisionMode: "decision", decisionOptions })} /> : null}
    {stage.branchRules.map((rule, index) => ({ rule, index })).reverse().map(({ rule, index }) => <RouteRow allFields={allFields} decision={decision} fields={fields} index={index} key={rule.id} others={others} rule={rule} stage={stage} expanded={expandedId === rule.id} toggle={() => setExpandedId(expandedId === rule.id ? null : rule.id)} changeRule={changeRule} moveRule={moveRule} remove={() => {
      const remaining = stage.branchRules.filter((_, ruleIndex) => ruleIndex !== index);
      if (expandedId === rule.id) setExpandedId(remaining.at(-1)?.id ?? null);
      update({ branchRules: remaining.map((item, order) => ({ ...item, order })) });
    }} />)}
    <Field label={routed ? "Otherwise go to" : "Next step"}><StageSelect label={routed ? "Otherwise (fallback) go to" : "Continue to"} others={others} value={stage.defaultNextStageKey} onChange={(value) => update({ defaultNextStageKey: value })} /></Field>
    {routed && !hasFmsStageFallback(stage) ? <p className="text-xs text-soft-grey">Optional. If no condition matches, the workflow completes here.</p> : null}
    {routed && !stage.formTemplateId && stage.branchRules.some((rule) => rule.source === "form_answer") ? <p className="rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger">Add questions above so these answers exist.</p> : null}
    {stage.formTemplateId && !fields.length ? <p className="text-xs text-soft-grey">{fmsStageFormSectionKey(stage) ? "No questions in the selected section can route." : "This form has no questions that can route."}</p> : null}
  </section>;
}

function RouteRow({ rule, index, stage, others, fields, allFields, decision, expanded, toggle, changeRule, moveRule, remove }: { rule: FmsBranchRule; index: number; stage: FmsStageDefinition; others: readonly FmsStageDefinition[]; fields: readonly FmsFormFieldRef[]; allFields: readonly FmsFormFieldRef[]; decision: boolean; expanded: boolean; toggle: () => void; changeRule: (index: number, patch: Partial<FmsBranchRule>) => void; moveRule: (index: number, direction: -1 | 1) => void; remove: () => void }) {
  const field = rule.source === "form_answer" ? fields.find((item) => item.key === rule.sourceKey) : undefined;
  /** A saved question outside the section stays selected and flagged until the author picks another. */
  const outside = rule.source === "form_answer" && !field ? allFields.find((item) => item.key === rule.sourceKey) : undefined;
  const options = rule.source === "outcome" ? (stage.sla.decisionOptions ?? []).map((option) => ({ value: option.key, label: option.label })) : fmsFieldOptions(field);
  const selected = Array.isArray(rule.value) ? rule.value.map(String) : [String(rule.value ?? "")].filter(Boolean);
  const question = field?.label ?? (outside ? `${outside.label} (not in this section)` : rule.sourceKey ? `${rule.sourceKey}${rule.source === "form_answer" ? " (removed)" : ""}` : rule.source === "outcome" ? "Outcome" : "Choose a field");
  const answer = selected.map((value) => options.find((option) => option.value === value)?.label ?? `${value}${options.length ? " (removed)" : ""}`).join(", ");
  const condition = `${question} ${routeOperators.find((operator) => operator.value === rule.operator)?.label ?? rule.operator}${VALUE_FREE_OPERATORS.has(rule.operator) ? "" : ` ${answer || "Choose an answer"}`}`;
  const destination = rule.nextFlowId ? "Linked workflow" : rule.nextStageKey ? others.find((item) => item.key === rule.nextStageKey)?.name ?? `${rule.nextStageKey} (unavailable)` : "Complete workflow here";
  const panelId = `route-editor-${stage.key}-${rule.id}`;
  // Native details also lets the canvas/validation revealControl open the exact
  // route around a field. Keep fields mounted so those existing selectors work.
  return <details className={cn("min-w-0 rounded-lg border bg-white/[0.02]", expanded ? "border-gold/40" : "border-gold/20")} data-route-id={rule.id} onToggle={(event) => { if (event.currentTarget.open !== expanded) toggle(); }} open={expanded}>
    <summary className="flex list-none flex-wrap items-center gap-0.5 p-1 [&::-webkit-details-marker]:hidden">
      <button aria-controls={panelId} aria-expanded={expanded} aria-label={`Edit route ${index + 1}`} className="flex min-h-11 min-w-0 flex-1 items-start gap-2 rounded-md px-1.5 py-2 text-left hover:bg-gold/5 focus-visible:outline-gold" onClick={(event) => { event.preventDefault(); toggle(); }} type="button">
        <ChevronRight aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-soft-grey", expanded && "rotate-90")} />
        <span className="shrink-0 rounded-full bg-gold/10 px-1.5 py-0.5 text-[10px] font-semibold text-gold-secondary">If {index + 1}</span>
        <span className="min-w-0 flex-1"><span className="line-clamp-2 break-words text-xs font-semibold text-champagne" title={condition}>{rule.label ? `${rule.label} · ${condition}` : condition}</span><span className="block truncate text-xs text-soft-grey" title={destination}>→ {destination}</span></span>
      </button>
    </summary>
    <div className="space-y-2 border-t border-gold/15 p-2.5" id={panelId}>
      <div className="flex min-w-0 items-center gap-1">
      <input aria-label={`Route ${index + 1} label`} className="field min-h-9 min-w-0 flex-1 py-1 md:text-xs" maxLength={60} onChange={(event) => changeRule(index, { label: event.target.value })} placeholder="Name on the canvas (optional)" value={rule.label ?? ""} />
      <span className="flex shrink-0 items-center">
        <button aria-label={`Move route ${index + 1} up`} className="flex size-11 items-center justify-center rounded text-soft-grey hover:text-gold-secondary disabled:opacity-40 sm:size-9" disabled={index === stage.branchRules.length - 1} onClick={(event) => { event.preventDefault(); moveRule(index, 1); }} title="Move up · check later" type="button"><ArrowUp className="size-4" /></button>
        <button aria-label={`Move route ${index + 1} down`} className="flex size-11 items-center justify-center rounded text-soft-grey hover:text-gold-secondary disabled:opacity-40 sm:size-9" disabled={index === 0} onClick={(event) => { event.preventDefault(); moveRule(index, -1); }} title="Move down · check earlier" type="button"><ArrowDown className="size-4" /></button>
        <button aria-label={`Delete route ${index + 1}`} className="flex size-11 items-center justify-center rounded text-soft-grey hover:text-danger sm:size-9" onClick={(event) => { event.preventDefault(); remove(); }} title="Delete condition" type="button"><Trash2 className="size-4" /></button>
      </span>
      </div>
    <label className="block"><span className="label">Then go to</span><StageSelect label={`Route ${index + 1} then go to`} others={others} value={rule.nextStageKey} onChange={(value) => changeRule(index, { nextStageKey: value, nextFlowId: undefined })} /></label>
    <div className="grid gap-2 sm:grid-cols-2">
      {rule.source === "form_answer" ? <label className="block"><span className="label">Question</span><select aria-label={`Route ${index + 1} question`} className="field" onChange={(event) => changeRule(index, { sourceKey: event.target.value, value: "" })} value={rule.sourceKey ?? ""}><option value="">Select a question</option>{fields.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}{rule.sourceKey && !fields.some((item) => item.key === rule.sourceKey) ? <option value={rule.sourceKey}>{outside ? `${outside.label} (not in this section)` : `${rule.sourceKey} (removed)`}</option> : null}</select></label>
        : rule.source === "context" ? <label className="block"><span className="label">Process data field</span><input aria-label={`Route ${index + 1} field key`} className="field" onChange={(event) => changeRule(index, { sourceKey: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} placeholder="e.g. status" value={rule.sourceKey ?? ""} /></label>
        : <p className="self-end text-xs text-soft-grey">The outcome chosen on this step.</p>}
      <label className="block"><span className="label">Condition</span><select aria-label={`Route ${index + 1} condition`} className="field" onChange={(event) => changeRule(index, { operator: event.target.value as FmsBranchOperator, value: event.target.value === "in" ? [] : "" })} value={rule.operator}>{routeOperators.map((operator) => <option key={operator.value} value={operator.value}>{operator.label}</option>)}</select></label>
      {VALUE_FREE_OPERATORS.has(rule.operator) ? null
        : options.length && rule.source === "form_answer" && (rule.operator === "equals" || rule.operator === "in") ? (
          <fieldset aria-label={`Route ${index + 1} answer`} className="min-w-0 space-y-1 sm:col-span-2">
            <legend className="label">Answer</legend>
            <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-lg border border-gold/20 p-1.5">
              {[...options, ...selected.filter((value) => !options.some((option) => option.value === value)).map((value) => ({ value, label: `${value} (removed)` }))].map((option) => (
                <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm" key={option.value}>
                  <input checked={selected.includes(option.value)} onChange={(event) => changeRule(index, fmsRouteAnswerSelection(rule.operator === "in" ? "in" : "equals", event.target.checked ? [...selected, option.value] : selected.filter((value) => value !== option.value)))} type="checkbox" />
                  <span className="min-w-0 break-words">{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )
        : options.length ? <label className="block"><span className="label">Answer</span><select aria-label={`Route ${index + 1} answer`} className="field" multiple={rule.operator === "in"} onChange={(event) => changeRule(index, { value: rule.operator === "in" ? [...event.target.selectedOptions].map((option) => option.value) : event.target.value })} value={rule.operator === "in" ? selected : selected[0] ?? ""}>{rule.operator === "in" ? null : <option value="">Select an answer</option>}{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}{selected.filter((value) => !options.some((option) => option.value === value)).map((value) => <option key={value} value={value}>{value} (removed)</option>)}</select></label>
        : <label className="block"><span className="label">Answer</span><input aria-label={`Route ${index + 1} answer`} className="field" onChange={(event) => changeRule(index, { value: rule.operator === "in" ? event.target.value.split(",").map((item) => item.trim()).filter(Boolean) : event.target.value })} placeholder={rule.operator === "in" ? "value_a, value_b" : "Expected value"} value={selected.join(", ")} /></label>}
    </div>
    <details className="text-xs"><summary className="cursor-pointer text-soft-grey">More</summary><label className="mt-2 block"><span className="label">Based on</span><select aria-label={`Route ${index + 1} source`} className="field" onChange={(event) => { const source = event.target.value as FmsBranchRule["source"]; changeRule(index, { source, sourceKey: source === "form_answer" ? fields[0]?.key : source === "outcome" ? undefined : rule.sourceKey, value: "" }); }} value={rule.source}>
      <option disabled={!fields.length} value="form_answer">An answer to this step's questions</option>
      <option disabled={!decision} value="outcome">The outcome chosen (earlier version)</option>
      <option value="context">A process data field</option>
    </select></label></details>
    </div>
  </details>;
}

function ChecklistEditor({ items, onChange }: { items: readonly FmsChecklistItemDefinition[]; onChange: (items: readonly FmsChecklistItemDefinition[]) => void }) {
  const add = () => { let index = items.length + 1; while (items.some((item) => item.key === `item_${index}`)) index += 1; onChange([...items, { key: `item_${index}`, label: "", required: true }]); };
  return <div className="space-y-2">
    {items.map((item, index) => <div className="flex items-center gap-1.5" key={item.key}>
      <input aria-label={`Checklist item ${index + 1}`} className="field min-h-10 flex-1" maxLength={300} onChange={(event) => onChange(items.map((entry, position) => position === index ? { ...entry, label: event.target.value } : entry))} placeholder="What must be checked" value={item.label} />
      <label className="flex items-center gap-1 text-xs text-soft-grey" title="Required"><input checked={item.required} onChange={(event) => onChange(items.map((entry, position) => position === index ? { ...entry, required: event.target.checked } : entry))} type="checkbox" />Req.</label>
      <button aria-label={`Remove checklist item ${index + 1}`} className="rounded p-1 text-soft-grey hover:text-danger" onClick={() => onChange(items.filter((_, position) => position !== index))} type="button"><Trash2 className="size-4" /></button>
    </div>)}
    <Button className="min-h-9 px-2.5 text-xs" onClick={add} type="button" variant="secondary"><Plus className="size-4" />Add item</Button>
  </div>;
}

function TimingFields({ sla, earlierStages, updateSla }: { sla: FmsSlaRule; earlierStages: readonly FmsStageDefinition[]; updateSla: (patch: Partial<FmsSlaRule>) => void }) {
  if (sla.deadlineEnabled === false) return <p className="text-xs text-soft-grey">No deadline will be created for this step.</p>;
  const method = timingMethod(sla);
  if (method === "tat_hours") { const unit = sla.tatUnit ?? "hours"; const display = sla.tatMinutes === undefined ? sla.tatHours ?? "" : unit === "hours" ? sla.tatMinutes / 60 : sla.tatMinutes; return <div className="grid gap-3 sm:grid-cols-3"><Field label="TAT"><input aria-label="TAT value" className="field" min="1" onChange={(event) => { const value = event.target.value ? Number(event.target.value) : undefined; updateSla({ tatMinutes: value === undefined ? undefined : Math.round(unit === "hours" ? value * 60 : value), tatHours: undefined }); }} step={unit === "hours" ? "0.25" : "1"} type="number" value={display} /></Field><Field label="Unit"><select aria-label="TAT unit" className="field" onChange={(event) => { const next = event.target.value as "hours" | "minutes"; const minutes = sla.tatMinutes ?? (sla.tatHours ?? 0) * 60; updateSla({ tatUnit: next, tatMinutes: minutes || undefined, tatHours: undefined }); }} value={unit}><option value="hours">Hours</option><option value="minutes">Minutes</option></select></Field><Field label="Counted from"><select className="field" data-fms-focus="trigger" onChange={(event) => updateSla({ triggerStageKey: event.target.value || undefined })} value={sla.triggerStageKey ?? ""}><option value="">Previous step finishing</option>{earlierStages.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></Field></div>; }
  if (method === "days_before_date") return <div className="grid gap-3 sm:grid-cols-2"><Field label="Future date"><input className="field" min={localCalendarDate()} onChange={(event) => updateSla({ futureDate: event.target.value })} type="date" value={sla.futureDate ?? ""} /></Field><Field label="Days before"><input className="field" min="0" onChange={(event) => updateSla({ daysBefore: event.target.value ? Number(event.target.value) : undefined })} step="1" type="number" value={sla.daysBefore ?? ""} /></Field></div>;
  if (method === "specific_time") return <div className="grid gap-3 sm:grid-cols-2"><Field label="Date"><input className="field" min={localCalendarDate()} onChange={(event) => updateSla({ dueDate: event.target.value })} type="date" value={sla.dueDate ?? ""} /></Field><Field label="Clock time"><input className="field" onChange={(event) => updateSla({ clockTime: event.target.value })} type="time" value={sla.clockTime ?? ""} /></Field></div>;
  return <Field label="Due date"><input className="field" min={localCalendarDate()} onChange={(event) => updateSla({ dueDate: event.target.value })} required type="date" value={sla.dueDate ?? ""} /></Field>;
}

function LinkedForm({ data, firstStage, stage, update }: { data: FmsData; firstStage: boolean; stage: FmsStageDefinition; update: (patch: Partial<FmsStageDefinition>) => void }) {
  const pinned = data.forms.find((form) => form.id === stage.formTemplateId);
  const missing = !!stage.formTemplateId && !pinned;
  const options = <>{data.forms.map((form) => <option key={form.id} value={form.id}>{form.name} · v{form.version}{form.lifecycle === "published" ? "" : " (pinned)"}</option>)}{missing ? <option value={stage.formTemplateId}>Unavailable form (removed or unpublished)</option> : null}</>;
  if (firstStage) return <select aria-label="Initial details form" className="field" data-fms-focus="form" onChange={(event) => update({ formTemplateId: event.target.value || undefined })} value={stage.formTemplateId ?? ""}><option value="">Select the initial Form</option>{options}</select>;
  return <select aria-label="Linked form" className="field" data-fms-focus="form" onChange={(event) => update({ formTemplateId: event.target.value || undefined, sla: { ...stage.sla, formSectionKey: undefined } })} value={stage.formTemplateId ?? ""}><option value="">Choose a published form</option>{options}</select>;
}

/**
 * Entire Form keeps the historical behaviour. Specific Section stores the stable
 * section key, so the doer answers only that section and its routes use only
 * its questions. A saved key the current version lacks stays visible and
 * flagged until the author chooses again.
 */
function FormScope({ data, stage, updateSla }: { data: FmsData; stage: FmsStageDefinition; updateSla: (patch: Partial<FmsSlaRule>) => void }) {
  if (!stage.formTemplateId) return null;
  const sections = data.formSections?.[stage.formTemplateId] ?? [];
  const sectionKey = fmsStageFormSectionKey(stage);
  if (sections.length < 2 && !sectionKey) return null;
  const known = sections.find((section) => section.key === sectionKey);
  return <div className="space-y-1.5" data-fms-focus="section">
    <label className="block"><span className="label">The doer answers</span><select aria-invalid={!!sectionKey && !known} aria-label="Form section" className="field" onChange={(event) => updateSla({ formSectionKey: event.target.value || undefined })} value={sectionKey ?? ""}>
      <option value="">Entire Form</option>
      {sectionKey && !known ? <option value={sectionKey}>Unavailable section (not in this Form version)</option> : null}
      {sections.map((section) => <option key={section.key} value={section.key}>Only {section.title} · {section.questionCount} question{section.questionCount === 1 ? "" : "s"}</option>)}
    </select></label>
    {sectionKey && !known ? <p className="rounded-lg border border-danger/40 bg-danger/5 p-2 text-xs text-danger">This section is not in the linked Form version. Choose another section, or Entire Form.</p> : null}
  </div>;
}

function BranchEditor({ stage, others, update, changeRule, moveRule }: { stage: FmsStageDefinition; others: readonly FmsStageDefinition[]; update: (patch: Partial<FmsStageDefinition>) => void; changeRule: (index: number, patch: Partial<FmsBranchRule>) => void; moveRule: (index: number, direction: -1 | 1) => void }) {
  return <section className="space-y-3 border-t border-gold/15 pt-4" data-fms-focus="branch"><div><h4 className="text-xs font-semibold uppercase tracking-[0.15em] text-gold-secondary">Ordered decision routes</h4><p className="mt-1 text-xs text-soft-grey">Routes run top to bottom. Keep one Otherwise route last.</p></div>{stage.branchRules.map((rule, index) => <article className="space-y-2 rounded-xl border border-gold/20 p-3" data-route-id={rule.id} key={rule.id}><div className="flex items-center gap-2"><input className="field" onChange={(event) => changeRule(index, { label: event.target.value })} placeholder={`Route ${index + 1} label`} value={rule.label ?? ""} /><button aria-label="Move route up" disabled={index === 0} onClick={() => moveRule(index, -1)} type="button"><ArrowUp className="size-4" /></button><button aria-label="Move route down" disabled={index === stage.branchRules.length - 1} onClick={() => moveRule(index, 1)} type="button"><ArrowDown className="size-4" /></button><button aria-label="Delete route" disabled={stage.branchRules.length === 1} onClick={() => update({ branchRules: stage.branchRules.filter((_, ruleIndex) => ruleIndex !== index).map((item, order) => ({ ...item, order })) })} type="button"><Trash2 className="size-4 text-danger" /></button></div><div className="grid gap-2 sm:grid-cols-2"><select className="field" onChange={(event) => changeRule(index, { source: event.target.value as FmsBranchRule["source"] })} value={rule.source}><option value="outcome">Previous outcome</option><option value="context">Process data</option><option value="form_answer">Form answer</option></select><input className="field" disabled={rule.source === "outcome"} onChange={(event) => changeRule(index, { sourceKey: event.target.value })} placeholder="Question key" value={rule.sourceKey ?? ""} /><select className="field" onChange={(event) => changeRule(index, { operator: event.target.value as FmsBranchRule["operator"] })} value={rule.operator}>{FMS_BRANCH_OPERATORS.map((operator) => <option key={operator} value={operator}>{operator === "default" ? "Otherwise" : operator.replaceAll("_", " ")}</option>)}</select><input className="field" disabled={["default", "not_empty"].includes(rule.operator)} onChange={(event) => changeRule(index, { value: event.target.value })} placeholder="Expected value" value={String(rule.value ?? "")} /></div><StageSelect others={others} value={rule.nextStageKey} onChange={(value) => changeRule(index, { nextStageKey: value, nextFlowId: undefined })} /></article>)}<Button onClick={() => { const route: FmsBranchRule = { id: crypto.randomUUID(), source: "outcome", operator: "equals", value: "", order: Math.max(0, stage.branchRules.length - 1), label: "New route" }; update({ branchRules: [...stage.branchRules.filter((rule) => rule.operator !== "default"), route, ...stage.branchRules.filter((rule) => rule.operator === "default")].map((rule, order) => ({ ...rule, order })) }); }} type="button" variant="secondary"><Plus className="size-4" />Add route</Button></section>;
}

function timingMethod(sla: FmsSlaRule): FmsTimingMethod { return sla.timingMethod ?? "completion_date"; }
function StageSelect({ others, value, label, onChange }: { others: readonly FmsStageDefinition[]; value?: string | undefined; label?: string | undefined; onChange: (value: string | undefined) => void }) { return <select aria-label={label} className="field" onChange={(event) => onChange(event.target.value || undefined)} value={value ?? ""}><option value="">Complete workflow here</option>{others.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select>; }
function localCalendarDate(now = new Date()): string { const year = now.getFullYear(); const month = String(now.getMonth() + 1).padStart(2, "0"); const day = String(now.getDate()).padStart(2, "0"); return `${year}-${month}-${day}`; }

/** Outcomes of a Decision Step authored before decisions became questionnaire routes. Kept exactly, so old routes still match. */
function DecisionOptions({ options, update }: { options: readonly { key: string; label: string }[]; update: (options: readonly { key: string; label: string }[]) => void }) {
  const move = (index: number, direction: -1 | 1) => { const target = index + direction; if (target < 0 || target >= options.length) return; const next = [...options]; [next[index], next[target]] = [next[target]!, next[index]!]; update(next); };
  return <details className="rounded-lg border border-gold/15 p-2" data-fms-focus="decision"><summary className="cursor-pointer text-xs font-semibold text-champagne">Outcome choices <span className="font-normal text-soft-grey">· from an earlier version of this step</span></summary><div className="mt-2 space-y-2"><p className="text-xs text-soft-grey">The doer picks one of these when finishing. Routes below can use them. Renaming keeps existing routes working.</p>{options.map((option, index) => <div className="flex gap-1" key={option.key}><input aria-label={`Decision option ${index + 1}`} className="field min-h-9" onChange={(event) => update(options.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} value={option.label} /><button aria-label="Move decision option up" disabled={index === 0} onClick={() => move(index, -1)} type="button"><ArrowUp className="size-4" /></button><button aria-label="Move decision option down" disabled={index === options.length - 1} onClick={() => move(index, 1)} type="button"><ArrowDown className="size-4" /></button><button aria-label="Delete decision option" disabled={options.length <= 2} onClick={() => update(options.filter((_, itemIndex) => itemIndex !== index))} type="button"><Trash2 className="size-4 text-danger" /></button></div>)}<Button className="min-h-9 px-2.5 text-xs" onClick={() => { let index = options.length + 1; let key = `option_${index}`; while (options.some((option) => option.key === key)) key = `option_${++index}`; update([...options, { key, label: "New option" }]); }} type="button" variant="secondary"><Plus className="size-4" />Add outcome</Button></div></details>;
}

function DynamicDecisionCondition({ condition, decisions, updateSla }: { condition: Extract<FmsSlaRule["conditional"], { decisionStageKey: string }>; decisions: readonly FmsStageDefinition[]; updateSla: (patch: Partial<FmsSlaRule>) => void }) {
  const selected = decisions.find((item) => item.key === condition.decisionStageKey) ?? decisions[0];
  const optionKey = "decisionOptionKey" in condition ? condition.decisionOptionKey : condition.outcome;
  return <><Field label="Earlier step"><select aria-label="Earlier decision" className="field" onChange={(event) => { const next = decisions.find((item) => item.key === event.target.value); updateSla({ conditional: { decisionStageKey: event.target.value, decisionOptionKey: next?.sla.decisionOptions?.[0]?.key ?? "" } }); }} value={selected?.key ?? ""}>{decisions.map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></Field><Field label="Chose"><select aria-label="Run when answer is" className="field" onChange={(event) => updateSla({ conditional: { decisionStageKey: selected?.key ?? "", decisionOptionKey: event.target.value } })} value={optionKey}>{selected?.sla.decisionOptions?.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></Field></>;
}
