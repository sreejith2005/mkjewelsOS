import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, CheckCircle2, FileText, Plus, Redo2, Save, Send, TestTube2, Undo2, UserRoundPlus, X } from "lucide-react";
import { normalizeFmsDefinition, validateFmsDefinition, type FmsFlowDefinition, type FmsStageDefinition } from "@jewelos/core";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { AssigneePicker } from "@/components/assignees/AssigneePicker";
import type { FmsData, FmsFlowRow } from "./api";
import { publishFmsFlow, saveFmsContextAssigneeDefault, saveFmsDraft } from "./api";
import { flowToDefinition, newFmsStage, removeFmsStage } from "./definition";
import { FmsGraphCanvas } from "./FmsGraphCanvas";
import { FmsStageEditor } from "./FmsStageEditor";
import { fmsDepartmentLabel } from "./departments";

export function FmsFlowBuilder({ flow, data, duplicate, onClose, onSaved }: { flow: FmsFlowRow | null; data: FmsData; duplicate?: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const initial = useMemo(() => { const value = flowToDefinition(flow, data); return duplicate ? { ...value, id: undefined, familyId: undefined, version: 1, lifecycle: "draft" as const, name: `${value.name} (Copy)` } : value; }, [data, duplicate, flow]);
  const [definition, setDefinition] = useState<FmsFlowDefinition>(initial);
  const [past, setPast] = useState<FmsFlowDefinition[]>([]);
  const [future, setFuture] = useState<FmsFlowDefinition[]>([]);
  const [screen, setScreen] = useState<"details" | "canvas">(flow ? "canvas" : "details");
  const [selectedKey, setSelectedKey] = useState<string | null>(initial.stages[0]?.key ?? null);
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
  /** Scope and workflow context are no longer asked for; existing values are preserved untouched. */
  const scopeSummary = normalized.scope === "branch" ? data.branches.find((branch) => branch.id === normalized.branchId)?.name ?? "one branch"
    : normalized.scope === "department" ? fmsDepartmentLabel(data.departments.find((department) => department.id === normalized.departmentId) ?? { id: "", branch_id: null, name: "one department" }, data.branches)
    : null;
  const contextDefaultAssigneeId = normalized.moduleContext ? data.contextDefaults?.find((item) => item.module_context === normalized.moduleContext)?.user_profile_id : undefined;

  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty]);

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
    if (from === to) return;
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
  const ensureFirstForm = () => { if (normalized.stages.length) return; const first = { ...newFmsStage("form", 0), key: "start_form", name: "Start form", assigneeRules: contextDefaultAssigneeId ? [{ type: "specific_user" as const, userProfileId: contextDefaultAssigneeId }] : [] }; commit({ ...definition, stages: [first] }); setSelectedKey(first.key); };
  const persist = async () => { const id = await saveFmsDraft(persistedId, normalized); setPersistedId(id); setSavedSnapshot(JSON.stringify(normalized)); await onSaved(); return id; };
  const save = async () => { setBusy("save"); setError(null); setSuccess(null); try { await persist(); setSuccess("Draft saved"); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save FMS draft"); } finally { setBusy(null); } };
  const publish = async () => { if (assignedStages.length !== assignableStages.length) { setAssigning(true); setError("Assign an owner to every step before publishing."); return; } if (issues.length) { setError("Resolve the publish-readiness issues below before publishing."); return; } setBusy("publish"); setError(null); try { const id = await persist(); await publishFmsFlow(id); await onSaved(); setSuccess("Workflow published and ready to run"); onClose(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to publish workflow"); } finally { setBusy(null); } };

  if (screen === "details") return <section className="mx-auto max-w-2xl space-y-6"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">Workflow details</p><h3 className="mt-2 text-2xl font-semibold text-white">Name this workflow</h3><p className="mt-2 text-sm text-soft-grey">The first canvas step will be a Form trigger. No Start or End nodes are needed.</p></div><div className="space-y-4 rounded-2xl border border-gold/20 bg-charcoal p-5"><Field label="Workflow name *"><input autoFocus className="field" maxLength={150} onChange={(event) => commit({ ...definition, name: event.target.value })} value={definition.name} /></Field><Field label="Purpose *"><textarea className="field min-h-24" onChange={(event) => commit({ ...definition, description: event.target.value })} value={definition.description ?? ""} /></Field>{scopeSummary ? <p className="rounded-lg border border-gold/15 bg-gold/5 p-3 text-xs text-soft-grey">Existing scope kept: {scopeSummary}. Scope is no longer part of workflow setup and stays exactly as it was saved.</p> : null}</div><Button className="ml-auto flex" disabled={!normalized.name || !normalized.description?.trim()} onClick={() => { ensureFirstForm(); setScreen("canvas"); }}>Open builder <Plus className="size-4" /></Button></section>;

  return <div className={`relative flex min-h-[calc(100dvh-8rem)] flex-col transition-[padding] ${selected ? "md:pr-[min(32rem,45vw)]" : ""}`}><header className="sticky top-0 z-40 -mx-2 mb-3 flex flex-wrap items-center gap-2 border-b border-gold/20 bg-obsidian/95 px-2 py-3 backdrop-blur"><Button onClick={onClose} type="button" variant="ghost"><ArrowLeft className="size-4" />Back</Button><div className="mr-auto min-w-0"><h2 className="truncate text-lg font-semibold text-white">{normalized.name}</h2><p className="text-xs text-soft-grey">{dirty ? "Unsaved changes" : "Draft saved"}</p></div><Button aria-label="Undo" disabled={!past.length} onClick={undo} variant="ghost"><Undo2 className="size-4" /></Button><Button aria-label="Redo" disabled={!future.length} onClick={redo} variant="ghost"><Redo2 className="size-4" /></Button><Button onClick={() => { setSuccess(issues.length ? null : "Workflow check passed"); setError(issues.length ? "Workflow check found issues. Review Publish readiness." : null); }} variant="secondary"><TestTube2 className="size-4" />Check workflow</Button><Button disabled={!!busy} onClick={() => void save()} variant="secondary"><Save className="size-4" />{busy === "save" ? "Saving..." : "Save draft"}</Button><Button disabled={!!busy || issues.length > 0} onClick={() => void publish()}><Send className="size-4" />{busy === "publish" ? "Publishing..." : "Publish"}</Button></header>
    {error ? <Notice tone="danger">{error}</Notice> : null}{success ? <Notice>{success}</Notice> : null}
    <div className="grid gap-3 xl:grid-cols-[16rem_minmax(0,1fr)]"><aside className="max-h-[calc(100dvh-13rem)] overflow-y-auto rounded-xl border border-gold/20 bg-charcoal p-3"><p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-champagne">Building blocks</p><button className="flex w-full items-center gap-3 rounded-xl border border-gold/40 bg-gold/10 p-3 text-left text-gold hover:bg-gold/20" onClick={() => add("task")} type="button"><span className="grid size-8 place-items-center rounded-lg bg-gold text-obsidian"><UserRoundPlus className="size-4" /></span><span><b className="block text-sm">Add Step</b><span className="text-[11px] text-champagne">Create the next general workflow step</span></span></button><section className="mt-5 border-t border-gold/15 pt-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-champagne">Process form</p><button className="flex w-full items-center gap-3 rounded-xl border border-gold/15 p-3 text-left hover:border-gold" onClick={() => normalized.stages[0] && setSelectedKey(normalized.stages[0].key)} type="button"><span className="grid size-8 place-items-center rounded-lg bg-champagne/20 text-champagne"><FileText className="size-4" /></span><span><b className="block text-sm text-white">{normalized.stages[0]?.formTemplateId ? data.forms.find((form) => form.id === normalized.stages[0]?.formTemplateId)?.name ?? "Form attached" : "None attached"}</b><span className="text-[11px] text-soft-grey">Configure the initial details form</span></span></button></section><section className="mt-5 border-t border-gold/15 pt-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-champagne">Default assignees</p><button className="flex w-full items-center gap-3 rounded-xl border border-gold/15 p-3 text-left hover:border-gold" onClick={() => setAssigning(true)} type="button"><span className="grid size-8 place-items-center rounded-lg bg-champagne/20 text-champagne"><UserRoundPlus className="size-4" /></span><span><b className="block text-sm text-white">{assignableStages.length ? `${assignedStages.length}/${assignableStages.length} assigned` : "No steps yet"}</b><span className="text-[11px] text-soft-grey">Pre-assign users after building the flow</span></span></button></section><p className="mt-5 border-t border-gold/15 pt-3 text-[11px] text-soft-grey">The initial Form starts the workflow. The final unconnected step completes it.</p></aside><FmsGraphCanvas definition={normalized} invalidKeys={invalidKeys} onAddAfter={(key) => add("task", key)} onConnect={connect} onDelete={remove} onDisconnect={disconnect} onDuplicate={duplicateStage} onMove={moveStages} onReconnect={reconnect} onSelect={setSelectedKey} selectedKey={selected?.key ?? null} /></div>
    {selected ? <aside className="fixed inset-x-0 bottom-[70px] z-50 max-h-[70dvh] overflow-y-auto overscroll-contain rounded-t-2xl border border-gold/30 bg-obsidian p-4 shadow-2xl md:bottom-0 md:left-auto md:top-16 md:max-h-none md:w-[min(32rem,45vw)] md:rounded-none md:border-y-0 md:border-r-0"><div className="mb-4 flex items-center justify-between"><div><p className="text-xs text-gold">{selected.type.replaceAll("_", " ")}</p><h3 className="text-lg font-semibold text-white">{selected.name}</h3></div><Button aria-label="Close inspector" onClick={() => setSelectedKey(null)} variant="ghost"><X className="size-4" /></Button></div><FmsStageEditor data={data} onChange={(value) => { replace(selected.key, value); setSelectedKey(value.key); }} onDelete={() => remove(selected.key)} stage={selected} stages={normalized.stages} /></aside> : null}
    <section className="sticky bottom-[70px] z-30 -mx-2 mt-3 rounded-t-2xl border border-b-0 border-gold/30 bg-charcoal/95 px-4 py-3 backdrop-blur md:bottom-0"><div className="flex flex-wrap items-center gap-3"><div className="mr-auto"><p className="font-semibold text-white">Publish readiness</p><p className="text-xs text-soft-grey">{issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"} to resolve` : "Ready to publish"}</p></div>{issues.length ? <div className="hidden max-w-3xl flex-1 gap-2 overflow-x-auto md:flex">{issues.slice(0, 4).map((issue, index) => <button className="shrink-0 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-left text-xs text-danger" key={`${issue.code}-${issue.stageKey ?? index}`} onClick={() => issue.stageKey && setSelectedKey(issue.stageKey)} type="button">{issue.message}</button>)}</div> : <CheckCircle2 className="size-5 text-success" />}</div></section>
    {assigning ? <DefaultAssigneesDialog data={data} definition={normalized} onChange={(stages) => commit((current) => ({ ...current, stages }))} onClose={() => setAssigning(false)} /> : null}
  </div>;
}

function DefaultAssigneesDialog({ data, definition, onChange, onClose }: { data: FmsData; definition: FmsFlowDefinition; onChange: (stages: readonly FmsStageDefinition[]) => void; onClose: () => void }) {
  const steps = definition.stages.filter((stage) => ["form", "task", "approval"].includes(stage.type));
  const [mappingError, setMappingError] = useState<string | null>(null);
  const setAssignee = async (key: string, userProfileId: string) => {
    onChange(definition.stages.map((stage) => stage.key !== key ? stage : { ...stage, assigneeRules: userProfileId ? [{ type: "specific_user", userProfileId }] : [] }));
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
  return <Modal onClose={onClose} title="Default assignees" wide><div className="space-y-4"><p className="text-sm text-soft-grey">Pre-assign a named person to each workflow step. Workflow scope remains independent from the selected person.{definition.moduleContext ? " Selecting a person also saves that context's default from the existing Users directory; individual stages remain editable." : ""}</p>{mappingError ? <Notice tone="danger">{mappingError}</Notice> : null}<div className="max-h-[55dvh] space-y-3 overflow-y-auto pr-1">{steps.map((stage, index) => <article className="rounded-2xl border border-gold/20 bg-charcoal/60 p-4" key={stage.key}><div className="mb-3 flex items-center justify-between gap-3"><div><p className="font-semibold text-white">{stage.name}</p><p className="text-xs text-soft-grey">{stage.type === "form" && index === 0 ? "Process form" : "Workflow step"}</p></div><span className="rounded-full bg-gold/10 px-2 py-1 text-xs text-gold">Step {index + 1}</span></div><AssigneePicker branchNames={branchNames} departmentNames={departmentNames} label={`Assign ${stage.name}`} multiple={false} onChange={(ids) => void setAssignee(stage.key, ids[0] ?? "")} people={people} selectedIds={stage.assigneeRules.find((rule) => rule.type === "specific_user")?.userProfileId ? [stage.assigneeRules.find((rule) => rule.type === "specific_user")!.userProfileId!] : []}/></article>)}</div><div className="flex justify-end"><Button onClick={onClose}>Done</Button></div></div></Modal>;
}
