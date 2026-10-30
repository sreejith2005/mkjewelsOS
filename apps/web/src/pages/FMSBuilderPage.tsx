import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, GitBranch, ListChecks, Pause, Pencil, Play, Plus, RotateCcw, Search, Settings2, Trash2 } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { flowToDefinition } from "@/features/fms/definition";
import { loadFmsAiSettings, type FmsAiSettings } from "@/features/fms/ai/api";
import { FmsAiSettingsDialog } from "@/features/fms/ai/FmsAiSettingsDialog";
import {
  deleteFmsFlow,
  loadFmsBuilderData,
  restoreFmsFlow,
  reviseFmsFlow,
  setFmsFlowActive,
  type FmsData,
  type FmsFlowRow,
} from "@/features/fms/api";
import { FmsFlowBuilder } from "@/features/fms/FmsFlowBuilder";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { FMSTasksPage } from "./FMSTasksPage";
import { FMS_TERMINAL_OUTCOME_LABELS, hasPermission, parseFmsAssignedWorkPath, type FmsLibraryOutcome } from "@jewelos/core";
import { loadFmsLibraryOutcomes } from "@jewelos/data/fms/outcomes";

type FlowState = "live" | "paused" | "draft" | "archived";
type FlowFamily = { key: string; primary: FmsFlowRow; versions: FmsFlowRow[] };
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
  const [data, setData] = useState<FmsData>();
  // Server-counted runs and outcomes per workflow family; the library never downloads the runtime.
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, FmsLibraryOutcome>>();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [edit, setEdit] = useState<FmsFlowRow | null | undefined>();
  const [tasksFor, setTasksFor] = useState<FlowFamily | "all" | null>(() => parseFmsAssignedWorkPath(window.location.href) ? "all" : null);
  // A work link opens that run directly.
  const [linkedInstanceId] = useState(() => { const link = parseFmsAssignedWorkPath(window.location.href); return link && "instanceId" in link ? link.instanceId : ""; });
  const [busyId, setBusyId] = useState<string | null>(null);
  // The assistant is optional: its settings read as "all off" on any error.
  const [aiSettings, setAiSettings] = useState<FmsAiSettings | null>(null);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  useEffect(() => { if (canManage) void loadFmsAiSettings().then(setAiSettings); }, [canManage]);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [builder, counts] = await Promise.all([loadFmsBuilderData(), loadFmsLibraryOutcomes().catch(() => undefined)]);
      setData(builder);
      setOutcomes(counts);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load FMS"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
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



  const revise = (flow: FmsFlowRow) => run(flow.id, async () => {
    const draftId = await reviseFmsFlow(flow.id);
    const builder = await loadFmsBuilderData();
    setData(builder);
    const draft = builder.flows.find((item) => item.id === draftId);
    if (draft) setEdit(draft);
  });

  const remove = (flow: FmsFlowRow) => {
    const permanent = flow.status === "draft";
    if (!window.confirm(permanent ? `Delete the draft "${flow.name}" permanently?` : `"${flow.name}" v${flow.version} has already run, so it will be archived instead of erased. Continue?`)) return;
    void run(flow.id, () => deleteFmsFlow(flow.id));
  };

  const toggleActive = (flow: FmsFlowRow) => {
    if (flow.is_active && !window.confirm(`Pause "${flow.name}"? Running instances continue, but nobody can start it again until you resume.`)) return;
    void run(flow.id, () => setFmsFlowActive(flow.id, !flow.is_active));
  };

  const publishedFor = (flow: FmsFlowRow | null) => {
    if (!flow || !data) return null;
    const published = data.flows.find((item) => item.family_id === flow.family_id && item.status === "published" && item.id !== flow.id);
    return published ? flowToDefinition(published, data) : null;
  };
  const aiEnabled = !!aiSettings && (aiSettings.debuggerEnabled || aiSettings.builderEnabled);

  if (edit !== undefined && data) return (
    <section>
      {/* The builder carries its own Back to FMS control in its toolbar and details screen. */}
      <FmsFlowBuilder data={data} flow={edit} canManageForms={hasPermission(access, "forms.manage")} onClose={() => setEdit(undefined)} onSaved={refresh}
        {...(aiSettings && aiEnabled ? { ai: { settings: aiSettings, published: publishedFor(edit) } } : {})} />
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
    <section className="mx-auto w-full max-w-7xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-gold/30 bg-gold/15 p-5 sm:p-6">
        <div className="flex min-w-0 items-center gap-3">
          <GitBranch className="size-7 shrink-0 text-gold-secondary" />
          <div className="min-w-0">
            <h1 className="font-display text-2xl font-semibold leading-tight text-white sm:text-[1.85rem]">FMS</h1>
            <p className="text-sm text-soft-grey">Every workflow in one place — start it, run its tasks, edit, pause, or remove it.</p>
          </div>
        </div>
        {canManage ? <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          {aiSettings?.canConfigure ? <Button aria-label="AI assistant settings" onClick={() => setAiSettingsOpen(true)} variant="secondary"><Settings2 className="size-4" /><span className="hidden sm:inline">AI assistant</span></Button> : null}
          <Button className="flex-1 sm:flex-none" onClick={() => setEdit(null)}><Plus className="size-4" />New workflow</Button>
        </div> : null}
      </header>
      {aiSettingsOpen && aiSettings ? <FmsAiSettingsDialog onClose={() => setAiSettingsOpen(false)} onSaved={setAiSettings} settings={aiSettings} /> : null}

      <label className="relative block">
        <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-soft-grey" />
        <input aria-label="Search workflows" className="field min-h-14 rounded-2xl pl-12" onChange={(event) => setQuery(event.target.value)} placeholder="Search workflows..." value={query} />
      </label>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            className={filter === item.id ? "min-h-11 rounded-full border border-gold bg-gold px-4 py-2 text-sm font-semibold text-on-gold" : "min-h-11 rounded-full border border-gold/25 px-4 py-2 text-sm font-semibold text-champagne hover:bg-gold/10"}
            key={item.id}
            onClick={() => setFilter(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? <Notice tone="danger">{error} <button className="underline" onClick={() => void refresh()} type="button">Retry</button></Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}

      {!data ? <div className="h-48 animate-pulse rounded-2xl bg-charcoal" />
        : visible.length === 0 ? <Notice>No workflows match this view.{canManage ? " Create one with New workflow." : ""}</Notice>
        : <div className="grid gap-4">
          {visible.map((family) => {
            const flow = family.primary;
            const state = flowState(flow);
            const counts = countsFor(family);
            const draft = family.versions.find((item) => item.status === "draft");
            const busy = family.versions.some((item) => item.id === busyId);
            const older = family.versions.filter((item) => item.id !== flow.id && item.id !== draft?.id);
            return (
              <article className="rounded-2xl border border-gold/20 bg-charcoal p-5" key={family.key}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-white">{flow.name}</h2>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold uppercase ${STATE_STYLES[state]}`}>{state}</span>
                      {draft && draft.id !== flow.id ? <span className="rounded-full border border-champagne/30 bg-champagne/10 px-2 py-0.5 text-xs text-champagne">draft v{draft.version} in progress</span> : null}
                    </div>
                    <p className="mt-1 text-sm text-soft-grey">{flow.description || "No description added."}</p>
                    <p className="mt-2 text-xs text-soft-grey">v{flow.version} · used {flow.usage_count} times{counts.mine ? ` · ${counts.mine} assigned to you` : ""}</p>
                    <dl aria-label={`${flow.name} counts`} className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {([["Running", counts.running, "border-gold/30 text-gold-secondary"], [FMS_TERMINAL_OUTCOME_LABELS.won, counts.won, "border-success/40 text-success"], [FMS_TERMINAL_OUTCOME_LABELS.lost, counts.lost, "border-danger/40 text-danger"], ["Other endings", counts.other, "border-champagne/30 text-champagne"]] as const).map(([label, value, tone]) =>
                        <div className={`flex gap-1 rounded-full border px-2 py-0.5 ${tone}`} key={label}><dt>{label}</dt><dd className="font-semibold tabular-nums">{value}</dd></div>)}
                    </dl>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">

                    <Button onClick={() => setTasksFor(family)} variant="secondary"><ListChecks className="size-4" />Tasks{counts.mine ? ` (${counts.mine})` : ""}</Button>
                    {canManage && draft ? <Button disabled={busy} onClick={() => setEdit(draft)} variant="secondary"><Pencil className="size-4" />Edit draft</Button> : null}
                    {canManage && !draft && flow.status !== "draft" ? <Button disabled={busy} onClick={() => void revise(flow)} variant="secondary"><Pencil className="size-4" />New version</Button> : null}
                    {canManage && flow.status === "published" ? <Button disabled={busy} onClick={() => toggleActive(flow)} variant="secondary">{flow.is_active ? <><Pause className="size-4" />Pause</> : <><Play className="size-4" />Resume</>}</Button> : null}
                    {canManage && state === "archived" ? <Button disabled={busy} onClick={() => void run(flow.id, () => restoreFmsFlow(flow.id))} variant="secondary"><RotateCcw className="size-4" />Restore</Button> : null}
                    {canManage ? <Button aria-label={`Delete ${flow.name}`} disabled={busy} onClick={() => remove(flow)} variant="danger"><Trash2 className="size-4" /></Button> : null}
                  </div>
                </div>
                {canManage && older.length ? (
                  <details className="mt-4 border-t border-gold/10 pt-3">
                    <summary className="cursor-pointer text-xs text-soft-grey">Version history ({older.length})</summary>
                    <ul className="mt-2 space-y-2">
                      {older.map((version) => (
                        <li className="flex flex-wrap items-center justify-between gap-2 text-xs text-soft-grey" key={version.id}>
                          <span>v{version.version} · {flowState(version)} · used {version.usage_count} times</span>
                          <span className="flex gap-2">
                            {version.status === "archived" ? <Button disabled={busyId === version.id} onClick={() => void run(version.id, () => restoreFmsFlow(version.id))} variant="ghost"><RotateCcw className="size-4" />Restore</Button> : null}
                            <Button aria-label={`Delete ${flow.name} v${version.version}`} disabled={busyId === version.id} onClick={() => remove(version)} variant="ghost"><Trash2 className="size-4" /></Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>}
    </section>
  );
}
