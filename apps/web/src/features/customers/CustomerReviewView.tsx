import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { errorMessage } from "@/lib/format";
import { formatPhone } from "@jewelos/core";
import { cn } from "@/lib/utils";
import {
  decideCustomerReview, loadCustomerReviewList, loadCustomerReviewQueue,
  type CustomerReviewItem, type CustomerReviewQueueItem, type CustomerReviewQueueKind, type CustomerReviewSide,
} from "./api";
import { CodeLink } from "./CustomerProfileView";
import { formatDate } from "./format";
import { InfoRow, Tags } from "./parts";

const RESULT_TEXT: Record<string, string> = {
  merged: "Merged into one customer.",
  kept_separate: "Kept as two customers.",
  kept_joined: "Kept as one customer.",
  separated: "Separated into two customers.",
  kept_names: "Kept as one customer with both names.",
  split: "Split off as its own customer in the same family.",
};

type ReviewTab = "possible" | CustomerReviewQueueKind;
const TABS: readonly Readonly<{ key: ReviewTab; label: string; help: string }>[] = [
  { key: "possible", label: "Possibly same person", help: "Two records whose numbers appeared together on a sheet row. Same person merges them into one customer; different people keeps them apart for good." },
  { key: "same_name", label: "Same name, different numbers", help: "Two records with the same full name and their own numbers. Merge if it is one person who came with a new number (both numbers are kept); keep separate if they are different people. Either way the pair is not asked again." },
  { key: "shared_phone", label: "One number, different names", help: "One number that was written down with another person's name. Same person keeps the name as an other name. Different people splits that name off as its own customer in the same family, with the sheet rows written under it; the number stays with this customer." },
];

/** The review page: the three kinds of possible duplicates (migrations 0438, 0453). */
export function CustomerReviewView({ onBack, onOpenClient }: { onBack: () => void; onOpenClient: (clientCode: string) => void }) {
  const [tab, setTab] = useState<ReviewTab>("possible");
  const back = <Button className="-ml-2" onClick={onBack} variant="ghost"><ArrowLeft className="h-4 w-4" />All customers</Button>;
  const current = TABS.find((item) => item.key === tab);
  return (
    <section className="w-full">
      {back}
      <header className="mb-3 mt-1">
        <h1 className="text-xl font-semibold text-task-text">Review duplicates</h1>
      </header>
      <div aria-label="Kinds of duplicates" className="mb-3 flex gap-1 overflow-x-auto" role="tablist">
        {TABS.map((item) => (
          <button aria-selected={tab === item.key} className={cn("min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold", tab === item.key ? "border-gold bg-gold/15 text-task-text" : "border-task-border bg-task-bg text-task-text-muted hover:text-task-text")} key={item.key} onClick={() => setTab(item.key)} role="tab" type="button">
            {item.label}
          </button>
        ))}
      </div>
      <p className="mb-4 text-sm text-task-text-muted">{current?.help}</p>
      {tab === "possible" ? <PossibleSamePerson onOpenClient={onOpenClient} /> : <QueueReview key={tab} kind={tab} onOpenClient={onOpenClient} />}
    </section>
  );
}

/** Same name / one number: 25 at a time, with "Show more". */
function QueueReview({ kind, onOpenClient }: { kind: CustomerReviewQueueKind; onOpenClient: (clientCode: string) => void }) {
  const [items, setItems] = useState<CustomerReviewQueueItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [decided, setDecided] = useState(0);

  useEffect(() => {
    let current = true;
    loadCustomerReviewQueue(kind).then((page) => { if (current) { setItems([...page.items]); setTotal(page.total); } })
      .catch((reason: unknown) => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [kind]);

  const more = async () => {
    try {
      // Decided items have left the queue, so the next page starts that many earlier.
      const page = await loadCustomerReviewQueue(kind, (items?.length ?? 0));
      const seen = new Set((items ?? []).map((item) => item.id));
      setItems((list) => [...(list ?? []), ...page.items.filter((item) => !seen.has(item.id))]);
      setTotal(page.total);
    } catch (reason) { setError(errorMessage(reason)); }
  };

  const decide = async (item: CustomerReviewQueueItem, same: boolean) => {
    setBusy(item.id); setError(null); setDone(null);
    try {
      const result = await decideCustomerReview(item.id, same);
      setItems((list) => (list ?? []).filter((other) => other.id !== item.id));
      setTotal((value) => Math.max(0, value - 1));
      setDecided((value) => value + 1);
      const who = item.b ? `${item.a.client_code} and ${item.b.client_code}` : `${item.a.client_code} and ${item.other_name ?? "the other name"}`;
      setDone(`${who}: ${RESULT_TEXT[result.result] ?? "Saved."}`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {error ? <div className="mb-3"><Notice tone="danger">{error}</Notice></div> : null}
      {done ? <div className="mb-3"><Notice tone="success">{done}</Notice></div> : null}
      {!items && !error ? <p className="mt-6 text-center text-task-text-muted">Loading…</p> : null}
      {items ? <p className="mb-3 text-sm font-medium text-task-text">{total.toLocaleString("en-IN")} to decide{decided ? `, ${decided} decided now` : ""}</p> : null}
      {items && items.length === 0 ? <p className="mt-6 text-center text-task-text-muted">Nothing to review.</p> : null}
      {(items ?? []).map((item) => item.b ? (
        <article aria-label={`${item.a.client_code} and ${item.b.client_code}`} className="mb-4 rounded-2xl border border-task-border bg-task-bg p-4 shadow-card" key={item.id}>
          <div className="grid gap-4 md:grid-cols-2">
            <Side onOpenClient={onOpenClient} side={item.a} title="Record 1 (older)" />
            <Side onOpenClient={onOpenClient} side={item.b} title="Record 2" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button disabled={busy === item.id} onClick={() => void decide(item, false)} variant="secondary">Keep separate</Button>
            <Button disabled={busy === item.id} onClick={() => void decide(item, true)}>Merge</Button>
          </div>
        </article>
      ) : (
        <article aria-label={`${item.a.client_code} and ${item.other_name ?? ""}`} className="mb-4 rounded-2xl border border-task-border bg-task-bg p-4 shadow-card" key={item.id}>
          <div className="grid gap-4 md:grid-cols-2">
            <Side onOpenClient={onOpenClient} side={item.a} title="Customer with this number" />
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wide text-task-text-muted">Other name on the same number</p>
              <p className="mt-1 text-lg font-semibold text-task-text">{item.other_name ?? "Unnamed"}</p>
              <p className="mt-1 text-sm text-task-text-muted">
                Written on {item.other_name_rows === 1 ? "1 sheet row" : `${item.other_name_rows ?? 0} sheet rows`}. Splitting it off moves those rows to a new customer in the same family.
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
            <Button disabled={busy === item.id} onClick={() => void decide(item, false)} variant="secondary">Different people (split off)</Button>
            <Button disabled={busy === item.id} onClick={() => void decide(item, true)}>Same person (keep name)</Button>
          </div>
        </article>
      ))}
      {items && items.length < total ? <div className="flex justify-center"><Button onClick={() => void more()} variant="secondary">Show more</Button></div> : null}
    </>
  );
}

/**
 * "Possibly same person" (/crm/master/review, migration 0438): pairs of
 * records that may be one person wait here for a verdict. Same person merges
 * a flagged pair (or keeps a join); different people keep them apart (or
 * separate a join), and the pair is never flagged or joined again.
 */
function PossibleSamePerson({ onOpenClient }: { onOpenClient: (clientCode: string) => void }) {
  const [items, setItems] = useState<CustomerReviewItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    loadCustomerReviewList().then((value) => { if (current) setItems(value); }).catch((reason: unknown) => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, []);

  const decide = async (item: CustomerReviewItem, same: boolean) => {
    setBusy(item.id); setError(null); setDone(null);
    try {
      const result = await decideCustomerReview(item.id, same);
      setItems((list) => (list ?? []).filter((other) => other.id !== item.id));
      setDone(`${item.a.client_code} and ${item.b.client_code}: ${RESULT_TEXT[result.result] ?? "Saved."}`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(null);
    }
  };

  const joined = (items ?? []).filter((item) => item.kind === "joined");
  const possible = (items ?? []).filter((item) => item.kind === "possible");

  return (
    <>
      {error ? <div className="mb-3"><Notice tone="danger">{error}</Notice></div> : null}
      {done ? <div className="mb-3"><Notice tone="success">{done}</Notice></div> : null}
      {!items && !error ? <p className="mt-6 text-center text-task-text-muted">Loading…</p> : null}
      {items && items.length === 0 ? <p className="mt-6 text-center text-task-text-muted">Nothing to review.</p> : null}

      {joined.length ? (
        <>
          <h2 className="mb-2 mt-4 text-base font-semibold text-task-text">Joined automatically ({joined.length})</h2>
          <p className="mb-3 text-sm text-task-text-muted">These were joined into one customer because they shared an old name. Different people separates them again.</p>
          {joined.map((item) => <Pair busy={busy === item.id} item={item} key={item.id} onDecide={decide} onOpenClient={onOpenClient} />)}
        </>
      ) : null}
      {possible.length ? (
        <>
          <h2 className="mb-2 mt-4 text-base font-semibold text-task-text">To decide ({possible.length})</h2>
          {possible.map((item) => <Pair busy={busy === item.id} item={item} key={item.id} onDecide={decide} onOpenClient={onOpenClient} />)}
        </>
      ) : null}
    </>
  );
}

function Pair({ item, busy, onDecide, onOpenClient }: {
  item: CustomerReviewItem; busy: boolean; onDecide: (item: CustomerReviewItem, same: boolean) => void; onOpenClient: (code: string) => void;
}) {
  const rows = item.linking_rows ?? [];
  return (
    <article aria-label={`${item.a.client_code} and ${item.b.client_code}`} className="mb-4 rounded-2xl border border-task-border bg-task-bg p-4 shadow-card">
      <div className="grid gap-4 md:grid-cols-2">
        <Side onOpenClient={onOpenClient} side={item.a} title={item.kind === "joined" ? "Kept record" : "Record 1"} />
        <Side onOpenClient={item.kind === "joined" ? null : onOpenClient} side={item.b} title={item.kind === "joined" ? "Joined into it" : "Record 2"} />
      </div>
      {rows.length ? (
        <p className="mt-3 text-sm text-task-text-muted">
          Linked by {rows.length === 1 ? "1 sheet row" : `${rows.length} sheet rows`}: {rows.map((row) => `${row.source}${row.sheet_row ? ` row ${row.sheet_row}` : ""}`).join(", ")}
        </p>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
        <Button disabled={busy} onClick={() => onDecide(item, false)} variant="secondary">Different people</Button>
        <Button disabled={busy} onClick={() => onDecide(item, true)}>Same person</Button>
      </div>
    </article>
  );
}

function Side({ side, title, onOpenClient }: { side: CustomerReviewSide; title: string; onOpenClient: ((code: string) => void) | null }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-task-text-muted">{title}</p>
      <p className="mt-1 text-lg font-semibold text-task-text">{side.name ?? "Unnamed"}</p>
      <p className="text-sm">{onOpenClient ? <CodeLink code={side.client_code} onOpen={onOpenClient} /> : side.client_code}</p>
      <Tags className="mt-2" keys={[]} segment={side.segment} />
      <dl className="mt-2">
        <Row label="Numbers" value={side.phones.length ? side.phones.map((phone) => formatPhone(phone)).join(", ") : null} />
        <Row label="Other names" value={side.other_names.length ? side.other_names.join(", ") : null} />
        <Row label="City" value={[side.city, side.franchise].filter(Boolean).join(" · ") || null} />
        <Row label="First source" value={side.first_origin ?? side.first_source} />
        <Row label="First seen" value={side.first_seen_at ? formatDate(side.first_seen_at) : null} />
        <Row label="Last contact" value={side.last_contacted_at ? formatDate(side.last_contacted_at) : null} />
        <Row label="Contacts" value={side.interaction_count === null ? null : String(side.interaction_count)} />
        <Row label="Sheet rows" value={String(side.sheet_rows)} />
      </dl>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | null }) {
  return <InfoRow empty={!value} label={label}>{value}</InfoRow>;
}
