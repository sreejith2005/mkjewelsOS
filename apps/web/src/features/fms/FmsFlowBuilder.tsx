import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, ChevronDown, FileText, Plus, Redo2, Save, Send, TestTube2, Undo2, UserRoundPlus, X } from "lucide-react";
import { copyFirstFmsAssigneeToHumanStages, normalizeFmsDefinition, validateFmsDefinition, type FmsFlowDefinition, type FmsStageDefinition } from "@jewelos/core";
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
import { cn } from "@/lib/utils";

function issueControlSelector(code: string, message: string): string {
  if (code === "invalid_assignment_field") return '[data-fms-focus="assignment"]';
  if (["missing_form", "invalid_form", "missing_linked_form", "route_without_form"].includes(code)) return '[data-fms-focus="form"]';
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
      : ["route_field_missing"].includes(code) ? "question"
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

export function FmsFlowBuilder({ flow, data, duplicate, onClose, onSaved }: { flow: FmsFlowRow | null; data: FmsData; duplicate?: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const initial = useMemo(() => { const value = flowToDefinition(flow, data); return duplicate ? { ...value, id: undefined, familyId: undefined, version: 1, lifecycle: "draft" as const, name: `${value.name} (Copy)` } : value; }, [data, duplicate, flow]);
  const [definition, setDefinition] = useState<FmsFlowDefinition>(initial);
  const [past, setPast] = useState<FmsFlowDefinition[]>([]);
  const [future, setFuture] = useState<FmsFlowDefinition[]>([]);
  const [screen, setScreen] = useState<"details" | "canvas">(flow ? "canvas" : "details");
  const isPhone = useIsMobile();
  /** A phone opens on the step list with nothing selected, so the editor sheet does not cover the workflow on entry. */
  const [selectedKey, setSelectedKey] = useState<string | null>(isPhone ? null : initial.stages[0]?.key ?? null);
  const [phoneView, setPhoneView] = useState<"steps" | "map">("steps");
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

  const normalized = useMemo(() => normalizeFmsDefinition(definition), [definition]);
  const issues = useMemo(() => validateFmsDefinition(normalized, { formFields: data.formFields, availableFormIds: data.forms.map((form) => form.id) }), [data.formFields, data.forms, normalized]);
  const invalidKeys = useMemo(() => new Set(issues.flatMap((issue) => issue.stageKey ? [issue.stageKey] : [])), [issues]);
  const selected = normalized.stages.find((stage) => stage.key === selectedKey) ?? null;
  const dirty = JSON.stringify(normalized) !== savedSnapshot;
  const assignableStages = normalized.stages.filter((stage) => ["form", "task", "approval"].includes(stage.type));
  const assignedStages = assignableStages.filter((stage) => stage.assigneeRules.some((rule) => rule.type === "specific_user" && rule.userProfileId));
  const selectStage = (key: string | null) => { setFocusedIssue(null); setSelectedKey(key); };
  const openIssue = (issue: (typeof issues)[number]) => {
    const stageKey = issue.stageKey;
    if (!stageKey) {
      if (issue.code === "invalid_name" || issue.code === "invalid_scope") setScreen("details");
      else setPhoneView("map");
      setIssuesOpen(false);
      return;
    }
    setSelectedKey(stageKey);
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

  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);
  useEffect(() => {
    if (!focusedIssue || !selected) return;
    const selector = issueControlSelector(focusedIssue.code, focusedIssue.message);
    const control = inspectorRef.current?.querySelector<HTMLElement>(selector) ?? inspectorRef.current?.querySelector<HTMLElement>("[data-fms-editor] input, [data-fms-editor] select, [data-fms-editor] button");
    if (!control) return;
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
      const prepared = next ? { ...stage, defaultNextStageKey: next } : stage;
      const stages = [...currentStages];
      if (sourceIndex >= 0) { stages[sourceIndex] = { ...source!, defaultNextStageKey: stage.key }; stages.splice(sourceIndex + 1, 0, prepared); }
      else stages.push(prepared);
      return { ...current, stages };
    });
    setSelectedKey(stage.key); setError(null);
  };
  const replace = (key: string, value: FmsStageDefinition) => commit((current) => ({ ...current, stages: current.stages.map((stage) => stage.key === key ? value : stage) }));
  const remove = (key: string) => {
    const target = normalized.stages.find((stage) => stage.key === key);
    if (!target) return;
    if (normalized.stages[0]?.key === key) { setError("The first Form is the workflow trigger and cannot be deleted. Change its linked Form instead."); return; }
    if (!window.confirm(`Delete ${target.name || "this step"}? Connections will be repaired where possible.`)) return;
    const stages = removeFmsStage(normalized.stages, key); commit({ ...definition, stages }); setSelectedKey(stages[0]?.key ?? null);
  };
  const duplicateStage = (key: string) => { const source = normalized.stages.find((stage) => stage.key === key); if (!source || normalized.stages[0]?.key === key) return; const stage = { ...source, key: nextKey(), name: `${source.name} copy`, order: normalized.stages.length, defaultNextStageKey: undefined, branchRules: source.type === "branch" ? [{ id: crypto.randomUUID(), source: "outcome" as const, operator: "default" as const, order: 0 }] : [], parallelTargetStageKeys: [], joinRequiredStageKeys: [] }; commit({ ...definition, stages: [...normalized.stages, stage] }); setSelectedKey(stage.key); };
  /** A first connection becomes the plain next step; each extra one becomes an ordered route. */
  const connect = (from: string, to: string) => {
    commit((current) => ({ ...current, stages: current.stages.map((stage) => {
      if (stage.key !== from) return stage;
      if (stage.type === "branch") return { ...stage, branchRules: stage.branchRules.map((rule, index) => rule.operator === "default" || index === stage.branchRules.length - 1 ? { ...rule, nextStageKey: to, nextFlowId: undefined } : rule) };
      if (stage.type === "parallel_start") return { ...stage, parallelTargetStageKeys: stage.parallelTargetStageKeys.includes(to) ? stage.parallelTargetStageKeys : [...stage.parallelTargetStageKeys, to] };
      if (!stage.defaultNextStageKey) return { ...stage, defaultNextStageKey: to };
      if (stage.defaultNextStageKey === to || stage.branchRules.some((rule) => rule.nextStageKey === to)) return stage;
      const source = stage.formTemplateId && (data.formFields[stage.formTemplateId]?.length ?? 0) > 0 ? "form_answer" as const : stage.sla.decisionMode === "yes_no" ? "outcome" as const : "context" as const;
      const rule = { id: crypto.randomUUID(), source, ...(source === "form_answer" ? { sourceKey: data.formFields[stage.formTemplateId!]![0]!.key } : {}), operator: "equals" as const, value: source === "outcome" ? stage.sla.decisionOptions?.[0]?.key ?? "" : "", nextStageKey: to, order: stage.branchRules.length };
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
  const save = async () => { setBusy("save"); setError(null); setSuccess(null); try { await persist(); setSuccess("Draft saved"); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save FMS draft"); } finally { setBusy(null); } };
  const publish = async () => { if (issues.length) { setError("Resolve the publish-readiness issues below before publishing."); return; } setBusy("publish"); setError(null); try { const id = await persist(); await publishFmsFlow(id); await onSaved(); setSuccess("Workflow published and ready to run"); onClose(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to publish workflow"); } finally { setBusy(null); } };

  if (screen === "details") return <section className="mx-auto max-w-2xl space-y-6"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">Workflow details</p><h3 className="mt-2 text-2xl font-semibold text-white">Name this workflow</h3><p className="mt-2 text-sm text-soft-grey">The first canvas step will be a Form trigger. No Start or End nodes are needed.</p></div><div className="space-y-4 rounded-2xl border border-gold/20 bg-charcoal p-5"><Field label="Workflow name *"><input autoFocus className="field" maxLength={150} onChange={(event) => commit({ ...definition, name: event.target.value })} value={definition.name} /></Field><Field label="Purpose *"><textarea className="field min-h-24" onChange={(event) => commit({ ...definition, description: event.target.value })} value={definition.description ?? ""} /></Field>{scopeSummary ? <p className="rounded-lg border border-gold/15 bg-gold/5 p-3 text-xs text-soft-grey">Existing scope kept: {scopeSummary}. Scope is no longer part of workflow setup and stays exactly as it was saved.</p> : null}</div><Button className="ml-auto flex" disabled={!normalized.name || !normalized.description?.trim()} onClick={() => { ensureFirstForm(); setScreen("canvas"); }}>Open builder <Plus className="size-4" /></Button></section>;

  const checkWorkflow = () => { setSuccess(issues.length ? null : "Workflow check passed"); setError(issues.length ? "Workflow check found issues. Review Publish readiness." : null); };
  const processFormName = normalized.stages[0]?.formTemplateId ? data.forms.find((form) => form.id === normalized.stages[0]?.formTemplateId)?.name ?? "Form attached" : "None attached";
  const assigneeSummary = assignableStages.length ? `${assignedStages.length}/${assignableStages.length} assigned` : "No steps yet";
  const inspector = selected ? <>
    <div aria-hidden="true" className="fixed inset-0 z-40 bg-obsidian/60 md:hidden" onClick={() => setSelectedKey(null)} />
    <aside ref={inspectorRef} className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 max-h-[80dvh] overflow-y-auto overscroll-contain rounded-t-2xl border border-gold/30 bg-obsidian px-4 pb-4 shadow-2xl md:bottom-0 md:left-auto md:top-16 md:max-h-none md:w-[min(32rem,45vw)] md:rounded-none md:border-y-0 md:border-r-0 md:pt-4">
      <div className="sticky top-0 z-10 -mx-4 mb-4 flex items-center justify-between gap-2 border-b border-gold/15 bg-obsidian px-4 pb-3 pt-2 md:static md:mx-0 md:border-0 md:p-0">
        <div className="min-w-0"><p className="text-xs text-gold">{selected.type.replaceAll("_", " ")}</p><h3 className="truncate text-lg font-semibold text-white">{selected.name}</h3></div>
        <Button aria-label="Close inspector" className="shrink-0" onClick={() => setSelectedKey(null)} variant="ghost"><X className="size-5" /></Button>
      </div>
      {issues.filter((issue) => issue.stageKey === selected.key).map((issue, index) => <Notice key={`${issue.code}-${index}`} tone="danger">{issue.message}</Notice>)}
      <FmsStageEditor data={data} onChange={(value) => { replace(selected.key, value); setSelectedKey(value.key); }} onDelete={() => remove(selected.key)} stage={selected} stages={normalized.stages} />
    </aside>
  </> : null;

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
          {(["steps", "map"] as const).map((view) => <button aria-selected={phoneView === view} className={cn("min-h-10 flex-1 rounded-lg text-sm font-semibold transition", phoneView === view ? "bg-gold text-obsidian" : "text-champagne")} key={view} onClick={() => setPhoneView(view)} role="tab" type="button">{view === "steps" ? "Steps" : "Map"}</button>)}
        </div>
        <Button aria-label="Undo" className="shrink-0 px-3" disabled={!past.length} onClick={undo} variant="ghost"><Undo2 className="size-5" /></Button>
        <Button aria-label="Redo" className="shrink-0 px-3" disabled={!future.length} onClick={redo} variant="ghost"><Redo2 className="size-5" /></Button>
      </div>
    </header>
    {error ? <Notice tone="danger">{error}</Notice> : null}{success ? <Notice>{success}</Notice> : null}
    {phoneView === "steps" ? <div className="space-y-3 pb-4">
      <div className="grid grid-cols-2 gap-2">
        <button className="flex min-h-14 min-w-0 items-center gap-2 rounded-xl border border-gold/20 bg-charcoal p-3 text-left" onClick={() => normalized.stages[0] && selectStage(normalized.stages[0].key)} type="button"><FileText className="size-4 shrink-0 text-champagne" /><span className="min-w-0"><b className="block truncate text-sm text-white">{processFormName}</b><span className="text-[11px] text-soft-grey">Process form</span></span></button>
        <button className="flex min-h-14 min-w-0 items-center gap-2 rounded-xl border border-gold/20 bg-charcoal p-3 text-left" onClick={() => setAssigning(true)} type="button"><UserRoundPlus className="size-4 shrink-0 text-champagne" /><span className="min-w-0"><b className="block truncate text-sm text-white">{assigneeSummary}</b><span className="text-[11px] text-soft-grey">Default assignees</span></span></button>
      </div>
      <p className="text-xs text-soft-grey">Tap a step to edit it and choose where it continues. The final unconnected step completes the workflow.</p>
      <FmsStepList definition={normalized} formFields={data.formFields} invalidKeys={invalidKeys} onAddAfter={(key) => add("task", key)} onDelete={remove} onDuplicate={duplicateStage} onSelect={selectStage} selectedKey={selected?.key ?? null} />
    </div> : <div className="relative">
      <FmsGraphCanvas definition={normalized} formFields={data.formFields} focusRequest={focusRequest} invalidKeys={invalidKeys} onAddAfter={(key) => add("task", key)} onConnect={connect} onDelete={remove} onDisconnect={disconnect} onDuplicate={duplicateStage} onMove={moveStages} onReconnect={reconnect} onSelect={selectStage} selectedKey={selected?.key ?? null} />
      <Button className="absolute bottom-3 left-3 z-30 shadow-lg" onClick={() => add("task")} type="button"><Plus className="size-4" />Add Step</Button>
    </div>}
    <section className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 -mx-2 mt-auto rounded-t-2xl border border-b-0 border-gold/30 bg-charcoal/95 backdrop-blur">
      <button aria-expanded={issues.length ? issuesOpen : undefined} className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left" onClick={() => { if (issues.length) setIssuesOpen((open) => !open); else checkWorkflow(); }} type="button">
        <span className="mr-auto"><span className="block font-semibold text-white">Publish readiness</span><span className="block text-xs text-soft-grey">{issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"} to resolve · tap to ${issuesOpen ? "hide" : "review"}` : "Ready to publish"}</span></span>
        {issues.length ? <ChevronDown className={cn("size-5 text-soft-grey transition", issuesOpen && "rotate-180")} /> : <CheckCircle2 className="size-5 text-success" />}
      </button>
      {issuesOpen && issues.length ? <ul className="max-h-[35dvh] space-y-2 overflow-y-auto px-4 pb-3">{issues.map((issue, index) => <li key={`${issue.code}-${issue.stageKey ?? index}`}><button className="min-h-11 w-full rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-left text-xs text-danger" onClick={() => openIssue(issue)} type="button">{issueLabel(issue)}</button></li>)}</ul> : null}
    </section>
    {inspector}
    {assigning ? <DefaultAssigneesDialog data={data} definition={normalized} onChange={(stages) => commit((current) => ({ ...current, stages }))} onClose={() => setAssigning(false)} /> : null}
  </div>;

  return <div className={`relative flex min-h-[calc(100dvh-8rem)] flex-col transition-[padding] ${selected ? "md:pr-[min(32rem,45vw)]" : ""}`}><header className="scroll-x no-scrollbar sticky top-0 z-40 -mx-2 mb-3 flex items-center gap-2 border-b border-gold/20 bg-obsidian/95 px-2 py-3 backdrop-blur md:flex-wrap md:overflow-visible"><Button className="shrink-0" onClick={onClose} type="button" variant="ghost"><ArrowLeft className="size-4" /><span className="hidden sm:inline">Back</span></Button><div className="mr-auto min-w-0 max-w-[45vw] md:max-w-none"><h2 className="truncate text-base font-semibold text-white sm:text-lg">{normalized.name}</h2><p className="truncate text-xs text-soft-grey">{dirty ? "Unsaved changes" : "Draft saved"}</p></div><Button aria-label="Undo" className="shrink-0" disabled={!past.length} onClick={undo} variant="ghost"><Undo2 className="size-4" /></Button><Button aria-label="Redo" className="shrink-0" disabled={!future.length} onClick={redo} variant="ghost"><Redo2 className="size-4" /></Button><Button aria-label="Check workflow" className="shrink-0" onClick={checkWorkflow} variant="secondary"><TestTube2 className="size-4" /><span className="hidden lg:inline">Check workflow</span></Button><Button className="shrink-0" disabled={!!busy} onClick={() => void save()} variant="secondary"><Save className="size-4" /><span className="hidden lg:inline">{busy === "save" ? "Saving..." : "Save draft"}</span></Button><Button className="shrink-0" disabled={!!busy || issues.length > 0} onClick={() => void publish()}><Send className="size-4" />{busy === "publish" ? "Publishing..." : "Publish"}</Button></header>
    {error ? <Notice tone="danger">{error}</Notice> : null}{success ? <Notice>{success}</Notice> : null}
    <div className="grid gap-3 xl:grid-cols-[16rem_minmax(0,1fr)]"><aside className="max-h-64 overflow-y-auto rounded-xl border border-gold/20 bg-charcoal p-3 xl:max-h-[calc(100dvh-13rem)]"><p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-champagne">Building blocks</p><button className="flex w-full items-center gap-3 rounded-xl border border-gold/40 bg-gold/10 p-3 text-left text-gold hover:bg-gold/20" onClick={() => add("task")} type="button"><span className="grid size-8 place-items-center rounded-lg bg-gold text-obsidian"><UserRoundPlus className="size-4" /></span><span><b className="block text-sm">Add Step</b><span className="text-[11px] text-champagne">Create the next general workflow step</span></span></button><section className="mt-5 border-t border-gold/15 pt-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-champagne">Process form</p><button className="flex w-full items-center gap-3 rounded-xl border border-gold/15 p-3 text-left hover:border-gold" onClick={() => normalized.stages[0] && selectStage(normalized.stages[0].key)} type="button"><span className="grid size-8 place-items-center rounded-lg bg-champagne/20 text-champagne"><FileText className="size-4" /></span><span><b className="block text-sm text-white">{normalized.stages[0]?.formTemplateId ? data.forms.find((form) => form.id === normalized.stages[0]?.formTemplateId)?.name ?? "Form attached" : "None attached"}</b><span className="text-[11px] text-soft-grey">Configure the initial details form</span></span></button></section><section className="mt-5 border-t border-gold/15 pt-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-champagne">Default assignees</p><button className="flex w-full items-center gap-3 rounded-xl border border-gold/15 p-3 text-left hover:border-gold" onClick={() => setAssigning(true)} type="button"><span className="grid size-8 place-items-center rounded-lg bg-champagne/20 text-champagne"><UserRoundPlus className="size-4" /></span><span><b className="block text-sm text-white">{assignableStages.length ? `${assignedStages.length}/${assignableStages.length} assigned` : "No steps yet"}</b><span className="text-[11px] text-soft-grey">Pre-assign users after building the flow</span></span></button></section><p className="mt-5 border-t border-gold/15 pt-3 text-[11px] text-soft-grey">The initial Form starts the workflow. The final unconnected step completes it.</p></aside><FmsGraphCanvas definition={normalized} formFields={data.formFields} focusRequest={focusRequest} invalidKeys={invalidKeys} onAddAfter={(key) => add("task", key)} onConnect={connect} onDelete={remove} onDisconnect={disconnect} onDuplicate={duplicateStage} onMove={moveStages} onReconnect={reconnect} onSelect={selectStage} selectedKey={selected?.key ?? null} /></div>
    {inspector}
    <section className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 -mx-2 mt-3 rounded-t-2xl border border-b-0 border-gold/30 bg-charcoal/95 px-4 py-3 backdrop-blur md:bottom-0"><div className="flex flex-wrap items-center gap-3"><div className="mr-auto"><p className="font-semibold text-white">Publish readiness</p><p className="text-xs text-soft-grey">{issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"} to resolve` : "Ready to publish"}</p></div>{issues.length ? <div className="hidden max-w-3xl flex-1 gap-2 overflow-x-auto md:flex">{issues.map((issue, index) => <button className="shrink-0 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-left text-xs text-danger" key={`${issue.code}-${issue.stageKey ?? index}`} onClick={() => openIssue(issue)} type="button">{issueLabel(issue)}</button>)}</div> : <CheckCircle2 className="size-5 text-success" />}</div></section>
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
  return <Modal onClose={onClose} title="Default assignees" wide><div className="space-y-4"><p className="text-sm text-soft-grey">Choose an optional person for each workflow step. A step-specific person overrides a user selected in a linked form.{definition.moduleContext ? " Selecting a person also saves that context's default from the existing Users directory; individual stages remain editable." : ""}</p><label className="flex items-center gap-2 text-sm text-white"><input checked={sameForAll} onChange={toggleSameForAll} type="checkbox" />Use the first step's person for all steps</label>{mappingError ? <Notice tone="danger">{mappingError}</Notice> : null}<div className="max-h-[55dvh] space-y-3 overflow-y-auto pr-1">{steps.map((stage, index) => <article className="rounded-2xl border border-gold/20 bg-charcoal/60 p-4" key={stage.key}><div className="mb-3 flex items-center justify-between gap-3"><div><p className="font-semibold text-white">{stage.name}</p><p className="text-xs text-soft-grey">{stage.type === "form" && index === 0 ? "Process form" : "Workflow step"}</p></div><span className="rounded-full bg-gold/10 px-2 py-1 text-xs text-gold">Step {index + 1}</span></div><AssigneePicker branchNames={branchNames} departmentNames={departmentNames} label={`Assign ${stage.name}`} multiple={false} onChange={(ids) => void setAssignee(stage.key, ids[0] ?? "")} people={people} selectedIds={stage.assigneeRules.find((rule) => rule.type === "specific_user")?.userProfileId ? [stage.assigneeRules.find((rule) => rule.type === "specific_user")!.userProfileId!] : []}/><button className="mt-2 text-xs text-soft-grey underline hover:text-white" onClick={() => void setAssignee(stage.key, "")} type="button">Clear assignee</button></article>)}</div><div className="flex justify-end"><Button onClick={onClose}>Done</Button></div></div></Modal>;
}
