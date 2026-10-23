import { upgradeFmsAssignmentContract } from "@jewelos/core";
import { FmsSimulation } from "./FmsSimulation";
import { FmsFormActions, FmsFormAuthoring } from "./FmsFormAuthoring";
import { prepareFmsFormAuthoring, type FmsFormAuthoringAction, type FmsFormAuthoringTarget } from "@jewelos/data/fms/formAuthoring";
import { suggestFmsAssignment } from "@jewelos/core";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, FileText, FlaskConical, ListOrdered, Network, PanelLeftOpen, Plus, Redo2, Save, Send, Sparkles, TestTube2, Undo2, UserRoundPlus, X } from "lucide-react";
import { copyFirstFmsAssigneeToHumanStages, fmsStageFormFields, normalizeFmsDefinition, validateFmsDefinition, type FmsDiagnosticFinding, type FmsFlowDefinition, type FmsStageDefinition } from "@jewelos/core";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { AssigneePicker } from "@/components/assignees/AssigneePicker";
import type { FmsData, FmsFlowRow } from "./api";
import { publishFmsFlow, saveFmsContextAssigneeDefault, saveFmsDraft } from "./api";
import { flowToDefinition, newFmsStage, removeFmsStage } from "./definition";
import { FmsGraphCanvas } from "./FmsGraphCanvas";
import { FmsStageEditor } from "./FmsStageEditor";
import { fmsDepartmentLabel } from "./departments";
import { FmsStepList } from "./FmsStepList";
import { useIsMobile } from "@/lib/useMediaQuery";
import { useFillViewportHeight } from "@/lib/useFillViewportHeight";
import { cn } from "@/lib/utils";
import { FmsAiPanel, type FmsAiTab } from "./ai/FmsAiPanel";
import type { FmsAiSettings } from "./ai/api";
import type { FmsAiRunCandidate } from "./ai/FmsAiRun";

function issueControlSelector(code: string, message: string): string {
  if (code === "invalid_assignment_field") return '[data-fms-focus="assignment"]';
  if (["missing_form", "invalid_form", "missing_linked_form", "route_without_form", "section_without_form"].includes(code)) return '[data-fms-focus="form"]';
  if (["section_on_trigger", "missing_form_section", "empty_form_section", "external_section_dependency"].includes(code)) return '[data-fms-focus="section"] select, [data-fms-focus="section"] button';
  if (["invalid_decision", "route_without_decision"].includes(code)) return '[data-fms-focus="decision"]';
  const routeNumber = /^"?Route (\d+)/.exec(message)?.[1];
  if (code === "unsupported_cycle") {
    if (routeNumber) return `[aria-label="Route ${routeNumber} then go to"]`;
    if (message.startsWith("Otherwise")) return '[aria-label="Otherwise (fallback) go to"]';
    if (message.startsWith("Parallel")) return '[data-fms-focus="parallel"] input';
    return '[aria-label="Continue to"]';
  }
  if (routeNumber) {
    if (code === "invalid_route_source") return `[aria-label="Route ${routeNumber} field key"], [aria-label="Route ${routeNumber} question"]`;
    const part = ["route_without_destination", "invalid_route_target"].includes(code) ? "then go to"
      : ["route_field_missing", "route_field_outside_section"].includes(code) ? "question"
      : ["invalid_route_value", "route_value_missing"].includes(code) ? "answer"
      : ["invalid_route_operator"].includes(code) ? "condition" : "source";
    return `[aria-label="Route ${routeNumber} ${part}"]`;
  }
  if (code === "invalid_deadline") return '[data-fms-focus="deadline"] input';
  if (code === "invalid_deadline_trigger") return '[data-fms-focus="trigger"]';
  if (["invalid_stage", "invalid_stage_key"].includes(code)) return '[data-fms-focus="name"]';
  if (["invalid_conditional"].includes(code)) return '[data-fms-focus="condition"] input, [data-fms-focus="condition"] select';
  if (["invalid_parallel", "invalid_join"].includes(code)) return '[data-fms-focus="parallel"] input, [data-fms-focus="parallel"] select';
  if (["invalid_branch"].includes(code)) return '[data-fms-focus="branch"] input, [data-fms-focus="branch"] select';
  if (code === "missing_completion_path") return '[data-fms-focus="routing"] select, [data-fms-focus="branch"] select, [data-fms-focus="parallel"] input';
  if (["route_without_fallback", "conflicting_fallback_route"].includes(code)) return '[aria-label="Otherwise (fallback) go to"]';
  if (code === "invalid_assignee") return '[data-fms-focus="name"]';
  return '[data-fms-focus="routing"] input, [data-fms-focus="routing"] select, [data-fms-focus="routing"] button';
}

/** Optional FMS assistant wiring. Without it (or with every switch off) the builder is unchanged. */
export type FmsBuilderAiOptions = Readonly<{ settings: FmsAiSettings; startWithAi?: boolean | undefined; published?: FmsFlowDefinition | null | undefined; runCandidates?: readonly FmsAiRunCandidate[] | undefined }>;

export function FmsFlowBuilder({ flow, data, duplicate, onClose, onSaved, canManageForms = false, ai }: { flow: FmsFlowRow | null; data: FmsData; duplicate?: boolean; onClose: () => void; onSaved: () => Promise<void>; canManageForms?: boolean; ai?: FmsBuilderAiOptions | undefined }) {
  const initial = useMemo(() => { const value = flowToDefinition(flow, data); return duplicate ? { ...value, id: undefined, familyId: undefined, version: 1, lifecycle: "draft" as const, name: `${value.name} (Copy)` } : value; }, [data, duplicate, flow]);
  const [definition, setDefinition] = useState<FmsFlowDefinition>(initial);
  const [formAuthoring, setFormAuthoring] = useState<FmsFormAuthoringTarget | null>(null);
  const [past, setPast] = useState<FmsFlowDefinition[]>([]);
  const [future, setFuture] = useState<FmsFlowDefinition[]>([]);
  const aiAvailable = !!ai && (ai.settings.debuggerEnabled || ai.settings.builderEnabled);
  const startWithAi = !flow && !!ai?.startWithAi && ai.settings.builderEnabled;
  const [screen, setScreen] = useState<"details" | "canvas">(flow || startWithAi ? "canvas" : "details");
  const [aiOpen, setAiOpen] = useState<FmsAiTab | null>(startWithAi ? "build" : null);
  const isPhone = useIsMobile();
  /** Nothing is selected on entry, so neither the phone sheet nor the desktop inspector covers the workflow. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  /** Desktop opens on the canvas; phones open on the step list. Both views stay available everywhere. */
  const [phoneView, setPhoneView] = useState<"steps" | "map">(isPhone ? "steps" : "map");
  /** The desktop Workflow tools drawer starts closed; its rail toggle stays visible. */
  const [toolsOpen, setToolsOpen] = useState(false);
  const toolsButtonRef = useRef<HTMLButtonElement>(null);
  /**
   * One right-side panel at a time. Selecting a step shows its inspector; the
   * assistant stays mounted (keeping its conversation) and returns when the
   * inspector closes or the assistant button is pressed again.
   */
  const [rightPanel, setRightPanel] = useState<"inspector" | "ai">(startWithAi ? "ai" : "inspector");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ key: string; id: number } | null>(null);
  const [focusedIssue, setFocusedIssue] = useState<{ code: string; message: string; id: number } | null>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const [persistedId, setPersistedId] = useState(flow?.id ?? null);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(normalizeFmsDefinition(initial)));
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [simulating, setSimulating] = useState(false);

  const normalized = useMemo(() => normalizeFmsDefinition(definition), [definition]);
  const issues = useMemo(() => validateFmsDefinition(normalized, { formFields: data.formFields, formSections: data.formSections, availableFormIds: data.forms.map((form) => form.id) }), [data.formFields, data.formSections, data.forms, normalized]);
  const invalidKeys = useMemo(() => new Set(issues.flatMap((issue) => issue.stageKey ? [issue.stageKey] : [])), [issues]);
  const selected = normalized.stages.find((stage) => stage.key === selectedKey) ?? null;
  const dirty = JSON.stringify(normalized) !== savedSnapshot;
  const assignableStages = normalized.stages.filter((stage) => ["form", "task", "approval"].includes(stage.type));
  const assignedStages = assignableStages.filter((stage) => stage.assigneeRules.some((rule) => rule.type === "specific_user" && rule.userProfileId));
  const selectStage = (key: string | null) => { setFocusedIssue(null); setSelectedKey(key); if (key) setRightPanel("inspector"); };
  const openIssue = (issue: (typeof issues)[number]) => {
    const stageKey = issue.stageKey;
    if (!stageKey) {
      if (issue.code === "invalid_name" || issue.code === "invalid_scope") setScreen("details");
      else setPhoneView("map");
      setIssuesOpen(false);
      return;
    }
    setSelectedKey(stageKey); setRightPanel("inspector");
    setFocusRequest((current) => ({ key: stageKey, id: (current?.id ?? 0) + 1 }));
    setFocusedIssue((current) => ({ code: issue.code, message: issue.message, id: (current?.id ?? 0) + 1 }));
    setIssuesOpen(false);
  };
  const issueLabel = (issue: (typeof issues)[number]) => {
    const stage = normalized.stages.find((item) => item.key === issue.stageKey);
    return stage ? `${stage.name || "Untitled step"}: ${issue.message}` : issue.message;
  };
  /** Scope and workflow context are no longer asked for; existing values are preserved untouched. */
  const scopeSummary = normalized.scope === "branch" ? data.branches.find((branch) => branch.id === normalized.branchId)?.name ?? "one branch"
    : normalized.scope === "department" ? fmsDepartmentLabel(data.departments.find((department) => department.id === normalized.departmentId) ?? { id: "", branch_id: null, name: "one department" }, data.branches)
    : null;
  const contextDefaultAssigneeId = normalized.moduleContext ? data.contextDefaults?.find((item) => item.module_context === normalized.moduleContext)?.user_profile_id : undefined;

  const workspaceHeight = useFillViewportHeight(workspaceRef, !isPhone && screen === "canvas" && !formAuthoring);
  useEffect(() => {
    if (!toolsOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setToolsOpen(false); toolsButtonRef.current?.focus(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [toolsOpen]);
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  useEffect(() => {
    if (!focusedIssue || !selected) return;
    const selector = issueControlSelector(focusedIssue.code, focusedIssue.message);
    const control = inspectorRef.current?.querySelector<HTMLElement>(selector) ?? inspectorRef.current?.querySelector<HTMLElement>("[data-fms-editor] input, [data-fms-editor] select, [data-fms-editor] button");
    if (!control) return;
    let disclosure = control.closest("details");
    while (disclosure) { disclosure.open = true; disclosure = disclosure.parentElement?.closest("details") ?? null; }
    control.scrollIntoView?.({ block: "center", behavior: "smooth" });
    control.focus({ preventScroll: true });
    control.classList.add("ring-2", "ring-danger", "ring-offset-2", "ring-offset-obsidian");
    return () => control.classList.remove("ring-2", "ring-danger", "ring-offset-2", "ring-offset-obsidian");
  }, [focusedIssue, selected?.key]);

  const commit = (next: FmsFlowDefinition | ((current: FmsFlowDefinition) => FmsFlowDefinition)) => {
    setDefinition((current) => { const value = typeof next === "function" ? next(current) : next; setPast((items) => [...items.slice(-49), current]); setFuture([]); return value; });
    setSuccess(null);
  };
  const undo = () => { const previous = past.at(-1); if (!previous) return; setFuture((items) => [definition, ...items]); setPast((items) => items.slice(0, -1)); setDefinition(previous); };
  const redo = () => { const next = future[0]; if (!next) return; setPast((items) => [...items, definition]); setFuture((items) => items.slice(1)); setDefinition(next); };
  const nextKey = () => { let index = normalized.stages.length + 1; while (normalized.stages.some((stage) => stage.key === `stage_${index}`)) index += 1; return `stage_${index}`; };
  const add = (type: FmsStageDefinition["type"], after?: string) => {
    if (!normalized.stages.length && type !== "form") { setError("Every workflow starts with a Form. Add the Form trigger first."); return; }
    const stage = {
      ...newFmsStage(type, normalized.stages.length),
      key: nextKey(),
      name: type === "form" && normalized.stages.length === 0 ? "Start form" : type === "task" ? "Step" : newFmsStage(type, 0).name,
      assigneeRules: ["form", "task", "approval"].includes(type) && contextDefaultAssigneeId ? [{ type: "specific_user" as const, userProfileId: contextDefaultAssigneeId }] : [],
    };
    const sourceKey = after ?? (selected && !["branch", "parallel_start", "end"].includes(selected.type) ? selected.key : undefined);
    commit((current) => {
      const currentStages = normalizeFmsDefinition(current).stages;
      const sourceIndex = sourceKey ? currentStages.findIndex((item) => item.key === sourceKey) : -1;
      const source = sourceIndex >= 0 ? currentStages[sourceIndex] : undefined;
      const next = source?.defaultNextStageKey;
      const configured = current.assignmentVersion === 2 ? { ...stage, sla: { ...stage.sla, assignment: suggestFmsAssignment(source ?? currentStages.at(-1), data.formFields) } } : stage;
      const prepared = next ? { ...configured, defaultNextStageKey: next } : configured;
      const stages = [...currentStages];
      if (sourceIndex >= 0) { stages[sourceIndex] = { ...source!, defaultNextStageKey: stage.key }; stages.splice(sourceIndex + 1, 0, prepared); }
      else stages.push(prepared);
      return { ...current, stages };
    });
    setSelectedKey(stage.key); setRightPanel("inspector"); setToolsOpen(false); setError(null);
  };
  const replace = (key: string, value: FmsStageDefinition) => commit((current) => ({ ...current, stages: current.stages.map((stage) => stage.key === key ? value : stage) }));
  const remove = (key: string) => {
    const target = normalized.stages.find((stage) => stage.key === key);
    if (!target) return;
    if (normalized.stages[0]?.key === key) { setError("The first Form is the workflow trigger and cannot be deleted. Change its linked Form instead."); return; }
    if (!window.confirm(`Delete ${target.name || "this step"}? Connections will be repaired where possible.`)) return;
    const stages = removeFmsStage(normalized.stages, key); commit({ ...definition, stages }); setSelectedKey(stages[0]?.key ?? null);
  };
  const duplicateStage = (key: string) => { const source = normalized.stages.find((stage) => stage.key === key); if (!source || normalized.stages[0]?.key === key) return; const stage = { ...source, key: nextKey(), name: `${source.name} copy`, order: normalized.stages.length, defaultNextStageKey: undefined, branchRules: source.type === "branch" ? [{ id: crypto.randomUUID(), source: "outcome" as const, operator: "default" as const, order: 0 }] : [], parallelTargetStageKeys: [], joinRequiredStageKeys: [] }; commit({ ...definition, stages: [...normalized.stages, stage] }); setSelectedKey(stage.key); setRightPanel("inspector"); };
  /** A first connection becomes the plain next step; each extra one becomes an ordered route. */
  const connect = (from: string, to: string) => {
    commit((current) => ({ ...current, stages: current.stages.map((stage) => {
      if (stage.key !== from) return stage;
      if (stage.type === "branch") return { ...stage, branchRules: stage.branchRules.map((rule, index) => rule.operator === "default" || index === stage.branchRules.length - 1 ? { ...rule, nextStageKey: to, nextFlowId: undefined } : rule) };
      if (stage.type === "parallel_start") return { ...stage, parallelTargetStageKeys: stage.parallelTargetStageKeys.includes(to) ? stage.parallelTargetStageKeys : [...stage.parallelTargetStageKeys, to] };
      if (!stage.defaultNextStageKey) return { ...stage, defaultNextStageKey: to };
      if (stage.defaultNextStageKey === to || stage.branchRules.some((rule) => rule.nextStageKey === to)) return stage;
      const questions = fmsStageFormFields(stage, data.formFields);
      const source = questions.length > 0 ? "form_answer" as const : stage.sla.decisionMode === "yes_no" ? "outcome" as const : "context" as const;
      const rule = { id: crypto.randomUUID(), source, ...(source === "form_answer" ? { sourceKey: questions[0]!.key } : {}), operator: "equals" as const, value: source === "outcome" ? stage.sla.decisionOptions?.[0]?.key ?? "" : "", nextStageKey: to, order: stage.branchRules.length };
      return { ...stage, branchRules: [...stage.branchRules, rule] };
    }) }));
    setSelectedKey(from);
  };
  /** Canvas coordinates live on the stage, so a manual arrangement survives a reload. */
  const moveStages = (positions: Readonly<Record<string, { x: number; y: number }>>) =>
    commit((current) => ({ ...current, stages: current.stages.map((stage) => positions[stage.key] ? { ...stage, position: positions[stage.key] } : stage) }));
  /** Moves an existing connection onto a different step in one undoable commit. */
  const reconnect = (from: string, previousTo: string, nextTo: string, ruleId?: string) => {
    if (from === nextTo || previousTo === nextTo) return;
    commit((current) => ({ ...current, stages: current.stages.map((stage) => {
      if (stage.key !== from) return stage;
      if (ruleId) return { ...stage, branchRules: stage.branchRules.map((rule) => rule.id === ruleId ? { ...rule, nextStageKey: nextTo, nextFlowId: undefined } : rule) };
      if (stage.type === "parallel_start") return { ...stage, parallelTargetStageKeys: stage.parallelTargetStageKeys.map((key) => key === previousTo ? nextTo : key) };
      return stage.defaultNextStageKey === previousTo ? { ...stage, defaultNextStageKey: nextTo } : stage;
    }) }));
    setSelectedKey(from);
  };
  const disconnect = (from: string, to: string, ruleId?: string) => commit((current) => ({ ...current, stages: current.stages.map((stage) => {
    if (stage.key !== from) return stage;
    if (ruleId) return { ...stage, branchRules: stage.branchRules.filter((rule) => rule.id !== ruleId).map((rule, order) => ({ ...rule, order })) };
    if (stage.type === "parallel_start") return { ...stage, parallelTargetStageKeys: stage.parallelTargetStageKeys.filter((key) => key !== to) };
    return stage.defaultNextStageKey === to ? { ...stage, defaultNextStageKey: undefined } : stage;
  }) }));
  const ensureFirstForm = () => { if (normalized.stages.length) return; const first = { ...newFmsStage("form", 0), key: "start_form", name: "Start form", assigneeRules: contextDefaultAssigneeId ? [{ type: "specific_user" as const, userProfileId: contextDefaultAssigneeId }] : [] }; commit({ ...definition, stages: [first] }); setSelectedKey(isPhone ? null : first.key); };
  const persist = async () => { const id = await saveFmsDraft(persistedId, normalized); setPersistedId(id); setSavedSnapshot(JSON.stringify(normalized)); await onSaved(); return id; };
  const openForm = async (action: FmsFormAuthoringAction) => {
    if (!selected) return;
    setBusy("save"); setError(null);
    try { setFormAuthoring(await prepareFmsFormAuthoring(normalized, selected.key, action, canManageForms, persist)); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not open Forms"); }
    finally { setBusy(null); }
  };
  const save = async () => { setBusy("save"); setError(null); setSuccess(null); try { await persist(); setSuccess("Draft saved"); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save FMS draft"); } finally { setBusy(null); } };
  const publish = async () => { if (issues.length) { setError("Resolve the publish-readiness issues below before publishing."); return; } setBusy("publish"); setError(null); try { const id = await persist(); await publishFmsFlow(id); await onSaved(); setSuccess("Workflow published and ready to run"); onClose(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to publish workflow"); } finally { setBusy(null); } };

  if (screen === "details") return <section className="mx-auto max-w-2xl space-y-6"><Button onClick={onClose} type="button" variant="ghost"><ArrowLeft className="size-4" />Back to FMS</Button><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold-secondary">Workflow details</p><h3 className="mt-2 text-2xl font-semibold text-white">Name this workflow</h3><p className="mt-2 text-sm text-soft-grey">The first canvas step will be a Form trigger. No Start or End nodes are needed.</p></div><div className="space-y-4 rounded-2xl border border-gold/20 bg-charcoal p-5"><Field label="Workflow name *"><input autoFocus className="field" maxLength={150} onChange={(event) => commit({ ...definition, name: event.target.value })} value={definition.name} /></Field><Field label="Purpose *"><textarea className="field min-h-24" onChange={(event) => commit({ ...definition, description: event.target.value })} value={definition.description ?? ""} /></Field>{scopeSummary ? <p className="rounded-lg border border-gold/15 bg-gold/5 p-3 text-xs text-soft-grey">Existing scope kept: {scopeSummary}. Scope is no longer part of workflow setup and stays exactly as it was saved.</p> : null}</div><Button className="ml-auto flex" disabled={!normalized.name || !normalized.description?.trim()} onClick={() => { ensureFirstForm(); setScreen("canvas"); }}>Open builder <Plus className="size-4" /></Button></section>;

  const checkWorkflow = () => { setSuccess(issues.length ? null : "Workflow check passed"); setError(issues.length ? "Workflow check found issues. Review Publish readiness." : null); };
  const processFormName = normalized.stages[0]?.formTemplateId ? data.forms.find((form) => form.id === normalized.stages[0]?.formTemplateId)?.name ?? "Form attached" : "None attached";
  const assigneeSummary = assignableStages.length ? `${assignedStages.length}/${assignableStages.length} assigned` : "No steps yet";
  if (formAuthoring) return <FmsFormAuthoring target={formAuthoring} onClose={() => setFormAuthoring(null)} onSaved={onSaved} />;
  /** "Go to step" from the assistant reuses the Publish-readiness navigation, so the same control is focused. */
  const goToStage = (stageKey: string, finding?: FmsDiagnosticFinding) => {
    setAiOpen(null);
    if (finding?.source === "validator") { openIssue({ code: finding.code, message: finding.title, stageKey }); return; }
    setFocusedIssue(null); setSelectedKey(stageKey);
    setFocusRequest((current) => ({ key: stageKey, id: (current?.id ?? 0) + 1 }));
  };
  const openAi = (tab: FmsAiTab) => { setAiOpen(tab); setRightPanel("ai"); };
  const toggleAi = () => { if (aiOpen && (rightPanel === "ai" || !selected)) setAiOpen(null); else { setAiOpen((open) => open ?? "check"); setRightPanel("ai"); } };
  // The assistant and the step inspector share the right side; only one is shown at a time.
  const aiPanel = ai && aiOpen ? <FmsAiPanel canManageForms={canManageForms} embedded={!isPhone} data={data} definition={normalized} initialTab={aiOpen} onApply={(next) => { commit(next); setSuccess("Assistant changes applied. Use Undo to revert; Save draft and Publish when ready."); }} onClose={() => setAiOpen(null)} onGoToStage={goToStage} published={ai.published ?? null} readOnly={false} runCandidates={ai.runCandidates} selectedStageKey={selected?.key ?? selectedKey} settings={ai.settings} /> : null;
  const emptyStart = !normalized.stages.length ? <div className="space-y-3 rounded-2xl border border-gold/20 bg-charcoal p-5 text-sm text-soft-grey"><p className="font-semibold text-white">This workflow has no steps yet.</p><p>Describe it to the assistant, or start with the Form trigger and build it yourself.</p><div className="flex flex-wrap gap-2">{aiAvailable && ai?.settings.builderEnabled ? <Button onClick={() => openAi("build")} variant="secondary"><Sparkles className="size-4" />Build with AI</Button> : null}<Button onClick={() => { ensureFirstForm(); setAiOpen(null); }} variant="secondary"><Plus className="size-4" />Build manually</Button></div></div> : null;
  const showAi = !!aiPanel && (rightPanel === "ai" || !selected);
  const showInspector = !!selected && !showAi;
  const inspector = selected ? <>
    <div aria-hidden="true" className="fixed inset-0 z-40 bg-obsidian/60 md:hidden" onClick={() => setSelectedKey(null)} />
    <aside ref={inspectorRef} className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-2xl border border-gold/30 bg-obsidian px-4 pb-4 shadow-2xl md:bottom-0 md:left-auto md:top-16 md:max-h-none md:w-[min(32rem,45vw)] md:rounded-none md:border-y-0 md:border-r-0 md:pt-4">
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between gap-2 border-b border-gold/15 bg-obsidian px-4 pb-3 pt-2 md:static md:mx-0 md:border-0 md:p-0">
        <div className="min-w-0"><p className="text-xs text-gold-secondary">{selected.type.replaceAll("_", " ")}</p><h3 className="truncate text-lg font-semibold text-white">{selected.name}</h3></div>
        <Button aria-label="Close inspector" className="shrink-0" onClick={() => setSelectedKey(null)} variant="ghost"><X className="size-5" /></Button>
      </div>
      {issues.filter((issue) => issue.stageKey === selected.key).map((issue, index) => <Notice key={`${issue.code}-${index}`} tone="danger">{issue.message}</Notice>)}
      <FmsFormActions linked={!!selected.formTemplateId} canManage={canManageForms} disabled={!!busy} onOpen={action => void openForm(action)} />
      <FmsStageEditor assignmentVersion={normalized.assignmentVersion} data={data} onChange={(value) => { replace(selected.key, value); setSelectedKey(value.key); }} onDelete={() => remove(selected.key)} stage={selected} stages={normalized.stages} />
    </aside>
  </> : null;

  const desktopInspector = selected ? <aside aria-label={`Configure ${selected.name || "step"}`} className="absolute inset-y-0 right-0 z-40 flex w-[min(32rem,calc(100%-3.5rem))] flex-col border-l border-gold/30 bg-obsidian shadow-2xl" ref={inspectorRef}>
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-gold/15 px-4 py-3">
      <div className="min-w-0"><p className="text-xs capitalize text-gold-secondary">{selected.type.replaceAll("_", " ")}</p><h3 className="truncate text-lg font-semibold text-white">{selected.name || "Untitled step"}</h3></div>
      <Button aria-label="Close inspector" className="shrink-0" onClick={() => setSelectedKey(null)} variant="ghost"><X className="size-5" /></Button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-4">
      {issues.filter((issue) => issue.stageKey === selected.key).map((issue, index) => <Notice key={`${issue.code}-${index}`} tone="danger">{issue.message}</Notice>)}
      <FmsFormActions linked={!!selected.formTemplateId} canManage={canManageForms} disabled={!!busy} onOpen={action => void openForm(action)} />
      <FmsStageEditor assignmentVersion={normalized.assignmentVersion} data={data} onChange={(value) => { replace(selected.key, value); setSelectedKey(value.key); }} onDelete={() => remove(selected.key)} stage={selected} stages={normalized.stages} />
    </div>
  </aside> : null;
  const rightPanels = <>{aiPanel ? <div className={showAi ? "contents" : "hidden"}>{aiPanel}</div> : null}{showInspector ? isPhone ? inspector : desktopInspector : null}</>;

  /**
   * Phones get their own layout: a two-row header that never hides Publish, a
   * Steps list that needs no dragging (the default), and the canvas as an
   * optional full-height Map. Every action calls the same handlers as desktop.
   */
  if (isPhone) return <div className="relative flex min-h-[calc(100dvh-8rem)] flex-col">
    <header className="sticky top-0 z-30 -mx-2 mb-3 space-y-2 border-b border-gold/20 bg-obsidian/95 px-2 pb-2 pt-1 backdrop-blur">
      <div className="flex items-center gap-1">
        <Button aria-label="Back" className="shrink-0 px-2" onClick={onClose} type="button" variant="ghost"><ArrowLeft className="size-5" /></Button>
        <div className="min-w-0 flex-1"><h2 className="truncate text-base font-semibold text-white">{normalized.name}</h2><p className="truncate text-xs text-soft-grey">{dirty ? "Unsaved changes" : "Draft saved"}</p></div>
        <Button aria-label={busy === "save" ? "Saving..." : "Save draft"} className="shrink-0 px-3" disabled={!!busy} onClick={() => void save()} variant="secondary"><Save className="size-4" /></Button>
        <Button className="shrink-0 px-3" disabled={!!busy || issues.length > 0} onClick={() => void publish()}><Send className="size-4" />{busy === "publish" ? "Publishing..." : "Publish"}</Button>
      </div>
      <div className="flex items-center gap-1">
        <div aria-label="Builder view" className="mr-1 flex flex-1 rounded-xl border border-gold/20 bg-charcoal p-1" role="tablist">
          {(["steps", "map"] as const).map((view) => <button aria-selected={phoneView === view} className={cn("min-h-10 flex-1 rounded-lg text-sm font-semibold transition", phoneView === view ? "bg-gold text-on-gold" : "text-champagne")} key={view} onClick={() => setPhoneView(view)} role="tab" type="button">{view === "steps" ? "Steps" : "Map"}</button>)}
        </div>
        <Button aria-label="Undo" className="shrink-0 px-3" disabled={!past.length} onClick={undo} variant="ghost"><Undo2 className="size-5" /></Button>
        <Button aria-label="Redo" className="shrink-0 px-3" disabled={!future.length} onClick={redo} variant="ghost"><Redo2 className="size-5" /></Button>
        {aiAvailable ? <Button aria-label="FMS assistant" aria-pressed={!!aiOpen} className="shrink-0 px-3" onClick={toggleAi} variant={aiOpen ? "primary" : "ghost"}><Sparkles className="size-5" /></Button> : null}
      </div>
    </header>
    {isPhone ? <Button variant="secondary" onClick={() => setSimulating(true)}>Simulate workflow</Button> : null}
    {normalized.assignmentVersion !== 2 ? <Notice>This draft uses legacy assignment behavior. Existing running workflows keep their published contract. <Button variant="secondary" onClick={() => commit(upgradeFmsAssignmentContract(normalized, data.formFields))}>Upgrade this draft to stage-specific assignment</Button></Notice> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}{success ? <Notice>{success}</Notice> : null}
    {emptyStart ?? (phoneView === "steps" ? <div className="space-y-3 pb-4">
      <div className="grid grid-cols-2 gap-2">
        <button className="flex min-h-14 min-w-0 items-center gap-2 rounded-xl border border-gold/20 bg-charcoal p-3 text-left" onClick={() => normalized.stages[0] && selectStage(normalized.stages[0].key)} type="button"><FileText className="size-4 shrink-0 text-champagne" /><span className="min-w-0"><b className="block truncate text-sm text-white">{processFormName}</b><span className="text-[11px] text-soft-grey">Process form</span></span></button>
        <button className="flex min-h-14 min-w-0 items-center gap-2 rounded-xl border border-gold/20 bg-charcoal p-3 text-left" onClick={() => setAssigning(true)} type="button"><UserRoundPlus className="size-4 shrink-0 text-champagne" /><span className="min-w-0"><b className="block truncate text-sm text-white">{assigneeSummary}</b><span className="text-[11px] text-soft-grey">Default assignees</span></span></button>
      </div>
      <p className="text-xs text-soft-grey">Tap a step to edit it and choose where it continues. The final unconnected step completes the workflow.</p>
      <FmsStepList definition={normalized} formFields={data.formFields} invalidKeys={invalidKeys} onAddAfter={(key) => add("task", key)} onDelete={remove} onDuplicate={duplicateStage} onSelect={selectStage} selectedKey={selected?.key ?? null} />
    </div> : <div className="relative">
      <FmsGraphCanvas definition={normalized} formFields={data.formFields} focusRequest={focusRequest} invalidKeys={invalidKeys} onAddAfter={(key) => add("task", key)} onConnect={connect} onDelete={remove} onDisconnect={disconnect} onDuplicate={duplicateStage} onMove={moveStages} onReconnect={reconnect} onSelect={selectStage} selectedKey={selected?.key ?? null} />
      <Button className="absolute bottom-3 left-3 z-30 shadow-lg" onClick={() => add("task")} type="button"><Plus className="size-4" />Add Step</Button>
    </div>)}
    <section className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 -mx-2 mt-auto rounded-t-2xl border border-b-0 border-gold/30 bg-charcoal/95 backdrop-blur">
      <button aria-expanded={issues.length ? issuesOpen : undefined} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left" onClick={() => { if (issues.length) setIssuesOpen((open) => !open); else checkWorkflow(); }} type="button">
        <span className="mr-auto"><span className="block font-semibold text-white">Publish readiness</span><span className="block text-xs text-soft-grey">{issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"} to resolve · tap to ${issuesOpen ? "hide" : "review"}` : "Ready to publish"}</span></span>
        {issues.length ? <ChevronDown className={cn("size-5 text-soft-grey transition", issuesOpen && "rotate-180")} /> : <CheckCircle2 className="size-5 text-success" />}
      </button>
      {issuesOpen && issues.length ? <ul className="max-h-[35dvh] space-y-2 overflow-y-auto px-4 pb-3">{issues.map((issue, index) => <li key={`${issue.code}-${issue.stageKey ?? index}`}><button className="min-h-11 w-full rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-left text-xs text-danger" onClick={() => openIssue(issue)} type="button">{issueLabel(issue)}</button></li>)}</ul> : null}
    </section>
    {rightPanels}
    {simulating ? <FmsSimulation definition={normalized} data={data} onClose={() => setSimulating(false)} /> : null}
    {assigning ? <DefaultAssigneesDialog data={data} definition={normalized} onChange={(stages) => commit((current) => ({ ...current, stages }))} onClose={() => setAssigning(false)} /> : null}
  </div>;

  /**
   * Desktop and tablet: the canvas is the workspace. A compact toolbar sits on
   * top, a narrow rail opens the Workflow tools drawer, and the step inspector
   * or assistant overlays the right edge. Drawers overlay the canvas, so its
   * size, pan and zoom never change when they open or close.
   */
  const rightOpen = showAi || showInspector;
  const toolbarButton = "shrink-0 px-2.5";
  return <div className="relative -m-4 flex flex-col overflow-hidden bg-obsidian sm:-m-6" ref={workspaceRef} style={workspaceHeight ? { height: workspaceHeight } : undefined}>
    <header className="scroll-x no-scrollbar z-40 flex shrink-0 items-center gap-1.5 border-b border-gold/20 bg-charcoal/95 px-3 py-2 backdrop-blur">
      <Button aria-label="Back to FMS" className={toolbarButton} onClick={onClose} type="button" variant="ghost"><ArrowLeft className="size-4" /><span className="hidden xl:inline">Back to FMS</span></Button>
      <div className="mr-auto min-w-0 max-w-[40vw] px-1"><h2 className="truncate text-sm font-semibold text-white lg:text-base">{normalized.name}</h2><p className="truncate text-xs text-soft-grey">{dirty ? "Unsaved changes" : "All changes saved"}</p></div>
      <div aria-label="Builder view" className="flex shrink-0 rounded-lg border border-gold/20 bg-obsidian p-0.5" role="group">
        <button aria-label="Canvas Mode" aria-pressed={phoneView === "map"} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition", phoneView === "map" ? "bg-gold text-on-gold" : "text-champagne hover:text-white")} onClick={() => setPhoneView("map")} type="button"><Network aria-hidden className="size-4" /><span aria-hidden className="hidden lg:inline">Canvas Mode</span></button>
        <button aria-label="Guided Mode" aria-pressed={phoneView === "steps"} className={cn("inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition", phoneView === "steps" ? "bg-gold text-on-gold" : "text-champagne hover:text-white")} onClick={() => setPhoneView("steps")} type="button"><ListOrdered aria-hidden className="size-4" /><span aria-hidden className="hidden lg:inline">Guided Mode</span></button>
      </div>
      <Button aria-label="Undo" className={toolbarButton} disabled={!past.length} onClick={undo} variant="ghost"><Undo2 className="size-4" /></Button>
      <Button aria-label="Redo" className={toolbarButton} disabled={!future.length} onClick={redo} variant="ghost"><Redo2 className="size-4" /></Button>
      {aiAvailable ? <Button aria-label="FMS assistant" aria-pressed={showAi} className={toolbarButton} onClick={toggleAi} variant={showAi ? "primary" : "secondary"}><Sparkles className="size-4" /><span className="hidden xl:inline">AI assistant</span></Button> : null}
      <Button aria-label="Check workflow" className={toolbarButton} onClick={checkWorkflow} variant="secondary"><TestTube2 className="size-4" /><span className="hidden xl:inline">Check workflow</span></Button>
      <Button aria-label="Simulate workflow" className={toolbarButton} onClick={() => setSimulating(true)} variant="secondary"><FlaskConical className="size-4" /><span className="hidden xl:inline">Simulate</span></Button>
      <Button aria-label={busy === "save" ? "Saving..." : "Save draft"} className={toolbarButton} disabled={!!busy} onClick={() => void save()} variant="secondary"><Save className="size-4" /><span aria-hidden className="hidden lg:inline">{busy === "save" ? "Saving..." : "Save draft"}</span></Button>
      <Button className={toolbarButton} disabled={!!busy || issues.length > 0} onClick={() => void publish()}><Send className="size-4" />{busy === "publish" ? "Publishing..." : "Publish"}</Button>
    </header>
    {normalized.assignmentVersion !== 2 || error || success ? <div className="shrink-0 space-y-2 border-b border-gold/15 px-3 py-2">
      {normalized.assignmentVersion !== 2 ? <Notice>This draft uses legacy assignment behavior. Existing running workflows keep their published contract. <Button variant="secondary" onClick={() => commit(upgradeFmsAssignmentContract(normalized, data.formFields))}>Upgrade this draft to stage-specific assignment</Button></Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}{success ? <Notice>{success}</Notice> : null}
    </div> : null}
    {/* The canvas mounts once the workspace has its measured height, so its first fit uses the real size. */}
    {workspaceHeight === undefined ? null : <div className="relative flex min-h-0 flex-1">
      <nav aria-label="Workflow tools" className="z-30 flex w-12 shrink-0 flex-col items-center gap-2 border-r border-gold/15 bg-charcoal/80 py-3">
        <button aria-controls="fms-workflow-tools" aria-expanded={toolsOpen} aria-label="Open workflow tools" className={cn("grid size-9 place-items-center rounded-lg border text-gold-secondary transition hover:bg-gold/10", toolsOpen ? "border-gold bg-gold/15" : "border-gold/25")} onClick={() => setToolsOpen((open) => !open)} ref={toolsButtonRef} title="Workflow tools" type="button"><PanelLeftOpen className="size-4" /></button>
        <button aria-label="Add Step" className="grid size-9 place-items-center rounded-lg bg-gold text-on-gold shadow transition hover:brightness-110" onClick={() => add("task")} title="Add Step" type="button"><Plus className="size-4" /></button>
      </nav>
      <div className="relative min-w-0 flex-1" style={{ "--fms-canvas-overlay-bottom": "5rem" } as CSSProperties}>
        {emptyStart ? <div className="grid h-full place-items-center overflow-y-auto p-6"><div className="max-w-md">{emptyStart}</div></div>
          : phoneView === "map" ? <FmsGraphCanvas definition={normalized} fill formFields={data.formFields} focusRequest={focusRequest} invalidKeys={invalidKeys} onAddAfter={(key) => add("task", key)} onConnect={connect} onDelete={remove} onDisconnect={disconnect} onDuplicate={duplicateStage} onMove={moveStages} onReconnect={reconnect} onSelect={selectStage} selectedKey={selected?.key ?? null} />
          : <div className="h-full overflow-y-auto overscroll-contain p-4 pb-24 lg:p-6 lg:pb-24"><div className="mx-auto max-w-3xl space-y-3"><p className="text-xs text-soft-grey">Guided Mode lists the workflow step by step. Select a step to edit it and choose where it continues.</p><FmsStepList definition={normalized} formFields={data.formFields} invalidKeys={invalidKeys} onAddAfter={(key) => add("task", key)} onDelete={remove} onDuplicate={duplicateStage} onSelect={selectStage} selectedKey={selected?.key ?? null} /></div></div>}
        <section aria-label="Publish readiness" className={cn("absolute bottom-3 left-3 z-30 rounded-2xl border border-gold/30 bg-charcoal/95 px-3 py-2 shadow-xl backdrop-blur", rightOpen ? "max-w-[calc(100%-min(34rem,100%-3.5rem)-1.5rem)]" : "max-w-[min(56rem,calc(100%-1.5rem))]")}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="shrink-0"><p className="text-sm font-semibold text-white">Publish readiness</p><p className="text-xs text-soft-grey">{issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"} to resolve` : "Ready to publish"}</p></div>
            {issues.length ? <div className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto">{issues.map((issue, index) => <button className="shrink-0 rounded-lg border border-danger/30 bg-danger/5 px-3 py-1.5 text-left text-xs text-danger" key={`${issue.code}-${issue.stageKey ?? index}`} onClick={() => openIssue(issue)} type="button">{issueLabel(issue)}</button>)}</div> : <CheckCircle2 aria-hidden className="size-5 text-success" />}
          </div>
        </section>
        {toolsOpen ? <>
          <div aria-hidden="true" className="absolute inset-0 z-30 bg-obsidian/40" onPointerDown={() => setToolsOpen(false)} />
          <aside aria-label="Workflow tools drawer" className="absolute inset-y-0 left-0 z-40 flex w-[min(18rem,calc(100%-1rem))] flex-col border-r border-gold/30 bg-charcoal shadow-2xl" id="fms-workflow-tools">
            <header className="flex shrink-0 items-center justify-between gap-2 border-b border-gold/15 px-3 py-2.5"><p className="text-sm font-semibold text-white">Workflow tools</p><Button aria-label="Close workflow tools" autoFocus className="shrink-0 px-2" onClick={() => { setToolsOpen(false); toolsButtonRef.current?.focus(); }} variant="ghost"><X className="size-5" /></Button></header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
              <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-champagne">Building blocks</p>
              <button className="flex w-full items-center gap-3 rounded-xl border border-gold/40 bg-gold/10 p-3 text-left text-gold-secondary hover:bg-gold/20" onClick={() => add("task")} type="button"><span className="grid size-8 place-items-center rounded-lg bg-gold text-on-gold"><UserRoundPlus className="size-4" /></span><span><b className="block text-sm">Add Step</b><span className="text-[11px] text-champagne">Create the next general workflow step</span></span></button>
              <section className="mt-5 border-t border-gold/15 pt-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-champagne">Process form</p><button className="flex w-full items-center gap-3 rounded-xl border border-gold/15 p-3 text-left hover:border-gold" onClick={() => { if (normalized.stages[0]) { selectStage(normalized.stages[0].key); setToolsOpen(false); } }} type="button"><span className="grid size-8 place-items-center rounded-lg bg-champagne/20 text-champagne"><FileText className="size-4" /></span><span><b className="block text-sm text-white">{processFormName}</b><span className="text-[11px] text-soft-grey">Configure the initial details form</span></span></button></section>
              <section className="mt-5 border-t border-gold/15 pt-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-champagne">Default assignees</p><button className="flex w-full items-center gap-3 rounded-xl border border-gold/15 p-3 text-left hover:border-gold" onClick={() => { setAssigning(true); setToolsOpen(false); }} type="button"><span className="grid size-8 place-items-center rounded-lg bg-champagne/20 text-champagne"><UserRoundPlus className="size-4" /></span><span><b className="block text-sm text-white">{assigneeSummary}</b><span className="text-[11px] text-soft-grey">Pre-assign users after building the flow</span></span></button></section>
              <p className="mt-5 border-t border-gold/15 pt-3 text-[11px] text-soft-grey">The initial Form starts the workflow. The final unconnected step completes it.</p>
            </div>
          </aside>
        </> : null}
        {rightPanels}
      </div>
    </div>}
    {simulating ? <FmsSimulation definition={normalized} data={data} onClose={() => setSimulating(false)} /> : null}
    {assigning ? <DefaultAssigneesDialog data={data} definition={normalized} onChange={(stages) => commit((current) => ({ ...current, stages }))} onClose={() => setAssigning(false)} /> : null}
  </div>;
}

function DefaultAssigneesDialog({ data, definition, onChange, onClose }: { data: FmsData; definition: FmsFlowDefinition; onChange: (stages: readonly FmsStageDefinition[]) => void; onClose: () => void }) {
  const steps = definition.stages.filter((stage) => ["form", "task", "approval"].includes(stage.type));
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [sameForAll, setSameForAll] = useState(false);
  const setAssignee = async (key: string, userProfileId: string) => {
    const changed = definition.stages.map((stage) => stage.key !== key ? stage : { ...stage, assigneeRules: userProfileId ? [{ type: "specific_user" as const, userProfileId }] : [] });
    onChange(sameForAll && key === steps[0]?.key && userProfileId ? copyFirstFmsAssigneeToHumanStages(changed) : changed);
    if (key !== steps[0]?.key || !userProfileId) setSameForAll(false);
    if (!definition.moduleContext || !userProfileId) return;
    try {
      await saveFmsContextAssigneeDefault(definition.moduleContext, userProfileId);
      setMappingError(null);
    } catch (caught) {
      setMappingError(caught instanceof Error ? caught.message : "Could not save the context default assignee");
    }
  };
  const people = data.users.filter((user) => user.working_status === "active" && user.account_status !== "inactive" && user.account_status !== "suspended" && user.is_login_enabled).map((user) => ({ ...user, employee_code: user.employee_code ?? null }));
  const branchNames = new Map(data.branches.map((branch) => [branch.id, branch.name]));
  const departmentNames = new Map(data.departments.map((department) => [department.id, department.name]));
  const toggleSameForAll = () => {
    if (sameForAll) { setSameForAll(false); return; }
    if (!steps[0]?.assigneeRules.some((rule) => rule.type === "specific_user" && rule.userProfileId)) { setMappingError("Select a person for the first step before using them for all steps."); return; }
    onChange(copyFirstFmsAssigneeToHumanStages(definition.stages));
    setMappingError(null);
    setSameForAll(true);
  };
  return <Modal onClose={onClose} title="Default assignees" wide><div className="space-y-4"><p className="text-sm text-soft-grey">Choose an optional person for each workflow step. A step-specific person overrides a user selected in a linked form.{definition.moduleContext ? " Selecting a person also saves that context's default from the existing Users directory; individual stages remain editable." : ""}</p><label className="flex items-center gap-2 text-sm text-white"><input checked={sameForAll} onChange={toggleSameForAll} type="checkbox" />Use the first step's person for all steps</label>{mappingError ? <Notice tone="danger">{mappingError}</Notice> : null}<div className="max-h-[55dvh] space-y-3 overflow-y-auto pr-1">{steps.map((stage, index) => <article className="rounded-2xl border border-gold/20 bg-charcoal/60 p-4" key={stage.key}><div className="mb-3 flex items-center justify-between gap-3"><div><p className="font-semibold text-white">{stage.name}</p><p className="text-xs text-soft-grey">{stage.type === "form" && index === 0 ? "Process form" : "Workflow step"}</p></div><span className="rounded-full bg-gold/10 px-2 py-1 text-xs text-gold-secondary">Step {index + 1}</span></div><AssigneePicker branchNames={branchNames} departmentNames={departmentNames} label={`Assign ${stage.name}`} multiple={false} onChange={(ids) => void setAssignee(stage.key, ids[0] ?? "")} people={people} selectedIds={stage.assigneeRules.find((rule) => rule.type === "specific_user")?.userProfileId ? [stage.assigneeRules.find((rule) => rule.type === "specific_user")!.userProfileId!] : []}/><button className="mt-2 text-xs text-soft-grey underline hover:text-white" onClick={() => void setAssignee(stage.key, "")} type="button">Clear assignee</button></article>)}</div><div className="flex justify-end"><Button onClick={onClose}>Done</Button></div></div></Modal>;
}
