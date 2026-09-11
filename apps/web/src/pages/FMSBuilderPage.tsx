import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, GitBranch, ListChecks, Pause, Pencil, Play, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import {
  deleteFmsFlow,
  loadFmsBuilderData,
  loadFmsRuntime,
  restoreFmsFlow,
  reviseFmsFlow,
  setFmsFlowActive,
  startFmsInstance,
  type FmsData,
  type FmsFlowRow,
} from "@/features/fms/api";
import { parseFmsFormDeepLink } from "@/features/fms/deepLink";
import { FmsFlowBuilder } from "@/features/fms/FmsFlowBuilder";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { FMSTasksPage } from "./FMSTasksPage";
import { hasPermission } from "@jewelos/core";

type Runtime = Awaited<ReturnType<typeof loadFmsRuntime>>;
type FlowState = "live" | "paused" | "draft" | "archived";
type FlowFamily = { key: string; primary: FmsFlowRow; versions: FmsFlowRow[]; flowIds: string[] };
type Filter = "all" | FlowState | "mine";

const OPEN_STAGE_STATUSES = ["pending", "in_progress", "in_review", "overdue"];
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "mine", label: "Assigned to me" },
  { id: "live", label: "Live" },
  { id: "paused", label: "Paused" },
  { id: "draft", label: "Drafts" },
  { id: "archived", label: "Archived" },
];
const STATE_STYLES: Record<FlowState, string> = {
  live: "border-gold/40 bg-gold/15 text-gold",
  paused: "border-soft-grey/40 bg-charcoal text-soft-grey",
  draft: "border-champagne/30 bg-champagne/10 text-champagne",
  archived: "border-soft-grey/30 bg-charcoal text-soft-grey",
};

const flowState = (flow: FmsFlowRow): FlowState => flow.status === "draft" ? "draft" : flow.status === "archived" ? "archived" : flow.is_active ? "live" : "paused";

export function FMSBuilderPage() {
  const { access, profile } = useAuth();
  const canManage = hasPermission(access, "fms.manage");
  const [data, setData] = useState<FmsData>();
  const [runtime, setRuntime] = useState<Runtime>();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [edit, setEdit] = useState<FmsFlowRow | null | undefined>();
  const [tasksFor, setTasksFor] = useState<FlowFamily | "all" | null>(() => parseFmsFormDeepLink(window.location.href) ? "all" : null);
  const [openInstanceId, setOpenInstanceId] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [builder, live] = await Promise.all([loadFmsBuilderData(), loadFmsRuntime().catch(() => undefined)]);
      setData(builder);
      setRuntime(live);
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
      const runtimeIds = (runtime?.flows ?? []).filter((flow) => flow.family_id === key).map((flow) => flow.id);
      return { key, primary, versions, flowIds: [...new Set([...versions.map((flow) => flow.id), ...runtimeIds])] };
    }).sort((left, right) => left.primary.name.localeCompare(right.primary.name));
  }, [data, runtime]);

  const countsFor = useCallback((family: FlowFamily) => {
    const instances = (runtime?.instances ?? []).filter((instance) => family.flowIds.includes(instance.fms_flow_id));
    const stages = (runtime?.stages ?? []).filter((stage) => instances.some((instance) => instance.id === stage.fms_instance_id));
    return {
      running: instances.filter((instance) => ["active", "overdue", "on_hold"].includes(instance.status)).length,
      completed: instances.filter((instance) => instance.status === "completed").length,
      mine: new Set(stages.filter((stage) => OPEN_STAGE_STATUSES.includes(stage.status) && stage.assigned_to?.includes(profile?.id ?? "")).map((stage) => stage.fms_instance_id)).size,
    };
  }, [profile?.id, runtime]);

  const visible = useMemo(() => families.filter((family) => {
    if (!`${family.primary.name} ${family.primary.description ?? ""}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
    if (filter === "all") return true;
    if (filter === "mine") return countsFor(family).mine > 0;
    return family.versions.some((flow) => flowState(flow) === filter);
  }), [countsFor, families, filter, query]);

  useEffect(() => {
    if (!openInstanceId || !runtime || tasksFor) return;
    const instance = runtime.instances.find((item) => item.id === openInstanceId);
    const family = instance ? families.find((item) => item.flowIds.includes(instance.fms_flow_id)) : undefined;
    if (family) setTasksFor(family);
  }, [families, openInstanceId, runtime, tasksFor]);

  const run = async (id: string, action: () => Promise<void>) => {
    setBusyId(id); setError(null); setNotice(null);
    try { await action(); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Action failed"); }
    finally { setBusyId(null); }
  };

  const start = (flow: FmsFlowRow) => run(flow.id, async () => {
    const stage = (data?.stages ?? []).filter((item) => item.fms_flow_id === flow.id).sort((left, right) => left.sort_order - right.sort_order)[0];
    const firstAssigneeId = (data?.assignees ?? []).find((item) => item.fms_stage_id === stage?.id && item.assignee_type === "specific_user")?.user_profile_id ?? null;
    const result = await startFmsInstance({
      flowId: flow.id,
      title: flow.name,
      priority: "medium",
      context: {},
      branchId: flow.branch_id ?? profile?.branch_id ?? "",
      departmentId: flow.department_id ?? profile?.department_id ?? "",
      firstAssigneeId,
    });
    setOpenInstanceId(result.instance_id);
    setNotice(`Started ${result.reference_number}`);
  });

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

  if (edit !== undefined && data) return (
    <section>
      <header className="mb-5 flex justify-between"><Button onClick={() => setEdit(undefined)} variant="ghost"><ArrowLeft className="size-4" />Back to FMS</Button></header>
      <FmsFlowBuilder data={data} flow={edit} onClose={() => setEdit(undefined)} onSaved={refresh} />
    </section>
  );

  if (tasksFor) return (
    <section className="mx-auto w-full max-w-7xl space-y-4">
      <Button onClick={() => { setTasksFor(null); setOpenInstanceId(""); }} variant="ghost"><ArrowLeft className="size-4" />Back to FMS</Button>
      <FMSTasksPage
        {...(tasksFor === "all" ? {} : { flowIds: tasksFor.flowIds, heading: `${tasksFor.primary.name} — live instances` })}
        {...(openInstanceId ? { initialInstanceId: openInstanceId } : {})}
      />
    </section>
  );

  return (
    <section className="mx-auto w-full max-w-7xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-gold/30 bg-gold/15 p-5 sm:p-6">
        <div className="flex min-w-0 items-center gap-3">
          <GitBranch className="size-7 shrink-0 text-gold" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-white sm:text-2xl">FMS</h1>
            <p className="text-sm text-soft-grey">Every workflow in one place — start it, run its tasks, edit, pause, or remove it.</p>
          </div>
        </div>
        {canManage ? <Button className="w-full sm:w-auto" onClick={() => setEdit(null)}><Plus className="size-4" />New workflow</Button> : null}
      </header>

      <label className="relative block">
        <Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-soft-grey" />
        <input aria-label="Search workflows" className="field min-h-14 rounded-2xl pl-12" onChange={(event) => setQuery(event.target.value)} placeholder="Search workflows..." value={query} />
      </label>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((item) => (
          <button
            className={filter === item.id ? "min-h-11 rounded-full border border-gold bg-gold px-4 py-2 text-sm font-semibold text-obsidian" : "min-h-11 rounded-full border border-gold/25 px-4 py-2 text-sm font-semibold text-champagne hover:bg-gold/10"}
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
                    <p className="mt-2 text-xs text-soft-grey">v{flow.version} · used {flow.usage_count} times · {counts.running} running · {counts.completed} completed{counts.mine ? ` · ${counts.mine} assigned to you` : ""}</p>
                  </div>
                  <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
                    {state === "live" ? <Button disabled={busy} onClick={() => void start(flow)}><Play className="size-4" />Start instance</Button> : null}
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
