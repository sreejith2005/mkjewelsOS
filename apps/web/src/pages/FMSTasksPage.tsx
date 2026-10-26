import { useCallback, useEffect, useMemo, useState } from "react";
import { fmsEmployeeStatusLabel, fmsLogActionLabel, fmsLogDetailLines, formatKolkataDateTime, parseFmsAssignedWorkPath } from "@jewelos/core";
import { AlertTriangle, ArrowLeft, Check, Clock, PauseCircle, Search, XCircle } from "lucide-react";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { loadFormDynamicOptions, loadForms, type FormBundle } from "@/features/forms/api";
import type { DynamicOptions } from "@/features/forms/FormRenderer";
import { FmsContextFirst } from "@/features/fms/FmsContextFirst";
import { FmsStageRunner } from "@/features/fms/FmsStageRunner";
import { loadFmsRunNames, loadFmsRuntime, setFmsInstanceStatus, type FmsInstance } from "@/features/fms/api";
import { fmsBoardColumns, fmsRunCard, fmsRunColumnKeys, fmsRunMatches, fmsRunPath, type FmsPathStep, type FmsRunCard, type FmsRunView } from "@/features/fms/runBoard";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";

const EMPTY_OPTIONS: DynamicOptions = { users: [], branches: [], departments: [], masters: [] };
type Runtime = Awaited<ReturnType<typeof loadFmsRuntime>>;
const VIEWS: readonly { value: FmsRunView; label: string }[] = [{ value: "in_progress", label: "In progress" }, { value: "finished", label: "Finished" }, { value: "all", label: "All" }];

function shortDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" }).format(date);
}

/**
 * The runs board for one or more workflows: every run (a client, lead, order...)
 * sits in the column of the step it is on, finished runs in the last column.
 * Opening a run shows its whole path and the work for its open steps.
 */
export function FMSTasksPage({ embedded = false, query: externalQuery, initialInstanceId, flowIds, heading }: { embedded?: boolean; query?: string; initialInstanceId?: string; flowIds?: readonly string[]; heading?: string }) {
  const assignedWork = parseFmsAssignedWorkPath(window.location.href);
  const deepLink = assignedWork?.kind === "stage_form" ? assignedWork : null;
  const { profile } = useAuth();
  const [runtime, setRuntime] = useState<Runtime>();
  const [names, setNames] = useState<ReadonlyMap<string, string>>(new Map());
  const [forms, setForms] = useState<FormBundle[]>([]);
  const [formOptions, setFormOptions] = useState<DynamicOptions>(EMPTY_OPTIONS);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<FmsRunView>("in_progress");
  const [mineOnly, setMineOnly] = useState(false);
  const [query, setQuery] = useState("");
  const [familyKey, setFamilyKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<FmsInstance | null>(null);
  const [openInstanceId, setOpenInstanceId] = useState(initialInstanceId ?? deepLink?.instanceId ?? "");
  const [busy, setBusy] = useState(false);

  const viewingInstanceId = selected?.id || openInstanceId;
  const flowKey = flowIds?.join(",") ?? "";
  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [nextRuntime, formData, options] = await Promise.all([loadFmsRuntime(viewingInstanceId || undefined), loadForms(), loadFormDynamicOptions()]);
      setRuntime(nextRuntime);
      setForms(formData.bundles);
      setFormOptions(options);
      setSelected((current) => current ? nextRuntime.instances.find((item) => item.id === current.id) ?? null : null);
      // Names only for the workflow(s) on this board; the whole company's runs are not needed.
      const scope = flowKey ? new Set(flowKey.split(",")) : null;
      const loaded = await loadFmsRunNames(nextRuntime.instances.filter((instance) => !scope || scope.has(instance.fms_flow_id)).map((instance) => instance.id));
      setNames((current) => new Map([...current, ...loaded]));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load FMS tasks"); }
  }, [flowKey, viewingInstanceId]);
  useEffect(() => { void refresh(); }, [refresh]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["fms", "forms", "organization"], refresh });
  useEffect(() => {
    if (!runtime || !openInstanceId) return;
    const created = runtime.instances.find((instance) => instance.id === openInstanceId);
    if (!created) return;
    setSelected(created);
    setOpenInstanceId("");
  }, [openInstanceId, runtime]);

  const people = useMemo(() => new Map((runtime?.users ?? []).map((user) => [user.id, user.employee_name])), [runtime]);
  const definitionsById = useMemo(() => new Map((runtime?.definitions ?? []).map((step) => [step.id, step])), [runtime]);
  /** Workflow families (all versions of one workflow) that have runs in scope, newest version first. */
  const families = useMemo(() => {
    const flows = runtime?.flows ?? [];
    const inScope = (runtime?.instances ?? []).filter((instance) => !flowIds || flowIds.includes(instance.fms_flow_id));
    const byFamily = new Map<string, { key: string; name: string; latestFlowId: string; version: number; flowIds: Set<string> }>();
    for (const flow of flows) {
      if (flowIds && !flowIds.includes(flow.id)) continue;
      const family = byFamily.get(flow.family_id) ?? { key: flow.family_id, name: flow.name, latestFlowId: flow.id, version: flow.version, flowIds: new Set<string>() };
      family.flowIds.add(flow.id);
      if (flow.version > family.version) Object.assign(family, { name: flow.name, latestFlowId: flow.id, version: flow.version });
      byFamily.set(flow.family_id, family);
    }
    return [...byFamily.values()].filter((family) => inScope.some((instance) => family.flowIds.has(instance.fms_flow_id))).sort((a, b) => a.name.localeCompare(b.name));
  }, [flowIds, runtime]);
  const family = families.find((item) => item.key === familyKey) ?? families[0];
  const cards = useMemo(() => (runtime?.instances ?? []).filter((instance) => family?.flowIds.has(instance.fms_flow_id)).map((instance) => fmsRunCard(instance, runtime?.stages ?? [], definitionsById)), [definitionsById, family, runtime]);
  const runName = useCallback((instance: FmsInstance) => names.get(instance.id) ?? instance.reference_number, [names]);
  const activeQuery = externalQuery ?? query;
  const visible = useMemo(() => cards.filter((card) => fmsRunMatches(card, { view, mineOnly, profileId: profile?.id ?? "", query: activeQuery, name: runName(card.instance) })), [activeQuery, cards, mineOnly, profile?.id, runName, view]);
  const columns = useMemo(() => {
    const base = fmsBoardColumns(runtime?.definitions ?? [], family?.latestFlowId).filter((column) => view !== "in_progress" || !column.finished).filter((column) => view !== "finished" || column.finished);
    const known = new Set(base.map((column) => column.key));
    // Runs on a step the newest version no longer has keep their own column, named from their version.
    const extra = new Map<string, string>();
    for (const card of visible) for (const [index, key] of fmsRunColumnKeys(card).entries()) if (!known.has(key) && !extra.has(key)) extra.set(key, key === "__waiting" ? "Waiting" : `${card.stepNames[index] ?? key} (older version)`);
    const finishedIndex = base.findIndex((column) => column.finished);
    const extras = [...extra].map(([key, name]) => ({ key, name }));
    return finishedIndex < 0 ? [...base, ...extras] : [...base.slice(0, finishedIndex), ...extras, ...base.slice(finishedIndex)];
  }, [family, runtime, view, visible]);
  const counts = useMemo(() => ({
    inProgress: cards.filter((card) => !card.finished).length,
    overdue: cards.filter((card) => !card.finished && card.overdue).length,
    finished: cards.filter((card) => card.finished).length,
  }), [cards]);

  if (!profile) return null;
  const canManage = ["super_admin", "admin", "manager"].includes(profile.user_role);
  const statusAction = async (instance: FmsInstance, action: "hold" | "resume" | "cancel") => {
    const reason = window.prompt(`${action} reason`);
    if (!reason || !window.confirm(`Confirm ${action} for ${runName(instance)}?`)) return;
    setBusy(true);
    try { await setFmsInstanceStatus(instance.id, action, reason); await refresh(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Status update failed"); }
    finally { setBusy(false); }
  };

  if (selected && runtime && !embedded) {
    const stages = runtime.stages.filter((stage) => stage.fms_instance_id === selected.id);
    const flow = runtime.flows.find((item) => item.id === selected.fms_flow_id);
    const path = fmsRunPath(selected, stages, runtime.definitions);
    const openFirst = [...stages].sort((a, b) => Number(["pending", "in_progress", "in_review", "overdue"].includes(b.status)) - Number(["pending", "in_progress", "in_review", "overdue"].includes(a.status)));
    const parent = selected.parent_instance_id ? runtime.instances.find((item) => item.id === selected.parent_instance_id) : null;
    const children = runtime.instances.filter((item) => item.parent_instance_id === selected.id);
    const logs = runtime.logs.filter((log) => stages.some((stage) => stage.id === log.fms_instance_stage_id));
    return <section className="mx-auto max-w-5xl space-y-4">
      <Button onClick={() => setSelected(null)} variant="ghost"><ArrowLeft className="size-4" />Back to board</Button>
      <header className="rounded-2xl border border-gold/20 p-5">
        <div className="flex flex-wrap justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words font-display text-[1.85rem] font-semibold leading-tight text-white sm:text-[2.1rem]">{runName(selected)}</h1>
            <p className="mt-1 text-sm text-soft-grey">{selected.reference_number} · {flow?.name ?? "Workflow"}{selected.started_at ? ` · started ${shortDate(selected.started_at)}` : ""}{selected.started_by ? ` by ${people.get(selected.started_by) ?? "an employee"}` : ""}</p>
            <div className="mt-2"><RunStatus card={fmsRunCard(selected, runtime.stages, definitionsById)} /></div>
          </div>
          {canManage ? <div className="flex flex-wrap items-start gap-2">{selected.status === "on_hold" ? <Button disabled={busy} onClick={() => void statusAction(selected, "resume")}>Resume</Button> : selected.status === "active" || selected.status === "overdue" ? <Button disabled={busy} onClick={() => void statusAction(selected, "hold")} variant="secondary">Hold</Button> : null}{!["completed", "cancelled"].includes(selected.status) ? <Button disabled={busy} onClick={() => void statusAction(selected, "cancel")} variant="danger">Cancel</Button> : null}</div> : null}
        </div>
        {parent || children.length ? <p className="mt-2 text-xs text-soft-grey">Linked: {parent ? `started from ${runName(parent)}` : ""}{parent && children.length ? " · " : ""}{children.length ? `started ${children.map(runName).join(", ")}` : ""}</p> : null}
      </header>
      <RunPath people={people} steps={path} />
      <section aria-label="Step details" className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-gold-secondary">Step details</h2>
        {openFirst.map((stage) => { const definition = runtime.definitions.find((item) => item.id === stage.fms_stage_id); const requested = deepLink?.instanceStageId === stage.id ? deepLink.formTemplateId : null; return definition ? <FmsContextFirst key={stage.id} instanceId={selected.id} instanceStageId={stage.id} hasForm={!!definition.form_template_id} reviewRequired={(stage.assigned_to ?? []).includes(profile.id)}><FmsStageRunner branches={formOptions.branches} checklist={runtime.checklist.filter((item) => item.fms_instance_stage_id === stage.id)} definition={definition} definitions={runtime.definitions} departments={formOptions.departments} evidence={runtime.evidence.filter((item) => item.fms_instance_stage_id === stage.id)} formOptions={formOptions} forms={forms} instance={selected} instanceStages={stages} key={stage.id} onRefresh={refresh} profile={profile} {...(requested ? { requestedFormTemplateId: requested } : {})} stage={stage} users={runtime.users} /></FmsContextFirst> : null; })}
      </section>
      <details className="rounded-2xl border border-gold/20 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-champagne">History ({logs.length})</summary>
        <ol className="mt-3 space-y-3">{logs.map((log) => {
          const lines = fmsLogDetailLines(log.details, people);
          return <li className="border-l-2 border-gold/30 pl-3 text-sm" key={log.id}><b className="text-task-text">{fmsLogActionLabel(log.action)}</b><span className="block text-xs text-soft-grey">{[formatKolkataDateTime(log.created_at) || null, log.actor_id ? `by ${people.get(log.actor_id) ?? "Historical employee"}` : "by System"].filter(Boolean).join(" · ")}</span>{lines.length ? <dl className="mt-1 space-y-0.5 text-xs text-soft-grey">{lines.map((line) => <div className="break-words" key={line.label}><dt className="inline font-medium">{line.label}: </dt><dd className="inline">{line.value}</dd></div>)}</dl> : null}</li>;
        })}</ol>
      </details>
    </section>;
  }

  return <section className={embedded ? "w-full" : "mx-auto w-full max-w-7xl"}>
    <header className="mb-4">
      <h2 className="text-xl font-semibold text-white">{heading ?? family?.name ?? "Workflow board"}</h2>
      <p className="text-sm text-soft-grey">Everyone in this workflow and the step they are on. Open a card to see the full path.</p>
    </header>
    {error ? <div className="mb-3"><Notice tone="danger">{error} <button className="underline" onClick={() => void refresh()} type="button">Retry</button></Notice></div> : null}
    {families.length > 1 ? <div aria-label="Workflow" className="scroll-x no-scrollbar mb-3 flex gap-2" role="group">{families.map((item) => <button aria-pressed={item.key === family?.key} className={cn("min-h-10 shrink-0 rounded-full border px-4 text-sm font-semibold transition", item.key === family?.key ? "border-gold bg-gold text-on-gold" : "border-gold/25 text-champagne hover:border-gold/60")} key={item.key} onClick={() => setFamilyKey(item.key)} type="button">{item.name}</button>)}</div> : null}
    <div className="mb-3 grid grid-cols-3 gap-2">
      <Stat label="In progress" value={counts.inProgress} />
      <Stat label="Overdue" tone={counts.overdue ? "danger" : undefined} value={counts.overdue} />
      <Stat label="Finished" value={counts.finished} />
    </div>
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
      {externalQuery === undefined ? <label className="relative flex-1"><Search aria-hidden className="absolute left-3 top-3 size-4 text-soft-grey" /><input aria-label="Search runs" className="field pl-9" onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or reference" type="search" value={query} /></label> : null}
      <div aria-label="Show" className="flex rounded-xl border border-gold/20 p-1" role="group">{VIEWS.map((item) => <button aria-pressed={view === item.value} className={cn("min-h-9 flex-1 rounded-lg px-3 text-sm font-semibold transition sm:flex-none", view === item.value ? "bg-gold text-on-gold" : "text-champagne hover:bg-gold/10")} key={item.value} onClick={() => setView(item.value)} type="button">{item.label}</button>)}</div>
      <label className="flex min-h-11 items-center gap-2 rounded-xl border border-gold/20 px-3 text-sm text-champagne"><input checked={mineOnly} className="size-4 accent-gold" onChange={(event) => setMineOnly(event.target.checked)} type="checkbox" />Only my work</label>
    </div>
    {!runtime ? <div className="h-48 animate-pulse rounded-xl bg-charcoal" /> : !family ? <Notice>No runs yet. Start this workflow to see it here.</Notice> : <div aria-label="Workflow board" className="scroll-x flex snap-x gap-3 pb-3">
      {columns.map((column, index) => {
        const inColumn = visible.filter((card) => fmsRunColumnKeys(card).includes(column.key));
        return <section aria-label={`${column.name}, ${inColumn.length}`} className={cn("flex w-[17.5rem] shrink-0 snap-start flex-col rounded-2xl border p-2", "finished" in column && column.finished ? "border-success/30 bg-success/5" : "border-gold/15 bg-charcoal/40")} key={column.key}>
          <h3 className="flex items-center gap-2 px-2 py-1.5 text-sm font-semibold text-white">
            {"finished" in column && column.finished ? <Check aria-hidden className="size-4 text-success" /> : <span aria-hidden className="flex size-5 items-center justify-center rounded-full bg-gold/15 text-[11px] font-bold text-gold-secondary">{index + 1}</span>}
            <span className="min-w-0 flex-1 truncate">{column.name}</span>
            <span className="rounded-full bg-gold/10 px-2 text-xs text-champagne">{inColumn.length}</span>
          </h3>
          <div className="mt-1 flex flex-col gap-2">{inColumn.length ? inColumn.map((card) => <RunCardButton card={card} key={card.instance.id} name={runName(card.instance)} onOpen={() => setSelected(card.instance)} people={people} />) : <p className="rounded-xl border border-dashed border-gold/15 p-3 text-center text-xs text-soft-grey">No one here</p>}</div>
        </section>;
      })}
    </div>}
  </section>;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "danger" | undefined }) {
  return <div className={cn("rounded-xl border p-3 text-center", tone === "danger" ? "border-danger/40 bg-danger/5" : "border-gold/20")}><b className={cn("block text-xl tabular-nums", tone === "danger" ? "text-danger" : "text-white")}>{value}</b><p className="text-xs text-soft-grey">{label}</p></div>;
}

function RunStatus({ card }: { card: FmsRunCard }) {
  const { status } = card.instance;
  if (status === "completed") return <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success"><Check aria-hidden className="size-3.5" />Completed{card.instance.completed_at ? ` ${shortDate(card.instance.completed_at)}` : ""}</span>;
  if (status === "cancelled") return <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger"><XCircle aria-hidden className="size-3.5" />Cancelled</span>;
  if (status === "on_hold") return <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold-secondary"><PauseCircle aria-hidden className="size-3.5" />On hold</span>;
  if (card.overdue) return <span className="inline-flex items-center gap-1 rounded-full bg-danger/10 px-2 py-0.5 text-xs font-semibold text-danger"><AlertTriangle aria-hidden className="size-3.5" />Overdue{card.dueAt ? ` · due ${shortDate(card.dueAt)}` : ""}</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-2 py-0.5 text-xs font-semibold text-champagne"><Clock aria-hidden className="size-3.5" />{card.dueAt ? `Due ${shortDate(card.dueAt)}` : fmsEmployeeStatusLabel(status)}</span>;
}

function RunCardButton({ card, name, people, onOpen }: { card: FmsRunCard; name: string; people: ReadonlyMap<string, string>; onOpen: () => void }) {
  const who = card.assigneeIds.map((id) => people.get(id) ?? "Employee");
  return <button className={cn("w-full rounded-xl border bg-task-bg p-3 text-left transition hover:border-gold", card.overdue && !card.finished ? "border-danger/50" : "border-gold/20")} onClick={onOpen} type="button">
    <p className="break-words text-sm font-semibold leading-snug text-white">{name}</p>
    <p className="mt-0.5 truncate text-[11px] text-soft-grey">{card.instance.reference_number}</p>
    {!card.finished && who.length ? <p className="mt-2 truncate text-xs text-champagne">With {who.join(", ")}</p> : null}
    {!card.finished && card.stepNames.length > 1 ? <p className="mt-1 truncate text-xs text-soft-grey">Also at: {card.stepNames.join(", ")}</p> : null}
    <div className="mt-2"><RunStatus card={card} /></div>
  </button>;
}

const PATH_STYLE: Record<FmsPathStep["state"], { dot: string; label: string }> = {
  done: { dot: "border-success bg-success text-task-bg", label: "Done" },
  current: { dot: "border-gold bg-gold/20 text-gold-secondary ring-4 ring-gold/20", label: "Now" },
  skipped: { dot: "border-dashed border-soft-grey/60 text-soft-grey", label: "Skipped" },
  upcoming: { dot: "border-gold/25 text-soft-grey", label: "Next" },
  not_needed: { dot: "border-gold/15 text-soft-grey/60", label: "Not needed" },
};

/** The run's whole journey: what is done, where it is now, and what comes next. */
function RunPath({ steps, people }: { steps: readonly FmsPathStep[]; people: ReadonlyMap<string, string> }) {
  return <section aria-label="Workflow path" className="rounded-2xl border border-gold/20 p-4">
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-gold-secondary">Path</h2>
    <ol className="flex flex-col gap-0 md:flex-row md:flex-wrap md:gap-y-4">
      {steps.map((step, index) => {
        const style = PATH_STYLE[step.state];
        const who = step.peopleIds.map((id) => people.get(id) ?? "Employee").join(", ");
        return <li className="relative flex min-w-0 gap-3 pb-4 md:w-48 md:flex-col md:gap-2 md:pb-0 md:pr-3" key={step.key}>
          {index < steps.length - 1 ? <span aria-hidden className={cn("absolute left-[0.9rem] top-8 h-[calc(100%-1.5rem)] w-0.5 md:left-8 md:top-[0.9rem] md:h-0.5 md:w-[calc(100%-1.25rem)]", step.state === "done" || step.state === "skipped" ? "bg-success/50" : "bg-gold/15")} /> : null}
          <span className={cn("relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-bold", style.dot)}>{step.state === "done" ? <Check aria-hidden className="size-4" /> : index + 1}</span>
          <div className="min-w-0">
            <p className={cn("break-words text-sm font-semibold", step.state === "current" ? "text-white" : step.state === "done" ? "text-champagne" : "text-soft-grey")}>{step.name}</p>
            <p className="text-xs text-soft-grey">{style.label}{who ? ` · ${who}` : ""}{step.at ? ` · ${step.state === "current" ? "due " : ""}${shortDate(step.at)}` : ""}{step.visits > 1 ? ` · ${step.visits} times` : ""}</p>
          </div>
        </li>;
      })}
    </ol>
  </section>;
}
