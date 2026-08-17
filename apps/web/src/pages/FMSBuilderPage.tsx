import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, Copy, FilePlus2, GitBranch, Layers3, Pencil, Play, Plus, Search, Send, Sparkles } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { archiveFmsFlow, loadFmsBuilderData, publishFmsFlow, reviseFmsFlow, saveFmsDraft, startFmsInstance, type FmsData, type FmsFlowRow } from "@/features/fms/api";
import { flowToDefinition } from "@/features/fms/definition";
import { FmsFlowBuilder } from "@/features/fms/FmsFlowBuilder";
import { resolveFmsQuickStart } from "@/features/fms/startScope";
import { FMSTasksPage } from "./FMSTasksPage";

const flowStatus = (status: FmsFlowRow["status"]) => status === "published" ? "bg-success/10 text-success" : status === "draft" ? "bg-gold/10 text-gold" : "bg-soft-grey/10 text-soft-grey";

export function FMSBuilderPage() {
  const { profile } = useAuth();
  const canBuild = !!profile && ["super_admin", "admin", "manager"].includes(profile.user_role);
  const [view, setView] = useState<"live" | "library">("live");
  const [data, setData] = useState<FmsData>();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [life, setLife] = useState<"active" | FmsFlowRow["status"] | "all">("active");
  const [edit, setEdit] = useState<FmsFlowRow | null | undefined>();
  const [startedInstanceId, setStartedInstanceId] = useState<string>();
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setError(null); setData(await loadFmsBuilderData()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load FMS"); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const families = useMemo(() => {
    const groups = new Map<string, FmsFlowRow[]>();
    for (const item of data?.flows ?? []) groups.set(item.family_id, [...(groups.get(item.family_id) ?? []), item]);
    return [...groups.values()].map((items) => items.sort((left, right) => right.version - left.version)).filter((items) => items.some((item) => `${item.name} ${item.description ?? ""}`.toLowerCase().includes(query.toLowerCase()) && (life === "all" || life === "active" ? item.status !== "archived" : item.status === life))).sort((left, right) => left[0]!.name.localeCompare(right[0]!.name));
  }, [data, life, query]);

  const published = useMemo(() => data?.flows.filter((flow) => flow.status === "published" && flow.is_active).length ?? 0, [data]);
  const action = async (key: string, work: () => Promise<unknown>) => { setBusy(key); setError(null); try { await work(); await refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "FMS action failed"); } finally { setBusy(null); } };
  const duplicateFlow = (flow: FmsFlowRow) => { if (!data) return; const source = flowToDefinition(flow, data); void action(`duplicate:${flow.id}`, () => saveFmsDraft(null, { ...source, id: undefined, familyId: undefined, lifecycle: "draft", name: `${source.name} (Copy)`, version: 1 })); };
  const startFlow = async (flow: FmsFlowRow) => {
    if (!data || !profile) return;
    setBusy(`start:${flow.id}`);
    setError(null);
    try {
      const result = await startFmsInstance(resolveFmsQuickStart(data, flow, profile));
      setStartedInstanceId(result.instance_id);
      setQuery("");
      setView("live");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to start workflow");
    } finally {
      setBusy(null);
    }
  };

  if (edit !== undefined && data) return <section className="w-full"><header className="mb-5 flex items-center justify-between gap-3"><Button onClick={() => setEdit(undefined)} type="button" variant="ghost"><ArrowLeft className="size-4" />Back to FMS</Button><p className="text-sm text-soft-grey">{edit ? "Editing draft workflow" : "New workflow"}</p></header><FmsFlowBuilder data={data} flow={edit} onClose={() => setEdit(undefined)} onSaved={refresh} /></section>;

  return <section className="mx-auto w-full max-w-7xl space-y-5">
    <section className="overflow-hidden rounded-3xl border border-gold/30 bg-gold/15 p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-center gap-3"><span className="grid size-12 place-items-center rounded-2xl border border-gold/40 bg-charcoal text-gold"><GitBranch className="size-6" /></span><div><h1 className="text-2xl font-semibold text-white sm:text-3xl">FMS Builder</h1><p className="text-sm text-soft-grey">Flowchart Management System</p></div></div>{canBuild ? <Button onClick={() => { setView("library"); setEdit(null); }}><Plus className="size-4" />New workflow</Button> : null}</div>
      <div className="mt-6 grid gap-3 sm:grid-cols-3"><Metric icon={Layers3} label="Total flows" value={families.length} /><Metric icon={Sparkles} label="Published" value={published} /><Metric icon={Play} label="Runs" value={data?.flows.reduce((sum, flow) => sum + flow.usage_count, 0) ?? 0} /></div>
    </section>
    <label className="relative block"><Search className="absolute left-4 top-1/2 size-5 -translate-y-1/2 text-soft-grey" /><input aria-label={view === "live" ? "Search FMS instances" : "Search FMS flows"} className="field min-h-14 rounded-2xl pl-12 text-base" onChange={(event) => setQuery(event.target.value)} placeholder={view === "live" ? "Search instances..." : "Search flows..."} value={query} /></label>
    <div className="grid grid-cols-2 gap-2 rounded-2xl border border-gold/20 bg-charcoal/50 p-1.5"><button className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${view === "library" ? "bg-gold text-obsidian shadow" : "text-champagne hover:bg-gold/10"}`} onClick={() => { setView("library"); setQuery(""); }} type="button"><Layers3 className="size-4" />Flow library</button><button className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-semibold transition ${view === "live" ? "bg-gold text-obsidian shadow" : "text-champagne hover:bg-gold/10"}`} onClick={() => { setView("live"); setQuery(""); }} type="button"><Play className="size-4" />Live instances</button></div>
    {view === "live" ? <FMSTasksPage {...(startedInstanceId ? { initialInstanceId: startedInstanceId } : {})} query={query} /> : !canBuild ? <Notice>Workflow creation is available to authorized managers.</Notice> : <section>
      <div className="mb-4 flex flex-wrap gap-2">{(["active", "published", "draft", "archived", "all"] as const).map((item) => <button className={`rounded-full border px-4 py-2 text-sm font-medium capitalize ${life === item ? "border-gold bg-gold text-obsidian" : "border-gold/20 text-soft-grey hover:border-gold"}`} key={item} onClick={() => setLife(item)} type="button">{item === "active" ? "All active" : item}</button>)}</div>
      {error ? <Notice tone="danger">{error}</Notice> : !data ? <div className="h-48 animate-pulse rounded-2xl bg-charcoal" /> : families.length === 0 ? <Notice>No workflows match this view.</Notice> : <div className="grid gap-4">{families.map((versions) => { const flow = versions[0]!; const stages = data.stages.filter((stage) => stage.fms_flow_id === flow.id); return <article className="rounded-3xl border border-gold/20 bg-charcoal p-5 shadow-sm" key={flow.family_id}><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-lg font-semibold text-white">{flow.name}</h2><span className={`rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-wide ${flowStatus(flow.status)}`}>{flow.status}</span></div><p className="mt-1 text-sm text-soft-grey">{flow.description || "No description added."}</p><p className="mt-3 text-xs text-soft-grey">{stages.length} steps · v{flow.version} · used {flow.usage_count} times</p></div></div>{stages.length ? <div className="mt-4 flex items-center gap-1 overflow-x-auto pb-1">{stages.slice(0, 6).map((stage, index) => <div className="flex items-center gap-1" key={stage.id}><span className="shrink-0 rounded-lg bg-gold/10 px-2 py-1 text-xs text-champagne">{stage.name}</span>{index < Math.min(stages.length - 1, 5) ? <span className="text-gold">→</span> : null}</div>)}{stages.length > 6 ? <span className="text-xs text-soft-grey">+{stages.length - 6} more</span> : null}</div> : null}<div className="mt-5 flex flex-wrap gap-2">{flow.status === "published" && flow.is_active ? <Button className="flex-1 sm:flex-none" disabled={busy === `start:${flow.id}`} onClick={() => void startFlow(flow)}><Play className="size-4" />{busy === `start:${flow.id}` ? "Starting…" : "Start instance"}</Button> : null}{flow.status === "draft" ? <><Button onClick={() => setEdit(flow)} variant="secondary"><Pencil className="size-4" />Edit</Button><Button disabled={busy === flow.id} onClick={() => void action(flow.id, () => publishFmsFlow(flow.id))}><Send className="size-4" />Publish</Button></> : <Button disabled={busy === flow.id} onClick={() => void action(flow.id, () => reviseFmsFlow(flow.id))} variant="secondary"><FilePlus2 className="size-4" />Revise</Button>}<Button disabled={busy === `duplicate:${flow.id}`} onClick={() => duplicateFlow(flow)} variant="secondary"><Copy className="size-4" />{busy === `duplicate:${flow.id}` ? "Copying..." : "Duplicate"}</Button>{flow.status !== "archived" ? <Button onClick={() => { const reason = window.prompt("Why archive this workflow version?"); if (reason) void action(flow.id, () => archiveFmsFlow(flow.id, reason)); }} variant="danger"><Archive className="size-4" />Archive</Button> : null}</div></article>; })}</div>}
    </section>}
  </section>;
}

function Metric({ icon: Icon, label, value }: { icon: typeof Play; label: string; value: number }) { return <div className="rounded-2xl border border-gold/25 bg-charcoal/50 p-4 text-center"><Icon className="mx-auto size-4 text-gold" /><p className="mt-2 text-2xl font-semibold text-white">{value}</p><p className="text-xs text-soft-grey">{label}</p></div>; }
