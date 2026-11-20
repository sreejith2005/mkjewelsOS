import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { errorMessage } from "@/lib/format";
import { formatPhone } from "@jewelos/core";
import { decideCustomerReview, loadCustomerReviewList, type CustomerReviewItem, type CustomerReviewSide } from "./api";
import { CodeLink } from "./CustomerProfileView";
import { formatDate } from "./format";
import { InfoRow, Tags } from "./parts";

const RESULT_TEXT: Record<string, string> = {
  merged: "Merged into one customer.",
  kept_separate: "Kept as two customers.",
  kept_joined: "Kept as one customer.",
  separated: "Separated into two customers.",
};

/**
 * "Possibly same person" (/crm/master/review, migration 0438): pairs of
 * records that may be one person wait here for a verdict. Same person merges
 * a flagged pair (or keeps a join); different people keep them apart (or
 * separate a join), and the pair is never flagged or joined again.
 */
export function CustomerReviewView({ onBack, onOpenClient }: { onBack: () => void; onOpenClient: (clientCode: string) => void }) {
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

  const back = <Button className="-ml-2" onClick={onBack} variant="ghost"><ArrowLeft className="h-4 w-4" />All customers</Button>;
  const joined = (items ?? []).filter((item) => item.kind === "joined");
  const possible = (items ?? []).filter((item) => item.kind === "possible");

  return (
    <section className="w-full">
      {back}
      <header className="mb-4 mt-1">
        <h1 className="text-xl font-semibold text-task-text">Possibly same person</h1>
        <p className="mt-1 text-sm text-task-text-muted">
          Two records whose numbers appeared together on a sheet row. Same person merges them into one customer; different people keeps them apart for good.
        </p>
      </header>
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
    </section>
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
