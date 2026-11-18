import { useId, useState, type ReactNode } from "react";
import { ChevronDown, History } from "lucide-react";
import { customerTags, type CustomerTag, type CustomerTagTone } from "@jewelos/core";
import { cn } from "@/lib/utils";

/**
 * Building blocks of the customer master screens. Every screen uses these so
 * labels, values and tags look the same everywhere: labels in one muted
 * colour and size, values in the main text colour, one row per fact.
 */

const TONE: Record<CustomerTagTone, string> = {
  client: "border-success bg-success text-on-gold",
  lead: "border-warning/45 bg-warning/15 text-task-text",
  danger: "border-danger bg-danger text-on-gold",
  warning: "border-warning/45 bg-warning/10 text-task-text",
  gold: "border-gold/50 bg-gold/15 text-task-text",
  neutral: "border-task-border bg-task-muted text-task-text",
  // Ticket size, from the deepest gold down to plain.
  tier_top: "border-gold bg-gold-sheen text-on-gold shadow-gold",
  tier_high: "border-gold bg-gold/35 text-task-text",
  tier_mid: "border-gold/60 bg-gold/15 text-task-text",
  tier_base: "border-task-border bg-task-bg text-task-text",
};

export function Tag({ tag }: { tag: CustomerTag }) {
  return (
    <span className={cn("inline-flex max-w-full items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold leading-5", TONE[tag.tone])}>
      <span className="truncate">{tag.label}</span>
    </span>
  );
}

/** Client or lead, then the customer's categories. */
export function Tags({ segment, keys, className }: { segment: string | null | undefined; keys: readonly string[] | null | undefined; className?: string }) {
  return <span className={cn("flex min-w-0 flex-wrap gap-1.5", className)}>{customerTags(segment, keys).map((tag) => <Tag key={tag.key} tag={tag} />)}</span>;
}

/** A titled card holding rows of facts. Cards with `collapsible` fold away. */
export function InfoCard({ title, count, children, collapsible = false, defaultOpen = true, action }: {
  title: string; count?: number | undefined; children: ReactNode; collapsible?: boolean; defaultOpen?: boolean; action?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const heading = <>{title}{count !== undefined ? <span className="ml-2 rounded-full bg-task-muted px-2 py-0.5 text-xs font-semibold text-task-text-muted">{count}</span> : null}</>;
  return (
    <section className="mb-4 break-inside-avoid rounded-xl border border-task-border bg-task-bg shadow-card">
      <header className="flex min-h-12 items-center gap-2 border-b border-task-border px-4">
        {collapsible ? (
          <button aria-controls={bodyId} aria-expanded={open} className="flex min-h-12 flex-1 items-center justify-between gap-2 text-left text-base font-semibold text-task-text" onClick={() => setOpen((value) => !value)} type="button">
            <span>{heading}</span>
            <ChevronDown aria-hidden className={cn("h-5 w-5 text-task-text-muted transition-transform", open && "rotate-180")} />
          </button>
        ) : <h2 className="flex-1 text-base font-semibold text-task-text">{heading}</h2>}
        {action}
      </header>
      {open ? <div className="px-4 py-1" id={bodyId}>{children}</div> : null}
    </section>
  );
}

export type EarlierValue = Readonly<{ value: string; source: string; date: string }>;

/**
 * One fact: label on the left, value on the right; long values move under the
 * label so words never break into pieces on a phone. Earlier values stay
 * hidden until "earlier" is opened.
 */
export function InfoRow({ label, children, empty = false, earlier = [], current, stacked = false }: {
  label: string; children?: ReactNode; empty?: boolean; earlier?: readonly EarlierValue[]; current?: string | null | undefined;
  /** Value under the label, for values with links or lists. */
  stacked?: boolean;
}) {
  const [showHistory, setShowHistory] = useState(false);
  const long = !empty && (stacked || (typeof children === "string" && children.length > 28));
  return (
    <div className="border-b border-dashed border-task-border py-3 last:border-b-0">
      <div className={cn("gap-x-4", long ? "block" : "flex items-baseline justify-between")}>
        <dt className="shrink-0 text-sm text-task-text-muted">{label}</dt>
        <dd className={cn("min-w-0 break-words text-[15px] font-medium text-task-text", long ? "mt-1" : "text-right")}>
          {empty ? <span aria-label="Not recorded" className="font-normal text-task-text-muted">—</span> : children}
        </dd>
      </div>
      {earlier.length > 0 ? (
        <div className="mt-1">
          <button aria-expanded={showHistory} className="inline-flex min-h-8 items-center gap-1 text-[13px] font-semibold text-gold-secondary" onClick={() => setShowHistory((value) => !value)} type="button">
            <History aria-hidden className="h-3.5 w-3.5" />{showHistory ? "Hide history" : `${earlier.length} earlier ${earlier.length === 1 ? "value" : "values"}`}
          </button>
          {showHistory ? (
            <ul className="mt-1 space-y-1.5 rounded-lg bg-task-muted p-2.5 text-sm">
              {current ? <li className="text-task-text-muted">Now from {current}</li> : null}
              {earlier.map((item, index) => (
                <li className="text-task-text" key={`${item.value}:${index}`}>
                  <span className="break-words">{item.value}</span>
                  <span className="block text-[13px] text-task-text-muted">{item.source}{item.date ? `, ${item.date}` : ""}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
