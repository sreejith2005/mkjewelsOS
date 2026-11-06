import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, BarChart3, GitBranch, History, ListChecks, Pause, Pencil, Play, Plus, RotateCcw, Search, Settings2, Trash2, Zap } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { ActionMenu, type ActionMenuItem } from "@/components/ActionMenu";
import { flowToDefinition } from "@/features/fms/definition";
import { loadFmsAiSettings, type FmsAiSettings } from "@/features/fms/ai/api";
import { FmsAiSettingsDialog } from "@/features/fms/ai/FmsAiSettingsDialog";
import {
  deleteFmsFlow,
  deleteFmsWorkflow,
  eraseFmsFlow,
  loadFmsBuilderData,
  loadFmsLibraryData,
  type FmsLibraryData,
  loadFmsFlowDeletionImpact,
  loadFmsWorkflowDeletionImpact,
  restoreFmsFlow,
  reviseFmsFlow,
  setFmsFlowActive,
  type FmsData,
  type FmsFlowRow,
} from "@/features/fms/api";
import { FmsFlowBuilder } from "@/features/fms/FmsFlowBuilder";
import { FmsManualStart } from "@/features/fms/FmsManualStart";
import { FmsTriggerHistory } from "@/features/fms/FmsTriggerHistory";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { FMSTasksPage } from "./FMSTasksPage";
import { FMS_TERMINAL_OUTCOME_LABELS, fmsTaskBoardPath, hasPermission, parseFmsAssignedWorkPath, type FmsLibraryOutcome } from "@jewelos/core";
import { loadFmsLibraryOutcomes } from "@jewelos/data/fms/outcomes";

type FlowState = "live" | "paused" | "draft" | "archived";
type FlowFamily = { key: string; primary: FmsFlowRow; versions: FmsFlowRow[] };
const openUrl = (path: string) => { window.history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")); };
type Filter = "all" | FlowState | "mine";

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "mine", label: "Assigned to me" },
  { id: "live", label: "Live" },
  { id: "paused", label: "Paused" },
  { id: "draft", label: "Drafts" },
  { id: "archived", label: "Archived" },
];
const STATE_STYLES: Record<FlowState, string> = {
  live: "border-gold/40 bg-gold/15 text-gold-secondary",
  paused: "border-soft-grey/40 bg-charcoal text-soft-grey",
  draft: "border-champagne/30 bg-champagne/10 text-champagne",
  archived: "border-soft-grey/30 bg-charcoal text-soft-grey",
};

const flowState = (flow: FmsFlowRow): FlowState => flow.status === "draft" ? "draft" : flow.status === "archived" ? "archived" : flow.is_active ? "live" : "paused";

export function FMSBuilderPage() {
  const { access, profile } = useAuth();
  const canManage = hasPermission(access, "fms.manage");
  // Managers, admins and super admins see the stage board; staff keep the run list.
  const canSeeTeam = hasPermission(access, "tasks.manage_team") || hasPermission(access, "tasks.view_all");
  const [data, setData] = useState<FmsLibraryData>();
  const [builderData, setBuilderData] = useState<FmsData>();
  const refreshRequest = useRef(0);
  const builderRequest = useRef(0);
  const editorOpen = useRef(false);
  // Server-counted runs and outcomes per workflow family; the library never downloads the runtime.
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, FmsLibraryOutcome>>();
  const [outcomesPending, setOutcomesPending] = useState(true);
  const [outcomesError, setOutcomesError] = useState(false);
  const countsAvailable = outcomes !== undefined && !outcomesError;
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [edit, setEdit] = useState<FmsFlowRow | null | undefined>();
  const [tasksFor, setTasksFor] = useState<FlowFamily | "all" | null>(() => parseFmsAssignedWorkPath(window.location.href) ? "all" : null);
  // A work link opens that run directly.
  const [linkedInstanceId] = useState(() => { const link = parseFmsAssignedWorkPath(window.location.href); return link && "instanceId" in link ? link.instanceId : ""; });
  const [busyId, setBusyId] = useState<string | null>(null);
  /** The workflow whose older versions are shown under its row. */
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  // The assistant is optional: its settings read as "all off" on any error.
  const [aiSettings, setAiSettings] = useState<FmsAiSettings | null>(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [manualStart, setManualStart] = useState<FmsFlowRow | null>(null);
  useEffect(() => { if (canManage) void loadFmsAiSettings().then(setAiSettings); }, [canManage]);

  const refresh = useCallback(async () => {
    const request = ++refreshRequest.current;
    setError(null);
    // Optional counts must not hold the workflow list behind a runtime aggregation.
    setOutcomesPending(true);
    void loadFmsLibraryOutcomes().then((counts) => {
      if (request === refreshRequest.current) { setOutcomes(counts); setOutcomesError(false); }
    }).catch(() => {
      if (request === refreshRequest.current) setOutcomesError(true);
    }).finally(() => { if (request === refreshRequest.current) setOutcomesPending(false); });
    try {
      const authoringRequest = editorOpen.current ? ++builderRequest.current : null;
      const [library, builder] = await Promise.all([
        loadFmsLibraryData(),
        authoringRequest === null ? Promise.resolve(undefined) : loadFmsBuilderData(),
      ]);
      if (request === refreshRequest.current) setData(library);
      if (authoringRequest === builderRequest.current && builder) setBuilderData(builder);
    } catch (caught) {
      if (request === refreshRequest.current) setError(caught instanceof Error ? caught.message : "Unable to load FMS");
    }
  }, []);
  useEffect(() => {
    void refresh();
    return () => { ++refreshRequest.current; ++builderRequest.current; };
  }, [refresh]);

  const closeBuilder = () => { editorOpen.current = false; ++builderRequest.current; setEdit(undefined); setBuilderData(undefined); };
  const openBuilder = async (flow: FmsFlowRow | null) => {
    const request = ++builderRequest.current;
    editorOpen.current = false;
    setError(null); setBuilderData(undefined); setEdit(flow);
    try {
      const builder = await loadFmsBuilderData();
      if (request !== builderRequest.current) return;
      editorOpen.current = true;
      setBuilderData(builder);
      setEdit(flow ? builder.flows.find((item) => item.id === flow.id) ?? flow : null);
    } catch (caught) {
      if (request !== builderRequest.current) return;
      editorOpen.current = false; setEdit(undefined);
      setError(caught instanceof Error ? caught.message : "Unable to load FMS builder");
    }
  };
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["fms", "forms", "organization"], refresh });

  const families = useMemo<FlowFamily[]>(() => {
    const grouped = new Map<string, FmsFlowRow[]>();
    for (const flow of data?.flows ?? []) grouped.set(flow.family_id, [...(grouped.get(flow.family_id) ?? []), flow]);
    return [...grouped.entries()].map(([key, rows]) => {
      const versions = [...rows].sort((left, right) => right.version - left.version);
      const primary = versions.find((flow) => flow.status === "published") ?? versions.find((flow) => flow.status === "draft") ?? versions[0]!;
      return { key, primary, versions };
    }).sort((left, right) => left.primary.name.localeCompare(right.primary.name));
  }, [data]);

  // The task board links here (`/fms?runs=<family>`) to open a workflow's runs and outcomes.
  useEffect(() => {
    const runs = new URLSearchParams(window.location.search).get("runs");
    if (!runs) return;
    const family = families.find((item) => item.key === runs);
    if (!family) return;
    setTasksFor(family);
    window.history.replaceState(window.history.state, "", window.location.pathname);
  }, [families]);
  const countsFor = useCallback((family: FlowFamily) => {
    const row = outcomes?.get(family.key);
    return { running: (row?.running ?? 0) + (row?.onHold ?? 0), completed: row?.completed ?? 0, mine: row?.mine ?? 0, won: row?.won ?? 0, lost: row?.lost ?? 0,
      other: (row?.doNotContact ?? 0) + (row?.other ?? 0) + (row?.unspecified ?? 0) };
  }, [outcomes]);

  const visible = useMemo(() => families.filter((family) => {
    if (!`${family.primary.name} ${family.primary.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === "all") return true;
    if (filter === "mine") return countsFor(family).mine > 0;
    return family.versions.some((flow) => flowState(flow) === filter);
  }), [countsFor, families, filter, query]);


  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id); setError(null); setNotice(null);
    try { await action(); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Action failed"); }
    finally { setBusyId(null); }
  };



  const revise = (flow: FmsFlowRow) => {
    const request = ++builderRequest.current;
    return run(flow.id, async () => {
      const draftId = await reviseFmsFlow(flow.id);
      const builder = await loadFmsBuilderData();
      if (request !== builderRequest.current) return;
      const draft = builder.flows.find((item) => item.id === draftId);
      if (draft) { editorOpen.current = true; setBuilderData(builder); setEdit(draft); }
    });
  };

  // The card's Delete removes the whole workflow, every version included.
  const removeWorkflow = (family: FlowFamily) => void run(family.primary.id, async () => {
    const impact = await loadFmsWorkflowDeletionImpact(family.key);
    const label = `"${impact.name}"`;
    const versions = `${impact.versions} version${impact.versions === 1 ? "" : "s"}`;
    const runs = `${impact.runs} run${impact.runs === 1 ? "" : "s"}`;
    const handoffs = impact.handoffsFrom.length ? `\n\nThese workflows hand off to it and will stop doing so: ${impact.handoffsFrom.join(", ")}.` : "";
    if (impact.action === "denied") throw new Error(`${label} is archived and has ${runs}. Only a super admin can delete it permanently.`);
    if (impact.action === "erase") {
      const typed = window.prompt(`Permanently delete the whole workflow ${label}?\n\nThis removes all ${versions} and ${runs}${impact.openRuns ? ` (${impact.openRuns} still open)` : ""}, with their steps, checklists, uploads, outcomes and alerts. Form answers stay in Forms. This cannot be undone.${handoffs}\n\nType DELETE to confirm.`);
      if (typed === null) return;
      if (typed.trim() !== "DELETE") throw new Error("Nothing was deleted. Type DELETE in capital letters to confirm.");
      await deleteFmsWorkflow(family.key, "DELETE");
      setNotice(`${label} was deleted: ${versions} and ${runs}.`);
      return;
    }
    const permanent = impact.action === "delete";
    if (!window.confirm(permanent ? `Delete the whole workflow ${label} (${versions}) permanently? It has never been run.${handoffs}` : `${label} has ${runs}, so all its versions will be archived to keep the history. Only a super admin can delete it permanently. Continue?`)) return;
    const outcome = await deleteFmsWorkflow(family.key);
    setNotice(outcome === "deleted" ? `${label} was deleted.` : `${label} was archived.`);
  });

  // A bin under Version history removes just that version.
  const remove =(flow: FmsFlowRow) => void run(flow.id, async () => {
    const impact = await loadFmsFlowDeletionImpact(flow.id);
    const label = `"${impact.name}" v${impact.version}`;
    const runs = `${impact.runs} run${impact.runs === 1 ? "" : "s"}`;
    const handoffs = impact.handoffsFrom.length ? `\n\nThese workflows hand off to it and will stop doing so: ${impact.handoffsFrom.join(", ")}.` : "";
    if (impact.action === "denied") throw new Error(`${label} is already archived and has ${runs}. Only a super admin can delete it permanently.`);
    if (impact.action === "erase") {
      const typed = window.prompt(`Permanently delete ${label}?\n\nThis erases ${runs}${impact.openRuns ? ` (${impact.openRuns} still open)` : ""} with their steps, checklists, uploads and outcomes. Form answers stay in Forms. This cannot be undone. To keep the history instead, cancel and use Pause.${handoffs}\n\nType DELETE to confirm.`);
      if (typed === null) return;
      if (typed.trim() !== "DELETE") throw new Error("Nothing was deleted. Type DELETE in capital letters to confirm.");
      await eraseFmsFlow(flow.id, "DELETE");
      setNotice(`${label} and its ${runs} were deleted.`);
      return;
    }
    const permanent = impact.action === "delete";
    if (!window.confirm(permanent ? `Delete ${label} permanently? It has never been run.${handoffs}` : `${label} has ${runs}, so it will be archived to keep its history. Continue?`)) return;
    await deleteFmsFlow(flow.id);
    setNotice(permanent ? `${label} was deleted.` : `${label} was archived.`);
  });

  const toggleActive = (flow: FmsFlowRow) => {
    if (flow.is_active && !window.confirm(`Pause "${flow.name}"? Running instances continue, but nobody can start it again until you resume.`)) return;
    void run(flow.id, () => setFmsFlowActive(flow.id, !flow.is_active));
  };

  const publishedFor = (flow: FmsFlowRow | null) => {
    if (!flow || !builderData) return null;
    const published = builderData.flows.find((item) => item.family_id === flow.family_id && item.status === "published" && item.id !== flow.id);
    return published ? flowToDefinition(published, builderData) : null;
  };
  const aiEnabled = !!aiSettings && (aiSettings.debuggerEnabled || aiSettings.builderEnabled);

  if (edit !== undefined) return (
    <section>
      {/* The builder carries its own Back to FMS control in its toolbar and details screen. */}
      {builderData ? <FmsFlowBuilder data={builderData} flow={edit} canManageForms={hasPermission(access, "forms.manage")} onClose={closeBuilder} onSaved={refresh}
        {...(aiSettings && aiEnabled ? { ai: { settings: aiSettings, published: publishedFor(edit) } } : {})} />
        : <><Button onClick={closeBuilder} variant="ghost"><ArrowLeft className="size-4" />Back to FMS</Button><p role="status" className="p-4 text-soft-grey">Loading workflow editor...</p></> }
    </section>
  );

  if (tasksFor) return (
    <section className="mx-auto w-full max-w-7xl space-y-4">
      <Button onClick={() => { setTasksFor(null); void refresh(); }} variant="ghost"><ArrowLeft className="size-4" />Back to FMS</Button>
      <FMSTasksPage
        key={tasksFor === "all" ? "linked" : tasksFor.key}
        people={data?.users ?? []}
        {...(tasksFor === "all" ? { initialInstanceId: linkedInstanceId } : { familyId: tasksFor.key, workflowName: tasksFor.primary.name, versions: tasksFor.versions })}
      />
    </section>
  );

  return (
    <section className="mx-auto w-full max-w-[110rem] space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded-xl bg-gold-sheen p-2.5 text-on-gold shadow-gold"><GitBranch className="size-5" /></span>
          <div className="min-w-0">
            <h1 className="font-display text-[1.75rem] font-semibold leading-tight text-gold-secondary sm:text-[2rem]">FMS</h1>
            <p className="text-sm text-soft-grey">Start a workflow, run its tasks, edit, pause, or remove it.</p>
          </div>
        </div>
        {canManage ? <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {aiSettings?.canConfigure ? <Button aria-label="AI assistant settings" onClick={() => setAiSettingsOpen(true)} variant="secondary"><Settings2 className="size-4" /><span className="hidden sm:inline">AI assistant</span></Button> : null}
          <Button aria-label="Trigger history" onClick={() => setHistoryOpen(true)} variant="secondary"><Zap className="size-4" /><span className="hidden sm:inline">Trigger history</span></Button>
          <Button className="flex-1 sm:flex-none" onClick={() => void openBuilder(null)}><Plus className="size-4" />New workflow</Button>
        </div> : null}
      </header>
      {historyOpen ? <FmsTriggerHistory onClose={() => setHistoryOpen(false)} /> : null}
      {manualStart ? <FmsManualStart flow={manualStart} onClose={() => setManualStart(null)} onStarted={() => void refresh()} /> : null}
      {aiSettingsOpen && aiSettings ? <FmsAiSettingsDialog onClose={() => setAiSettingsOpen(false)} onSaved={setAiSettings} settings={aiSettings} /> : null}

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <label className="relative block lg:w-[26rem]">
          <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-soft-grey" />
          <input aria-label="Search workflows" className="field min-h-11 pl-10" enterKeyHint="search" onChange={(event) => setQuery(event.target.value)} placeholder="Search workflows..." type="search" value={query} />
        </label>
        <div aria-label="Workflow status" className="scroll-x no-scrollbar -mx-1 flex gap-1.5 px-1" role="group">
          {FILTERS.map((item) => (
            <button
              aria-pressed={filter === item.id}
              className={filter === item.id ? "min-h-11 shrink-0 rounded-full border border-gold bg-gold px-4 text-sm font-semibold text-on-gold" : "min-h-11 shrink-0 rounded-full border border-task-border bg-task-bg px-4 text-sm font-semibold text-champagne hover:border-gold/50 hover:bg-gold/10"}
              key={item.id}
              onClick={() => setFilter(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <Notice tone="danger">{error} <button className="underline" onClick={() => void refresh()} type="button">Retry</button></Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {!data ? <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3"><div className="skeleton h-48 rounded-2xl" /><div className="skeleton h-48 rounded-2xl" /></div>
        : filter === "mine" && !countsAvailable ? outcomesPending ? <p role="status" className="p-4 text-soft-grey">Loading assigned workflow counts...</p> : <Notice>Workflow counts are unavailable. <button className="underline" onClick={() => void refresh()} type="button">Retry</button></Notice>
        : visible.length === 0 ? <Notice>No workflows match this view.{canManage ? " Create one with New workflow." : ""}</Notice>
        : <div className="-mx-4 border-y border-task-border bg-task-bg sm:-mx-6">
          <div aria-hidden className="hidden grid-cols-[minmax(0,1fr)_7.5rem_minmax(14rem,0.8fr)_auto] gap-4 border-b border-task-border bg-task-muted px-6 py-2 text-xs font-semibold uppercase tracking-wide text-task-text-muted lg:grid">
            <span>Workflow</span><span>Status</span><span>Runs</span><span className="text-right">Actions</span>
          </div>
          <ul className="divide-y divide-task-border">
          {visible.map((family) => {
            const flow = family.primary;
            const state = flowState(flow);
            const counts = countsFor(family);
            const draft = family.versions.find((item) => item.status === "draft");
            const busy = family.versions.some((item) => item.id === busyId);
            const older = family.versions.filter((item) => item.id !== flow.id && item.id !== draft?.id);
            const historyOpen = openHistory === family.key;
            const canStart = flow.start_mode === "manual" && flow.status === "published" && flow.is_active;
            // One row per workflow: name and a short description, status, run counts, then the
            // actions in a fixed place. Less frequent actions sit in the row's "⋯" menu.
            const more: ActionMenuItem[] = canManage ? [
              ...(flow.status === "published" ? [{ label: flow.is_active ? "Pause" : "Resume", icon: flow.is_active ? Pause : Play, onSelect: () => toggleActive(flow), disabled: busy }] : []),
              ...(state === "archived" ? [{ label: "Restore", icon: RotateCcw, onSelect: () => void run(flow.id, () => restoreFmsFlow(flow.id)), disabled: busy }] : []),
              ...(older.length ? [{ label: historyOpen ? "Hide version history" : `Version history (${older.length})`, icon: History, onSelect: () => setOpenHistory(historyOpen ? null : family.key) }] : []),
              { label: `Delete ${flow.name}`, icon: Trash2, onSelect: () => removeWorkflow(family), disabled: busy, danger: true },
            ] : [];
            return (
              <li key={family.key}>
                <article aria-label={flow.name} className="grid gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-gold/5 sm:px-6 lg:grid-cols-[minmax(0,1fr)_7.5rem_minmax(14rem,0.8fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <h2 className="min-w-0 truncate text-[15px] font-semibold leading-snug text-white" title={flow.name}>{flow.name}</h2>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase lg:hidden ${STATE_STYLES[state]}`}>{state}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-soft-grey">
                      {flow.start_mode === "automatic" ? <span className="inline-flex items-center gap-1 text-gold-secondary"><Zap className="size-3" />Starts automatically</span> : flow.start_mode === "manual" ? <span className="text-gold-secondary">Manual start</span> : null}
                      <span>v{flow.version} · used {flow.usage_count} times</span>
                      {draft && draft.id !== flow.id ? <span className="text-champagne">· draft v{draft.version} in progress</span> : null}
                    </div>
                    <FlowDescription text={flow.description} />
                  </div>
                  <div className="hidden lg:block"><span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold uppercase ${STATE_STYLES[state]}`}>{state}</span></div>
                  <dl aria-busy={outcomesPending} aria-label={`${flow.name} counts`} className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    {([["Running", counts.running, "text-gold-secondary"], [FMS_TERMINAL_OUTCOME_LABELS.won, counts.won, "text-success"], [FMS_TERMINAL_OUTCOME_LABELS.lost, counts.lost, "text-danger"], ["Other endings", counts.other, "text-champagne"]] as const).map(([label, value, tone]) =>
                      <div className={`flex gap-1 ${tone}`} key={label}><dt className="text-soft-grey">{label}</dt><dd className="font-semibold tabular-nums">{countsAvailable ? value : outcomesPending ? "…" : "—"}</dd></div>)}
                  </dl>
                  <div className="flex flex-wrap items-center gap-1.5 lg:flex-nowrap lg:justify-end">
                    {/* Managers: Tasks opens the stage board, Runs the run list. Staff: Tasks keeps the run list as before. */}
                    {canStart ? <Button className="min-h-10 px-3" onClick={() => setManualStart(flow)}><Play className="size-4" />Start</Button> : null}
                    <Button className="min-h-10 px-3" onClick={() => canSeeTeam ? openUrl(fmsTaskBoardPath(family.key)) : setTasksFor(family)} variant="secondary"><ListChecks className="size-4" />Tasks{countsAvailable && counts.mine ? ` (${counts.mine})` : ""}</Button>
                    {canSeeTeam ? <Button className="min-h-10 px-3" onClick={() => setTasksFor(family)} variant="secondary"><BarChart3 className="size-4" />Runs</Button> : null}
                    {canManage && draft ? <Button className="min-h-10 px-3" disabled={busy} onClick={() => void openBuilder(draft)} variant="secondary"><Pencil className="size-4" />Edit draft</Button> : null}
                    {canManage && !draft && flow.status !== "draft" ? <Button className="min-h-10 px-3" disabled={busy} onClick={() => void revise(flow)} variant="secondary"><Pencil className="size-4" />New version</Button> : null}
                    <ActionMenu className="ml-auto lg:ml-0" items={more} label={`More actions for ${flow.name}`} />
                  </div>
                  {canManage && older.length && historyOpen ? (
                    <div className="rounded-xl bg-task-muted/60 px-3 py-2 lg:col-span-4">
                      <p className="mb-1 text-xs font-semibold text-soft-grey">Version history ({older.length})</p>
                      <ul className="space-y-1">
                        {older.map((version) => (
                          <li className="flex flex-wrap items-center justify-between gap-2 text-xs text-soft-grey" key={version.id}>
                            <span>v{version.version} · {flowState(version)} · used {version.usage_count} times</span>
                            <span className="flex gap-1">
                              {version.status === "archived" ? <Button className="min-h-9" disabled={busyId === version.id} onClick={() => void run(version.id, () => restoreFmsFlow(version.id))} variant="ghost"><RotateCcw className="size-4" />Restore</Button> : null}
                              <Button aria-label={`Delete ${flow.name} v${version.version}`} className="size-9 min-h-9 p-0" disabled={busyId === version.id} onClick={() => remove(version)} variant="ghost"><Trash2 className="size-4" /></Button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
          </ul>
        </div>}
    </section>
  );
}

/** One line of description; the full text opens in place, so long descriptions never move the row's actions. */
function FlowDescription({ text }: { text: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > 90 || text.includes("\n");
  return <div className="mt-0.5 text-xs text-soft-grey">
    <p className={open ? "whitespace-pre-wrap break-words" : "line-clamp-1 break-words"}>{text}</p>
    {long ? <button aria-expanded={open} className="mt-0.5 text-xs font-semibold text-gold-secondary hover:underline" onClick={() => setOpen((value) => !value)} type="button">{open ? "Show less" : "Show full description"}</button> : null}
  </div>;
}
