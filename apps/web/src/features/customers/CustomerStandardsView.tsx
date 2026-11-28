import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { errorMessage } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  decideCustomerStd, endCustomerStdRule, loadCustomerRefValues, loadCustomerStdOverview, loadCustomerStdQueue, loadCustomerStdRules,
  reprocessCustomerStd, reviewCustomerStdDraft, saveCustomerRefValue, setCustomerStdPolicy,
  type CustomerRefOption, type CustomerRefValue, type CustomerStdDecision, type CustomerStdField, type CustomerStdOverview,
  type CustomerStdQueue, type CustomerStdQueueItem, type CustomerStdRule,
} from "./api";
import { formatDate } from "./format";

/** Statuses as people read them (the exact codes stay in the database). */
const STATUS_LABELS: Record<string, string> = {
  standardized: "Standardized", unmapped: "Not standardized yet", missing: "Not recorded", invalid: "Not valid",
  ambiguous: "Unclear", other: "Other", wrong_field: "Belongs to another field", cross_field: "From another field", pending: "Waiting to be read",
};
const PLACE_KINDS = ["locality", "city", "district", "state", "country"] as const;

type Tab = "review" | "rules" | "values";

/**
 * Data standards (/crm/master/standards, migration 0455): per field, the
 * distinct values written in the sheets, what they are read as, and the
 * rules and reference values behind them. Every action is checked and
 * audited by the server; one decision applies to every customer with that value.
 */
export function CustomerStandardsView({ onBack }: { onBack: () => void }) {
  const [overview, setOverview] = useState<CustomerStdOverview | null>(null);
  const [field, setField] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("review");
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    loadCustomerStdOverview().then((value) => { setOverview(value); setField((current) => current ?? value.fields.find((item) => item.policy !== "none")?.key ?? null); })
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }, []);
  useEffect(() => { reload(); }, [reload]);
  const selected = overview?.fields.find((item) => item.key === field) ?? null;
  const openJobs = (overview?.jobs ?? []).filter((job) => job.status === "pending" || job.status === "running");

  return (
    <section className="w-full">
      <Button className="-ml-2" onClick={onBack} variant="ghost"><ArrowLeft className="h-4 w-4" />Customer list</Button>
      <header className="mb-3 mt-1">
        <h1 className="font-display text-[1.9rem] font-semibold leading-tight text-task-text sm:text-[2.2rem]">Data standards</h1>
        <p className="text-sm text-task-text-muted">
          One decision per written value: it applies to every customer with that value, now and in every future import. What was written is always kept.
        </p>
        {openJobs.length ? <p className="mt-1 text-sm text-task-text-muted">Updating customers in the background: {openJobs.map((job) => `${job.field} (${job.processed.toLocaleString("en-IN")} read)`).join(", ")}.</p> : null}
      </header>
      {error ? <div className="mb-3"><Notice tone="danger">{error}</Notice></div> : null}
      {!overview && !error ? <p className="mt-6 text-center text-task-text-muted">Loading…</p> : null}

      {overview ? (
        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          <nav aria-label="Fields" className="space-y-1">
            {overview.fields.map((item) => <FieldButton active={item.key === field} field={item} key={item.key} onClick={() => { setField(item.key); setTab("review"); }} />)}
          </nav>
          <div className="min-w-0">
            {selected ? (
              <FieldPanel can={overview.can} field={selected} key={selected.key} onChanged={reload} onTab={setTab} tab={tab} />
            ) : <p className="text-task-text-muted">Choose a field.</p>}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function FieldButton({ field, active, onClick }: { field: CustomerStdField; active: boolean; onClick: () => void }) {
  const open = (field.statuses.unmapped ?? 0) + (field.statuses.ambiguous ?? 0) + (field.statuses.wrong_field ?? 0);
  return (
    <button aria-current={active ? "true" : undefined} className={cn("w-full rounded-xl border px-3 py-2 text-left", active ? "border-gold bg-gold/10" : "border-task-border bg-task-bg hover:border-gold/50")} onClick={onClick} type="button">
      <span className="block text-sm font-semibold text-task-text">{field.label}{field.sensitive ? " (sensitive)" : ""}</span>
      <span className="block text-xs text-task-text-muted">
        {field.policy === "none" ? "Shown as written" : `${field.customers.toLocaleString("en-IN")} customers · ${open.toLocaleString("en-IN")} readings to review`}
      </span>
    </button>
  );
}

function FieldPanel({ field, can, tab, onTab, onChanged }: {
  field: CustomerStdField; can: CustomerStdOverview["can"]; tab: Tab; onTab: (tab: Tab) => void; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const act = async (work: () => Promise<void>) => {
    setBusy(true); setFailure(null);
    try { await work(); onChanged(); } catch (reason) { setFailure(errorMessage(reason)); } finally { setBusy(false); }
  };
  if (field.policy === "none") {
    return (
      <div className="rounded-2xl border border-task-border bg-task-bg p-4 shadow-card">
        <h2 className="text-lg font-semibold text-task-text">{field.label}</h2>
        <p className="mt-1 text-sm text-task-text-muted">{field.observations.toLocaleString("en-IN")} answers from {field.customers.toLocaleString("en-IN")} customers, shown as written.</p>
        {failure ? <div className="mt-2"><Notice tone="danger">{failure}</Notice></div> : null}
        {can.policies ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void act(() => setCustomerStdPolicy(field.key, "reference"))}>Standardize this field</Button>
            <Button disabled={busy} onClick={() => void act(() => setCustomerStdPolicy(field.key, "reference", true))} variant="secondary">Standardize, several values per answer</Button>
          </div>
        ) : null}
      </div>
    );
  }
  const statuses = Object.entries(field.statuses).sort((a, b) => b[1] - a[1]);
  return (
    <div>
      <div className="mb-3 rounded-2xl border border-task-border bg-task-bg p-4 shadow-card">
        <h2 className="text-lg font-semibold text-task-text">{field.label}</h2>
        {field.meaning ? <p className="text-sm text-task-text-muted">{field.meaning}</p> : null}
        <p className="mt-2 text-sm text-task-text">
          {field.observations.toLocaleString("en-IN")} answers from {field.customers.toLocaleString("en-IN")} customers · {field.values.toLocaleString("en-IN")} approved values
        </p>
        <p className="mt-1 flex flex-wrap gap-2 text-xs">
          {statuses.map(([status, n]) => <span className="rounded-full border border-task-border px-2 py-0.5 text-task-text" key={status}>{STATUS_LABELS[status] ?? status}: {n.toLocaleString("en-IN")}</span>)}
        </p>
        {failure ? <div className="mt-2"><Notice tone="danger">{failure}</Notice></div> : null}
        {can.reprocess ? <div className="mt-2"><Button disabled={busy} onClick={() => void act(() => reprocessCustomerStd(field.key))} variant="ghost">Read every answer again</Button></div> : null}
      </div>
      <div className="mb-3 flex gap-1" role="tablist">
        {([["review", "To review"], ["rules", "Rules"], ["values", "Values"]] as const).map(([key, label]) => (
          <button aria-selected={tab === key} className={cn("min-h-11 rounded-full border px-4 text-sm font-semibold", tab === key ? "border-gold bg-gold/15 text-task-text" : "border-task-border bg-task-bg text-task-text-muted")} key={key} onClick={() => onTab(key)} role="tab" type="button">{label}</button>
        ))}
      </div>
      {tab === "review" ? <ReviewQueue can={can} field={field} onChanged={onChanged} /> : null}
      {tab === "rules" ? <Rules can={can} field={field} onChanged={onChanged} /> : null}
      {tab === "values" && field.domain ? <Values can={can} domain={field.domain} place={field.policy === "place"} /> : null}
    </div>
  );
}

function ReviewQueue({ field, can, onChanged }: { field: CustomerStdField; can: CustomerStdOverview["can"]; onChanged: () => void }) {
  const [show, setShow] = useState("open");
  const [queue, setQueue] = useState<CustomerStdQueue | null>(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const load = useCallback(() => {
    loadCustomerStdQueue(field.key, show, offset).then(setQueue).catch((reason: unknown) => setError(errorMessage(reason)));
  }, [field.key, show, offset]);
  useEffect(() => { load(); }, [load]);
  const decide = async (item: CustomerStdQueueItem, decision: CustomerStdDecision, text: string) => {
    setError(null); setDone(null);
    try {
      const result = await decideCustomerStd(field.key, item.input_key, decision, null);
      setDone(`"${item.examples[0] ?? item.input_key}": ${text}${result.status === "draft" ? " (suggested; waits for approval)" : `, ${result.customers.toLocaleString("en-IN")} customers updating`}.`);
      setQueue((current) => current && { ...current, total: Math.max(0, current.total - 1), items: current.items.filter((other) => other.input_key !== item.input_key) });
      onChanged();
    } catch (reason) { setError(errorMessage(reason)); }
  };
  const canDecide = can.approve || can.suggest;
  return (
    <div>
      <label className="mb-3 flex items-center gap-2 text-sm text-task-text">
        Show
        <select aria-label="Show" className="field w-auto" onChange={(event) => { setShow(event.target.value); setOffset(0); }} value={show}>
          <option value="open">Values to review</option>
          <option value="all">All values</option>
          <option value="standardized">Standardized</option>
          <option value="missing">Not recorded</option>
          <option value="invalid">Not valid</option>
        </select>
      </label>
      {error ? <div className="mb-3"><Notice tone="danger">{error}</Notice></div> : null}
      {done ? <div className="mb-3"><Notice tone="success">{done}</Notice></div> : null}
      {queue ? <p className="mb-2 text-sm text-task-text-muted">{queue.total.toLocaleString("en-IN")} distinct values, most customers first.</p> : <p className="text-task-text-muted">Loading…</p>}
      {(queue?.items ?? []).map((item) => (
        <QueueItem canCreate={can.reference} canDecide={canDecide} field={field} item={item} key={item.input_key} onDecide={decide} />
      ))}
      {queue && queue.total > offset + 25 ? (
        <div className="flex justify-between">
          <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 25))} variant="secondary">Previous</Button>
          <Button onClick={() => setOffset(offset + 25)} variant="secondary">Next</Button>
        </div>
      ) : null}
    </div>
  );
}

function QueueItem({ field, item, canDecide, canCreate, onDecide }: {
  field: CustomerStdField; item: CustomerStdQueueItem; canDecide: boolean; canCreate: boolean;
  onDecide: (item: CustomerStdQueueItem, decision: CustomerStdDecision, text: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"none" | "choose" | "create" | "move">("none");
  const options: CustomerRefOption[] = [...item.candidates, ...item.suggestions.filter((suggestion) => !item.candidates.some((candidate) => candidate.code === suggestion.code))];
  const place = field.policy === "place";
  return (
    <article aria-label={item.examples[0] ?? item.input_key} className="mb-3 rounded-2xl border border-task-border bg-task-bg p-3 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[15px] font-semibold text-task-text">{item.examples.join(" · ") || item.input_key}</p>
        <p className="text-sm text-task-text-muted">{item.customers.toLocaleString("en-IN")} customers · {item.observations.toLocaleString("en-IN")} answers</p>
      </div>
      <p className="text-xs text-task-text-muted">{STATUS_LABELS[item.status] ?? item.status}{item.sources.length ? ` · from ${item.sources.join(", ")}` : ""}</p>
      {canDecide ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {options.map((option) => (
            <Button key={option.code} onClick={() => void onDecide(item, { map: option.code }, `now ${option.label}`)} variant="secondary">
              {option.label}{option.parent ? `, ${option.parent}` : ""}{option.kind && place ? ` (${option.kind})` : ""}
            </Button>
          ))}
          <Button onClick={() => setMode(mode === "choose" ? "none" : "choose")} variant="ghost">Choose a value…</Button>
          {canCreate ? <Button onClick={() => setMode(mode === "create" ? "none" : "create")} variant="ghost">New value…</Button> : null}
          {place ? <Button onClick={() => setMode(mode === "move" ? "none" : "move")} variant="ghost">Belongs to another level…</Button> : null}
          <Button onClick={() => void onDecide(item, { status: "missing" }, "not recorded")} variant="ghost">Not recorded</Button>
          <Button onClick={() => void onDecide(item, { status: "invalid" }, "not valid")} variant="ghost">Not valid</Button>
          <Button onClick={() => void onDecide(item, { status: "other" }, "other")} variant="ghost">Other</Button>
          <Button onClick={() => void onDecide(item, { status: "ambiguous" }, "unclear")} variant="ghost">Unclear</Button>
        </div>
      ) : null}
      {mode === "choose" && field.domain ? <ValueSearch domain={field.domain} onPick={(option) => void onDecide(item, { map: option.code }, `now ${option.label}`)} /> : null}
      {mode === "move" ? (
        <MoveToLevel onPick={(level, option) => void onDecide(item, { move: { field: level, code: option.code } }, `now the ${level} ${option.label}`)} />
      ) : null}
      {mode === "create" && field.domain ? (
        <CreateValue defaultLabel={item.examples[0] ?? ""} domain={field.domain} place={place}
          onCreate={(label, kind, parent) => void onDecide(item, { create: { label, ...(kind ? { kind } : {}), ...(parent ? { parent } : {}) } }, `now the new value ${label}`)} />
      ) : null}
    </article>
  );
}

/** Find an approved value of a list by any of its names. */
function ValueSearch({ domain, onPick, kinds }: { domain: string; onPick: (option: CustomerRefOption) => void; kinds?: readonly string[] }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CustomerRefValue[]>([]);
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      loadCustomerRefValues(domain, query).then((page) => { if (current) setItems(page.items); }).catch(() => { if (current) setItems([]); });
    }, 300);
    return () => { current = false; window.clearTimeout(timer); };
  }, [domain, query]);
  const shown = items.filter((item) => item.active && (!kinds || (item.kind && kinds.includes(item.kind))));
  return (
    <div className="mt-2 rounded-lg border border-task-border p-2">
      <input aria-label="Find a value" className="field mb-1" onChange={(event) => setQuery(event.target.value)} placeholder="Type a name" value={query} />
      <div className="max-h-48 overflow-y-auto">
        {shown.map((item) => (
          <button className="block w-full rounded px-2 py-1 text-left text-sm text-task-text hover:bg-gold/10" key={item.code}
            onClick={() => onPick({ code: item.code, label: item.label, kind: item.kind, parent: item.parent?.label ?? null })} type="button">
            {item.label}{item.parent ? `, ${item.parent.label}` : ""}{item.kind ? ` (${item.kind})` : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

function MoveToLevel({ onPick }: { onPick: (level: string, option: CustomerRefOption) => void }) {
  const [level, setLevel] = useState<string>("state");
  return (
    <div className="mt-2">
      <label className="flex items-center gap-2 text-sm text-task-text">
        This is a
        <select aria-label="Level" className="field w-auto" onChange={(event) => setLevel(event.target.value)} value={level}>
          <option value="state">state</option><option value="country">country</option><option value="district">district</option>
        </select>
      </label>
      <ValueSearch domain="place" kinds={[level]} onPick={(option) => onPick(level, option)} />
    </div>
  );
}

function CreateValue({ domain, place, defaultLabel, onCreate }: {
  domain: string; place: boolean; defaultLabel: string; onCreate: (label: string, kind: string | null, parent: string | null) => void;
}) {
  const [label, setLabel] = useState(defaultLabel.trim());
  const [kind, setKind] = useState<string>("locality");
  const [parent, setParent] = useState<CustomerRefOption | null>(null);
  const parentKinds = kind === "locality" ? ["city"] : kind === "city" || kind === "district" ? ["state", "country"] : kind === "state" ? ["country"] : [];
  return (
    <div className="mt-2 grid gap-2 rounded-lg border border-task-border p-2">
      <input aria-label="Name of the new value" className="field" onChange={(event) => setLabel(event.target.value)} value={label} />
      {place ? (
        <>
          <select aria-label="Kind of place" className="field" onChange={(event) => { setKind(event.target.value); setParent(null); }} value={kind}>
            {PLACE_KINDS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          {parentKinds.length ? (
            parent ? <p className="text-sm text-task-text">In: {parent.label} <Button onClick={() => setParent(null)} variant="ghost">Change</Button></p>
              : <ValueSearch domain="place" kinds={parentKinds} onPick={setParent} />
          ) : null}
        </>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={!label.trim() || (place && parentKinds.length > 0 && !parent)} onClick={() => onCreate(label.trim(), place ? kind : null, parent?.code ?? null)}>Create and use</Button>
      </div>
      {domain === "place" ? null : <p className="text-xs text-task-text-muted">The new value joins the list for this field.</p>}
    </div>
  );
}

function Rules({ field, can, onChanged }: { field: CustomerStdField; can: CustomerStdOverview["can"]; onChanged: () => void }) {
  const [rules, setRules] = useState<CustomerStdRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { loadCustomerStdRules(field.key).then(setRules).catch((reason: unknown) => setError(errorMessage(reason))); }, [field.key]);
  useEffect(() => { load(); }, [load]);
  const run = async (work: () => Promise<void>) => {
    setError(null);
    try { await work(); load(); onChanged(); } catch (reason) { setError(errorMessage(reason)); }
  };
  return (
    <div>
      {error ? <div className="mb-3"><Notice tone="danger">{error}</Notice></div> : null}
      {rules && rules.length === 0 ? <p className="text-task-text-muted">No rules yet.</p> : null}
      <ul className="space-y-2">
        {(rules ?? []).map((rule) => (
          <li className="rounded-xl border border-task-border bg-task-bg p-3" key={rule.id}>
            <p className="text-sm font-semibold text-task-text">
              "{rule.input_key}" → {rule.outputs.map((output) => `${output.field}: ${output.label ?? (output.status ? STATUS_LABELS[output.status] ?? output.status : output.code)}`).join(" and ")}
            </p>
            <p className="text-xs text-task-text-muted">
              {rule.status} · version {rule.version} · by {rule.approved_by ?? rule.created_by ?? "system"} on {formatDate(rule.approved_at ?? rule.created_at)}
              {rule.ended_at ? ` · ended by ${rule.ended_by ?? "system"} on ${formatDate(rule.ended_at)}` : ""}{rule.reason ? ` · ${rule.reason}` : ""}
            </p>
            <div className="mt-1 flex gap-2">
              {rule.status === "approved" && can.rollback ? (
                <Button onClick={() => { const reason = window.prompt("Why end this rule?"); if (reason) void run(() => endCustomerStdRule(rule.id, reason)); }} variant="ghost">End rule</Button>
              ) : null}
              {rule.status === "draft" && can.approve ? (
                <>
                  <Button onClick={() => void run(() => reviewCustomerStdDraft(rule.id, true))} variant="secondary">Approve</Button>
                  <Button onClick={() => void run(() => reviewCustomerStdDraft(rule.id, false))} variant="ghost">Reject</Button>
                </>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Values({ domain, can, place }: { domain: string; can: CustomerStdOverview["can"]; place: boolean }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<{ total: number; items: CustomerRefValue[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { loadCustomerRefValues(domain, query).then(setPage).catch((reason: unknown) => setError(errorMessage(reason))); }, [domain, query]);
  useEffect(() => { const timer = window.setTimeout(load, 300); return () => window.clearTimeout(timer); }, [load]);
  const save = async (request: Readonly<Record<string, string | null | undefined>>) => {
    setError(null);
    try { await saveCustomerRefValue(request); load(); } catch (reason) { setError(errorMessage(reason)); }
  };
  return (
    <div>
      <input aria-label="Find a value" className="field mb-3" onChange={(event) => setQuery(event.target.value)} placeholder="Find a value by any name" value={query} />
      {error ? <div className="mb-3"><Notice tone="danger">{error}</Notice></div> : null}
      {page ? <p className="mb-2 text-sm text-task-text-muted">{page.total.toLocaleString("en-IN")} values{page.total > 100 ? " (first 100 shown; search to narrow)" : ""}.</p> : null}
      <ul className="space-y-2">
        {(page?.items ?? []).map((item) => (
          <li className={cn("rounded-xl border border-task-border bg-task-bg p-3", !item.active && "opacity-60")} key={item.code}>
            <p className="text-sm font-semibold text-task-text">
              {item.label}{place && item.kind ? ` (${item.kind}${item.parent ? `, ${item.parent.label}` : ""})` : ""}
              {!item.active ? (item.superseded_by ? ` · now ${item.superseded_by}` : " · inactive") : ""}
            </p>
            <p className="text-xs text-task-text-muted">
              Also written as: {item.aliases.length ? item.aliases.join(", ") : "nothing else yet"} · {item.customers.toLocaleString("en-IN")} customers · code {item.code}
            </p>
            {can.reference ? (
              <div className="mt-1 flex flex-wrap gap-2">
                <Button onClick={() => { const label = window.prompt("New name", item.label); if (label) void save({ action: "rename", code: item.code, label }); }} variant="ghost">Rename</Button>
                <Button onClick={() => { const aliases = window.prompt("Other names, separated by |"); if (aliases) void save({ action: "alias", code: item.code, aliases }); }} variant="ghost">Add other names</Button>
                <Button onClick={() => void save({ action: item.active ? "deactivate" : "activate", code: item.code })} variant="ghost">{item.active ? "Deactivate" : "Activate"}</Button>
                {item.active ? (
                  <Button onClick={() => { const into = window.prompt("Merge into which value? Type its code (for example place:mumbai)"); if (into) void save({ action: "merge", code: item.code, into }); }} variant="ghost">Merge into…</Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
