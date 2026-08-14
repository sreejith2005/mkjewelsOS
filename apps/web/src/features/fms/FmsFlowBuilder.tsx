import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BellRing, CheckCircle2, ClipboardList, FileText, GitBranch, Layers, Merge, Plus, Redo2, Save, Search, Send, ShieldCheck, TestTube2, Undo2, X } from "lucide-react";
import { normalizeFmsDefinition, validateFmsDefinition, type FmsFlowDefinition, type FmsStageDefinition } from "@jewelos/core";
import { Button, Field, Modal, Notice } from "@/components/ui";
import type { FmsData, FmsFlowRow } from "./api";
import { publishFmsFlow, saveFmsDraft } from "./api";
import { flowToDefinition, newFmsStage, removeFmsStage } from "./definition";
import { FmsGraphCanvas } from "./FmsGraphCanvas";
import { FmsStageEditor } from "./FmsStageEditor";
import { fmsDepartmentLabel, fmsDepartmentsForBranch } from "./departments";

type PaletteItem = Readonly<{ type: FmsStageDefinition["type"]; title: string; description: string; group: "Forms" | "Work" | "Logic" | "Communication"; Icon: typeof ClipboardList }>;
const palette: readonly PaletteItem[] = [
  { type: "form", title: "Form", description: "Collect a published form", group: "Forms", Icon: FileText },
  { type: "task", title: "Task", description: "Create assigned work in Tasks", group: "Work", Icon: ClipboardList },
  { type: "approval", title: "Approval", description: "Require manager sign-off", group: "Work", Icon: ShieldCheck },
  { type: "branch", title: "Decision", description: "Route with ordered conditions", group: "Logic", Icon: GitBranch },
  { type: "parallel_start", title: "Split", description: "Start multiple paths", group: "Logic", Icon: Layers },
  { type: "parallel_join", title: "Join", description: "Wait for parallel paths", group: "Logic", Icon: Merge },
  { type: "notification", title: "Notification", description: "Send an in-app alert", group: "Communication", Icon: BellRing },
];

export function FmsFlowBuilder({ flow, data, duplicate, onClose, onSaved }: { flow: FmsFlowRow | null; data: FmsData; duplicate?: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const initial = useMemo(() => { const value = flowToDefinition(flow, data); return duplicate ? { ...value, id: undefined, familyId: undefined, version: 1, lifecycle: "draft" as const, name: `${value.name} (Copy)` } : value; }, [data, duplicate, flow]);
  const [definition, setDefinition] = useState<FmsFlowDefinition>(initial);
  const [past, setPast] = useState<FmsFlowDefinition[]>([]);
  const [future, setFuture] = useState<FmsFlowDefinition[]>([]);
  const [screen, setScreen] = useState<"details" | "canvas">(flow ? "canvas" : "details");
  const [selectedKey, setSelectedKey] = useState<string | null>(initial.stages[0]?.key ?? null);
  const [insertAfterKey, setInsertAfterKey] = useState<string | null>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [persistedId, setPersistedId] = useState(flow?.id ?? null);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(normalizeFmsDefinition(initial)));
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const normalized = useMemo(() => normalizeFmsDefinition(definition), [definition]);
  const issues = useMemo(() => validateFmsDefinition(normalized), [normalized]);
  const invalidKeys = useMemo(() => new Set(issues.flatMap((issue) => issue.stageKey ? [issue.stageKey] : [])), [issues]);
  const selected = normalized.stages.find((stage) => stage.key === selectedKey) ?? null;
  const dirty = JSON.stringify(normalized) !== savedSnapshot;
  const filteredPalette = useMemo(() => palette.filter((item) => `${item.title} ${item.description} ${item.group}`.toLowerCase().includes(paletteQuery.toLowerCase())), [paletteQuery]);

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
    const stage = { ...newFmsStage(type, normalized.stages.length), key: nextKey(), name: type === "form" && normalized.stages.length === 0 ? "Start form" : newFmsStage(type, 0).name };
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
  const connect = (from: string, to: string) => { if (from === to) return; commit((current) => ({ ...current, stages: current.stages.map((stage) => { if (stage.key !== from) return stage; if (stage.type === "branch") return { ...stage, branchRules: stage.branchRules.map((rule, index) => rule.operator === "default" || index === stage.branchRules.length - 1 ? { ...rule, nextStageKey: to, nextFlowId: undefined } : rule) }; if (stage.type === "parallel_start") return { ...stage, parallelTargetStageKeys: stage.parallelTargetStageKeys.includes(to) ? stage.parallelTargetStageKeys : [...stage.parallelTargetStageKeys, to] }; return { ...stage, defaultNextStageKey: to }; }) })); };
  const ensureFirstForm = () => { if (normalized.stages.length) return; const first = { ...newFmsStage("form", 0), key: "start_form", name: "Start form" }; commit({ ...definition, stages: [first] }); setSelectedKey(first.key); };
  const persist = async () => { const id = await saveFmsDraft(persistedId, normalized); setPersistedId(id); setSavedSnapshot(JSON.stringify(normalized)); await onSaved(); return id; };
  const save = async () => { setBusy("save"); setError(null); setSuccess(null); try { await persist(); setSuccess("Draft saved"); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save FMS draft"); } finally { setBusy(null); } };
  const publish = async () => { if (issues.length) { setError("Resolve the publish-readiness issues below before publishing."); return; } setBusy("publish"); setError(null); try { const id = await persist(); await publishFmsFlow(id); await onSaved(); setSuccess("Workflow published and ready to run"); onClose(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to publish workflow"); } finally { setBusy(null); } };

  if (screen === "details") return <section className="mx-auto max-w-2xl space-y-6"><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">Workflow details</p><h3 className="mt-2 text-2xl font-semibold text-white">Name and scope this workflow</h3><p className="mt-2 text-sm text-soft-grey">The first canvas step will be a Form trigger. No Start or End nodes are needed.</p></div><div className="space-y-4 rounded-2xl border border-gold/20 bg-charcoal p-5"><Field label="Workflow name *"><input autoFocus className="field" maxLength={150} onChange={(event) => commit({ ...definition, name: event.target.value })} value={definition.name} /></Field><Field label="Purpose *"><textarea className="field min-h-24" onChange={(event) => commit({ ...definition, description: event.target.value })} value={definition.description ?? ""} /></Field><div className="grid gap-3 sm:grid-cols-3"><Field label="Scope"><select className="field" onChange={(event) => commit({ ...definition, scope: event.target.value as FmsFlowDefinition["scope"], branchId: undefined, departmentId: undefined })} value={definition.scope}><option value="tenant">All branches</option><option value="branch">One branch</option><option value="department">One department</option></select></Field>{definition.scope !== "tenant" ? <Field label="Branch"><select className="field" onChange={(event) => commit({ ...definition, branchId: event.target.value || undefined, departmentId: undefined })} value={definition.branchId ?? ""}><option value="">Select branch</option>{data.branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></Field> : null}{definition.scope === "department" ? <Field label="Department"><select className="field" onChange={(event) => commit({ ...definition, departmentId: event.target.value || undefined })} value={definition.departmentId ?? ""}><option value="">Select department</option>{fmsDepartmentsForBranch(data.departments, definition.branchId).map((department) => <option key={department.id} value={department.id}>{fmsDepartmentLabel(department, data.branches)}</option>)}</select></Field> : null}</div></div><Button className="ml-auto flex" disabled={!normalized.name || !normalized.description?.trim()} onClick={() => { ensureFirstForm(); setScreen("canvas"); }}>Open builder <Plus className="size-4" /></Button></section>;

  return <div className="relative min-h-[calc(100dvh-8rem)] pb-24"><header className="sticky top-0 z-40 -mx-2 mb-3 flex flex-wrap items-center gap-2 border-b border-gold/20 bg-obsidian/95 px-2 py-3 backdrop-blur"><Button onClick={onClose} type="button" variant="ghost"><ArrowLeft className="size-4" />Back</Button><div className="mr-auto min-w-0"><h2 className="truncate text-lg font-semibold text-white">{normalized.name}</h2><p className="text-xs text-soft-grey">{dirty ? "Unsaved changes" : "Draft saved"}</p></div><Button aria-label="Undo" disabled={!past.length} onClick={undo} variant="ghost"><Undo2 className="size-4" /></Button><Button aria-label="Redo" disabled={!future.length} onClick={redo} variant="ghost"><Redo2 className="size-4" /></Button><Button onClick={() => { setSuccess(issues.length ? null : "Workflow check passed"); setError(issues.length ? "Workflow check found issues. Review Publish readiness." : null); }} variant="secondary"><TestTube2 className="size-4" />Check workflow</Button><Button disabled={!!busy} onClick={() => void save()} variant="secondary"><Save className="size-4" />{busy === "save" ? "Saving..." : "Save draft"}</Button><Button disabled={!!busy || issues.length > 0} onClick={() => void publish()}><Send className="size-4" />{busy === "publish" ? "Publishing..." : "Publish"}</Button></header>
    {error ? <Notice tone="danger">{error}</Notice> : null}{success ? <Notice>{success}</Notice> : null}
    <div className="grid gap-3 xl:grid-cols-[16rem_minmax(0,1fr)]"><aside className="max-h-[calc(100dvh-13rem)] overflow-y-auto rounded-xl border border-gold/20 bg-charcoal p-3"><label className="relative block"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-soft-grey" /><input className="field pl-9" onChange={(event) => setPaletteQuery(event.target.value)} placeholder="Search steps" value={paletteQuery} /></label>{(["Forms", "Work", "Logic", "Communication"] as const).map((group) => { const items = filteredPalette.filter((item) => item.group === group); return items.length ? <section className="mt-4" key={group}><p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-gold">{group}</p><div className="space-y-1.5">{items.map(({ type, title, description, Icon }) => <button className="flex w-full gap-2 rounded-lg border border-gold/15 p-2.5 text-left hover:border-gold hover:bg-gold/5" key={type} onClick={() => add(type)} type="button"><Icon className="mt-0.5 size-4 shrink-0 text-gold" /><span><b className="block text-sm text-white">{title}</b><span className="text-[11px] text-soft-grey">{description}</span></span></button>)}</div></section> : null; })}<p className="mt-4 border-t border-gold/15 pt-3 text-[11px] text-soft-grey">The first step is always a Form. A path completes wherever its last step has no outgoing connection.</p></aside><FmsGraphCanvas definition={normalized} invalidKeys={invalidKeys} onAddAfter={setInsertAfterKey} onConnect={connect} onDelete={remove} onDuplicate={duplicateStage} onSelect={setSelectedKey} selectedKey={selected?.key ?? null} /></div>
    {selected ? <aside className="fixed inset-x-0 bottom-0 z-50 max-h-[78dvh] overflow-y-auto rounded-t-2xl border border-gold/30 bg-obsidian p-4 shadow-2xl sm:inset-y-0 sm:left-auto sm:w-[32rem] sm:max-h-none sm:rounded-none sm:border-y-0 sm:border-r-0"><div className="mb-4 flex items-center justify-between"><div><p className="text-xs text-gold">{selected.type.replaceAll("_", " ")}</p><h3 className="text-lg font-semibold text-white">{selected.name}</h3></div><Button aria-label="Close inspector" onClick={() => setSelectedKey(null)} variant="ghost"><X className="size-4" /></Button></div><FmsStageEditor data={data} flowBranchId={normalized.branchId} onChange={(value) => { replace(selected.key, value); setSelectedKey(value.key); }} onDelete={() => remove(selected.key)} stage={selected} stages={normalized.stages} /></aside> : null}
    {insertAfterKey ? <Modal onClose={() => setInsertAfterKey(null)} title="Choose the next step"><div className="grid gap-2">{palette.map(({ type, title, description, Icon }) => <button className="flex gap-3 rounded-xl border border-gold/20 p-3 text-left hover:border-gold" key={type} onClick={() => { add(type, insertAfterKey); setInsertAfterKey(null); }} type="button"><Icon className="size-5 text-gold" /><span><b className="block text-white">{title}</b><span className="text-xs text-soft-grey">{description}</span></span></button>)}</div></Modal> : null}
    <section className="fixed inset-x-0 bottom-0 z-30 border-t border-gold/30 bg-charcoal/95 px-4 py-3 backdrop-blur"><div className="mx-auto flex max-w-[96rem] items-center gap-3"><div className="mr-auto"><p className="font-semibold text-white">Publish readiness</p><p className="text-xs text-soft-grey">{issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"} to resolve` : "Ready to publish"}</p></div>{issues.length ? <div className="hidden max-w-3xl flex-1 gap-2 overflow-x-auto md:flex">{issues.slice(0, 4).map((issue, index) => <button className="shrink-0 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-left text-xs text-danger" key={`${issue.code}-${issue.stageKey ?? index}`} onClick={() => issue.stageKey && setSelectedKey(issue.stageKey)} type="button">{issue.message}</button>)}</div> : <CheckCircle2 className="size-5 text-success" />}</div></section>
  </div>;
}
