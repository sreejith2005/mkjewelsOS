import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, ArrowLeft, Copy, FilePlus2, GitBranch, Pencil, Play, Plus, Search, Send } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { archiveFmsFlow, loadFmsBuilderData, publishFmsFlow, reviseFmsFlow, saveFmsDraft, type FmsData, type FmsFlowRow } from "@/features/fms/api";
import { flowToDefinition } from "@/features/fms/definition";
import { FmsFlowBuilder } from "@/features/fms/FmsFlowBuilder";
import { FMSTasksPage } from "./FMSTasksPage";

export function FMSBuilderPage() {
  const { profile } = useAuth();
  const canBuild = !!profile && ["super_admin", "admin", "manager"].includes(profile.user_role);
  const [view, setView] = useState<"live" | "library">("live");
  const [data, setData] = useState<FmsData>();
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [life, setLife] = useState("active");
  const [edit, setEdit] = useState<FmsFlowRow | null | undefined>();
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!canBuild) return;
    try { setError(null); setData(await loadFmsBuilderData()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load workflows"); }
  }, [canBuild]);
  useEffect(() => { if (view === "library") void refresh(); }, [refresh, view]);

  const families = useMemo(() => {
    const groups = new Map<string, FmsFlowRow[]>();
    for (const item of data?.flows ?? []) groups.set(item.family_id, [...(groups.get(item.family_id) ?? []), item]);
    return [...groups.values()].map((items) => items.sort((left, right) => right.version - left.version)).filter((items) => items.some((item) => `${item.name} ${item.description ?? ""}`.toLowerCase().includes(query.toLowerCase()) && (life === "all" || life === "active" ? item.status !== "archived" : item.status === life))).sort((left, right) => left[0]!.name.localeCompare(right[0]!.name));
  }, [data, life, query]);

  const action = async (key: string, work: () => Promise<unknown>) => { setBusy(key); setError(null); try { await work(); await refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "FMS action failed"); } finally { setBusy(null); } };
  const duplicateFlow = (flow: FmsFlowRow) => {
    if (!data) return;
    const source = flowToDefinition(flow, data);
    void action(`duplicate:${flow.id}`, () => saveFmsDraft(null, { ...source, id: undefined, familyId: undefined, lifecycle: "draft", name: `${source.name} (Copy)`, version: 1 }));
  };

  if (edit !== undefined && data) return <section className="w-full"><header className="mb-5 flex items-center justify-between gap-3"><Button onClick={() => setEdit(undefined)} type="button" variant="ghost"><ArrowLeft className="size-4" />Back to FMS</Button><p className="text-sm text-soft-grey">{edit ? "Editing draft workflow" : "New workflow"}</p></header><FmsFlowBuilder data={data} flow={edit} onClose={() => setEdit(undefined)} onSaved={refresh} /></section>;

  return <section className="w-full space-y-5">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">Flow management system</p><h1 className="mt-1 text-3xl font-semibold text-gold">FMS</h1><p className="text-sm text-soft-grey">Run live workflows or design reusable workflow templates.</p></div>{canBuild && view === "library" ? <Button onClick={() => setEdit(null)}><Plus />New workflow</Button> : null}</header>
    <div className="flex flex-wrap gap-2 border-b border-gold/20 pb-4"><Button onClick={() => setView("live")} variant={view === "live" ? "primary" : "secondary"}><Play />Live instances</Button><Button onClick={() => setView("library")} variant={view === "library" ? "primary" : "secondary"}><GitBranch />Flow library</Button></div>
    {view === "live" ? <FMSTasksPage /> : !canBuild ? <Notice>Workflow creation is available to authorized managers.</Notice> : <section>
      <div className="mb-5 grid gap-2 sm:grid-cols-2"><label className="relative"><Search className="absolute left-3 top-3 size-4 text-soft-grey" /><input aria-label="Search FMS workflows" className="field pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Search workflows" value={query} /></label><select aria-label="Lifecycle filter" className="field" onChange={(event) => setLife(event.target.value)} value={life}><option value="active">Current and drafts</option><option value="published">Published</option><option value="draft">Drafts</option><option value="archived">Archived</option><option value="all">All</option></select></div>
      {error ? <Notice tone="danger">{error}</Notice> : !data ? <div className="h-48 animate-pulse rounded-xl bg-charcoal" /> : families.length === 0 ? <Notice>No workflows match these filters.</Notice> : <div className="grid gap-4">{families.map((versions) => <article className="rounded-2xl border border-gold/20 p-4" key={versions[0]!.family_id}><h2 className="font-semibold text-white">{versions[0]!.name}</h2><p className="text-sm text-soft-grey">{versions[0]!.description}</p>{versions.map((flow) => <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gold/10 py-3" key={flow.id}><div><b>v{flow.version} · {flow.status}</b><p className="text-xs text-soft-grey">{data.stages.filter((stage) => stage.fms_flow_id === flow.id).length} stages · {flow.usage_count} runs</p></div><div className="flex flex-wrap gap-2">{flow.status === "draft" ? <><Button disabled={busy === flow.id} onClick={() => setEdit(flow)} variant="secondary"><Pencil />Edit</Button><Button disabled={busy === flow.id} onClick={() => void action(flow.id, () => publishFmsFlow(flow.id))}><Send />Publish</Button></> : <Button disabled={busy === flow.id} onClick={() => void action(flow.id, () => reviseFmsFlow(flow.id))} variant="secondary"><FilePlus2 />Revise</Button>}<Button disabled={busy === `duplicate:${flow.id}`} onClick={() => duplicateFlow(flow)} variant="secondary"><Copy />{busy === `duplicate:${flow.id}` ? "Copying..." : "Duplicate"}</Button>{flow.status !== "archived" ? <Button disabled={busy === flow.id} onClick={() => { const reason = window.prompt("Why archive this workflow version?"); if (reason) void action(flow.id, () => archiveFmsFlow(flow.id, reason)); }} variant="danger"><Archive />Archive</Button> : null}</div></div>)}</article>)}</div>}
    </section>}
  </section>;
}
