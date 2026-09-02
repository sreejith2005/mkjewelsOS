import { useCallback, useEffect, useMemo, useState } from "react";
import { calculateFmsProgress } from "@jewelos/core";
import { Search } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { loadFormDynamicOptions, loadForms, type FormBundle } from "@/features/forms/api";
import type { DynamicOptions } from "@/features/forms/FormRenderer";
import { FmsStageRunner } from "@/features/fms/FmsStageRunner";
import { loadFmsRuntime, setFmsInstanceStatus, type FmsInstance } from "@/features/fms/api";
import { filterFmsInstances } from "@/features/fms/runtimeView";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";

const EMPTY_OPTIONS: DynamicOptions = { users: [], branches: [], departments: [], masters: [] };
type Runtime = Awaited<ReturnType<typeof loadFmsRuntime>>;

export function FMSTasksPage({ embedded = false, query: externalQuery, initialInstanceId }: { embedded?: boolean; query?: string; initialInstanceId?: string }) {
  const { profile } = useAuth();
  const [runtime, setRuntime] = useState<Runtime>();
  const [forms, setForms] = useState<FormBundle[]>([]);
  const [formOptions, setFormOptions] = useState<DynamicOptions>(EMPTY_OPTIONS);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"mine" | "started" | "branch">("mine");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [priority, setPriority] = useState("all");
  const [overdue, setOverdue] = useState(false);
  const [selected, setSelected] = useState<FmsInstance | null>(null);
  const [openInstanceId, setOpenInstanceId] = useState(initialInstanceId ?? "");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [nextRuntime, formData, options] = await Promise.all([loadFmsRuntime(), loadForms(), loadFormDynamicOptions()]);
      setRuntime(nextRuntime);
      setForms(formData.bundles);
      setFormOptions(options);
      setSelected((current) => current ? nextRuntime.instances.find((item) => item.id === current.id) ?? null : null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load FMS tasks"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["fms", "forms", "organization"], refresh });
  useEffect(() => {
    if (!runtime || !openInstanceId) return;
    const created = runtime.instances.find((instance) => instance.id === openInstanceId);
    if (!created) return;
    setTab("started");
    setStatus("active");
    setSelected(created);
    setOpenInstanceId("");
  }, [openInstanceId, runtime]);

  const activeQuery = externalQuery ?? query;
  const instances = useMemo(() => filterFmsInstances({ instances: runtime?.instances ?? [], stages: runtime?.stages ?? [], profileId: profile?.id ?? "", tab, query: activeQuery, status, priority, overdueOnly: overdue }), [activeQuery, overdue, priority, profile?.id, runtime, status, tab]);

  if (!profile) return null;
  const canManage = ["super_admin", "admin", "manager"].includes(profile.user_role);
  const statusAction = async (instance: FmsInstance, action: "hold" | "resume" | "cancel") => {
    const reason = window.prompt(`${action} reason`);
    if (!reason || !window.confirm(`Confirm ${action} for ${instance.reference_number}?`)) return;
    setBusy(true);
    try { await setFmsInstanceStatus(instance.id, action, reason); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Status update failed"); }
    finally { setBusy(false); }
  };

  if (selected && runtime && !embedded) {
    const stages = runtime.stages.filter((stage) => stage.fms_instance_id === selected.id);
    const flow = runtime.flows.find((item) => item.id === selected.fms_flow_id);
    const progress = calculateFmsProgress(stages.map((item) => ({ required: runtime.definitions.find((definition) => definition.id === item.fms_stage_id)?.is_required ?? true, status: item.status as never })));
    const parent = selected.parent_instance_id ? runtime.instances.find((item) => item.id === selected.parent_instance_id) : null;
    const children = runtime.instances.filter((item) => item.parent_instance_id === selected.id);
    return <section className="mx-auto max-w-5xl space-y-4">
      <Button onClick={() => setSelected(null)} variant="ghost">← Back to FMS tasks</Button>
      <header className="rounded-2xl border border-gold/20 p-5">
        <div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs text-gold">{selected.reference_number}</p><h1 className="text-2xl font-semibold text-white">{selected.title}</h1><p className="text-sm text-soft-grey">{flow?.name ?? "Historical flow"} · version {selected.flow_version} · {selected.status}</p></div>{canManage ? <div className="flex flex-wrap gap-2">{selected.status === "on_hold" ? <Button disabled={busy} onClick={() => void statusAction(selected, "resume")}>Resume</Button> : selected.status === "active" || selected.status === "overdue" ? <Button disabled={busy} onClick={() => void statusAction(selected, "hold")} variant="secondary">Hold</Button> : null}{!["completed", "cancelled"].includes(selected.status) ? <Button disabled={busy} onClick={() => void statusAction(selected, "cancel")} variant="danger">Cancel</Button> : null}</div> : null}</div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-charcoal"><div className="h-full bg-gold" style={{ width: `${progress.percent}%` }} /></div><p className="mt-1 text-xs text-soft-grey">{progress.completed}/{progress.total} required stages · {progress.percent}%</p>
        {parent || children.length ? <p className="mt-2 text-xs text-soft-grey">Lineage: {parent ? `parent ${parent.reference_number}` : "root"}{children.length ? ` · children ${children.map((item) => item.reference_number).join(", ")}` : ""}</p> : null}
      </header>
      {stages.map((stage) => { const definition = runtime.definitions.find((item) => item.id === stage.fms_stage_id); return definition ? <FmsStageRunner branches={formOptions.branches} checklist={runtime.checklist.filter((item) => item.fms_instance_stage_id === stage.id)} definition={definition} definitions={runtime.definitions} departments={formOptions.departments} evidence={runtime.evidence.filter((item) => item.fms_instance_stage_id === stage.id)} formOptions={formOptions} forms={forms} instance={selected} instanceStages={stages} key={stage.id} onRefresh={refresh} profile={profile} stage={stage} users={runtime.users} /> : null; })}
      <section className="rounded-2xl border border-gold/20 p-4"><h2 className="mb-3 font-semibold">Immutable timeline</h2><ol className="space-y-2">{runtime.logs.filter((log) => stages.some((stage) => stage.id === log.fms_instance_stage_id)).map((log) => <li className="border-l border-gold/30 pl-3 text-sm" key={log.id}><b>{log.action.replaceAll("_", " ")}</b><span className="block text-xs text-soft-grey">{log.created_at ? new Date(log.created_at).toLocaleString("en-IN") : "—"} · actor {log.actor_id ?? "system"}</span>{log.details ? <code className="block overflow-x-auto text-xs text-soft-grey">{JSON.stringify(log.details)}</code> : null}</li>)}</ol></section>
    </section>;
  }

  return <section className={embedded ? "w-full" : "mx-auto max-w-7xl"}>
    <header className="mb-5"><h2 className="text-xl font-semibold text-white">Live instances</h2><p className="text-sm text-soft-grey">Processes assigned to you, started by you, or visible to your branch.</p></header>
    {error ? <div className="mb-3"><Notice tone="danger">{error} <button className="underline" onClick={() => void refresh()} type="button">Retry</button></Notice></div> : null}
    <div className="scroll-x no-scrollbar mb-4 flex gap-2">{([["mine", "My Stages"], ["started", "Started by Me"], ...(canManage ? [["branch", "Branch View"] as const] : [])] as const).map(([value, label]) => <button className={`min-h-11 shrink-0 whitespace-nowrap rounded-lg px-4 text-sm font-semibold transition ${tab === value ? "bg-gold text-obsidian" : "bg-charcoal text-champagne"}`} key={value} onClick={() => setTab(value)} type="button">{label}</button>)}</div>
    <div className="mb-5 grid gap-2 sm:grid-cols-4"><label className="relative"><Search className="absolute left-3 top-3 size-4 text-soft-grey" /><input aria-label="Search FMS instances" className="field pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Search reference or title" value={query} /></label><select aria-label="Status filter" className="field" onChange={(event) => setStatus(event.target.value)} value={status}><option value="all">All statuses</option>{["active", "overdue", "on_hold", "completed", "cancelled"].map((item) => <option key={item}>{item}</option>)}</select><select aria-label="Priority filter" className="field" onChange={(event) => setPriority(event.target.value)} value={priority}><option value="all">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select><label className="field flex items-center gap-2"><input checked={overdue} onChange={(event) => setOverdue(event.target.checked)} type="checkbox" /> Overdue only</label></div>
    <div className="mb-4 grid grid-cols-3 gap-2">{["active", "overdue", "completed"].map((item) => <div className="rounded-xl border border-gold/20 p-3 text-center" key={item}><b className="block text-xl tabular-nums text-white">{instances.filter((instance) => instance.status === item).length}</b><p className="text-xs capitalize text-soft-grey">{item}</p></div>)}</div>
    {!runtime ? <div className="h-48 animate-pulse rounded-xl bg-charcoal" /> : instances.length === 0 ? <Notice>No FMS instances match this view.</Notice> : <div className="grid gap-3 md:grid-cols-2">{instances.map((instance) => { const stages = runtime.stages.filter((stage) => stage.fms_instance_id === instance.id); const current = stages.filter((stage) => ["pending", "in_progress", "in_review", "overdue"].includes(stage.status)); const progress = calculateFmsProgress(stages.map((stage) => ({ required: runtime.definitions.find((item) => item.id === stage.fms_stage_id)?.is_required ?? true, status: stage.status as never }))); return <button className="w-full min-w-0 rounded-2xl border border-gold/20 p-4 text-left transition hover:border-gold" key={instance.id} onClick={() => setSelected(instance)} type="button"><div className="flex justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs text-gold">{instance.reference_number}</p><h2 className="break-words font-semibold text-white">{instance.title}</h2></div><span className="shrink-0 text-xs text-soft-grey">{instance.status}</span></div><p className="mt-2 text-xs text-soft-grey">Current: {current.map((stage) => runtime.definitions.find((item) => item.id === stage.fms_stage_id)?.name).filter(Boolean).join(", ") || "Closed"}</p><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-charcoal"><div className="h-full bg-gold" style={{ width: `${progress.percent}%` }} /></div><p className="mt-1 text-xs text-soft-grey">{progress.percent}% · {instance.priority} priority</p></button>; })}</div>}
  </section>;
}
