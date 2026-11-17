import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, CalendarClock, Phone, UserRound } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { errorMessage, titleCase } from "@/lib/format";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { CUSTOMER_SEGMENT_LABELS, CUSTOMER_STAGE_LABELS, daysAgoLabel, formatPhone, type CustomerLifecycleStage, type CustomerSegment } from "@jewelos/core";
import { loadCustomerClientPage, loadCustomerTimeline, type CustomerAnswer, type CustomerClientPage, type CustomerTimelineEntry } from "./api";
import { appointmentLabel, channelLabel, followUpLabel, formatDate, formatDateTime, formatProfileDate, RESULT_LABEL, RESULT_TONE } from "./format";

type Tab = "details" | "timeline" | "follow_ups";
const TABS: { key: Tab; label: string }[] = [{ key: "details", label: "Details" }, { key: "timeline", label: "Timeline" }, { key: "follow_ups", label: "Follow-ups" }];
const TIMELINE_PAGE = 50;

/** Profile answers grouped the way staff look for them. Anything not named here goes under "Other details". */
const GROUPS: { title: string; keys: string[] }[] = [
  { title: "Contact", keys: ["email", "address", "city", "state", "country", "pincode", "communication_preference", "marketing_message"] },
  { title: "Personal", keys: ["gender", "dob", "dob_status", "anniversary", "marital_status", "community", "occupation"] },
  { title: "Hospitality", keys: ["beverage", "sugar", "snack"] },
];

export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-task-border p-4">
      <h2 className="mb-3 font-display text-lg font-semibold text-gold-secondary">{title}{count !== undefined ? <span className="ml-2 text-sm font-normal text-soft-grey">{count}</span> : null}</h2>
      {children}
    </section>
  );
}

export function Fact({ label, children, caption }: { label: string; children: ReactNode; caption?: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wide text-soft-grey">{label}</dt>
      <dd className="break-words text-base text-champagne">{children}</dd>
      {caption ? <dd className="text-xs text-soft-grey">{caption}</dd> : null}
    </div>
  );
}

export function CodeLink({ code, onOpen, label }: { code: string; onOpen: (code: string) => void; label?: string }) {
  return <button className="font-mono text-sm text-gold-secondary underline underline-offset-2" onClick={() => onOpen(code)} type="button">{label ?? code}</button>;
}

function answerValue(answer: CustomerAnswer): string {
  if (answer.field_key === "dob" || answer.field_key === "anniversary") {
    const match = /^--(\d{2})-(\d{2})$/.exec(answer.value);
    return (match ? formatProfileDate(`1904-${match[1]}-${match[2]}`, false) : formatProfileDate(answer.value, true)) ?? answer.value;
  }
  return answer.value;
}

function AnswerFacts({ answers, keys }: { answers: readonly CustomerAnswer[]; keys: readonly string[] | null }) {
  const current = answers.filter((answer) => answer.is_current && (keys ? keys.includes(answer.field_key) : true));
  const ordered = keys ? [...current].sort((a, b) => keys.indexOf(a.field_key) - keys.indexOf(b.field_key)) : current;
  if (ordered.length === 0) return <p className="text-sm text-soft-grey">Nothing recorded yet.</p>;
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {ordered.map((answer) => {
        const earlier = answers.filter((other) => other.field_key === answer.field_key && !other.is_current && other.value.toLowerCase() !== answer.value.toLowerCase());
        return (
          <div className="min-w-0" key={answer.field_key}>
            <Fact caption={`${answer.source_label}, ${formatDate(answer.observed_at)}`} label={answer.label}>{answerValue(answer)}</Fact>
            {earlier.length ? <p className="text-xs text-soft-grey">Earlier: {earlier.map((item) => `${answerValue(item)} (${item.source_label}, ${formatDate(item.observed_at)})`).join("; ")}</p> : null}
            {earlier.some((item) => item.needs_review) ? <p className="text-xs text-danger">A newer answer from a lower-priority source needs a check.</p> : null}
          </div>
        );
      })}
    </dl>
  );
}

export function TimelineEntry({ entry, onOpen }: { entry: CustomerTimelineEntry; onOpen: (code: string) => void }) {
  return (
    <li>
      <button aria-label={`Open interaction ${entry.interaction_code}`} className="w-full rounded-lg border border-task-border p-3 text-left hover:border-gold/50 hover:bg-gold/5" onClick={() => onOpen(entry.interaction_code)} type="button">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span className="font-semibold text-champagne">{formatDateTime(entry.occurred_at)}</span>
          <span className="text-soft-grey">{channelLabel(entry.channel)}</span>
          <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${RESULT_TONE[entry.result]}`}>{RESULT_LABEL[entry.result]}</span>
          <span className="ml-auto font-mono text-xs text-soft-grey">{entry.interaction_code}</span>
        </span>
        <span className="mt-1 block text-base text-champagne">
          {entry.outcome ?? (entry.successful ? "Reached" : "Not reached")}{entry.non_contact_reason ? ` (${entry.non_contact_reason})` : ""}
        </span>
        <span className="block text-xs text-soft-grey">{[entry.staff ? `By ${entry.staff}` : null, entry.attended_by ? `Attended by ${entry.attended_by}` : null, entry.branch].filter(Boolean).join(" · ")}</span>
        {entry.notes ? <span className="mt-1 block whitespace-pre-wrap break-words text-sm text-soft-grey">{entry.notes}</span> : null}
        {entry.follow_ups.length + entry.appointments.length > 0 ? (
          <span className="mt-1 block text-xs text-soft-grey">
            Led to: {[...entry.follow_ups.map((item) => `${followUpLabel(item.kind)} on ${formatDate(item.due_at)}`), ...entry.appointments.map((item) => `${appointmentLabel(item.type)} on ${formatDate(item.scheduled_at)}`)].join(", ")}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** One customer on a full page: every detail held about them and every interaction (/crm/master/c/MKC-...). */
export function CustomerProfileView({ clientCode, onBack, onOpenClient, onOpenInteraction }: {
  clientCode: string; onBack: () => void; onOpenClient: (code: string) => void; onOpenInteraction: (code: string) => void;
}) {
  const [data, setData] = useState<CustomerClientPage | null>(null);
  const [timeline, setTimeline] = useState<CustomerTimelineEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [tab, setTab] = useState<Tab>("details");
  const wide = useMediaQuery("(min-width: 1024px)");

  useEffect(() => {
    let current = true;
    setData(null); setTimeline(null); setError(null); setReachedEnd(false);
    loadCustomerClientPage(clientCode).then(async (value) => {
      if (!current) return;
      setData(value);
      // The timeline is addressed by the client's id, which only the page read returns.
      const entries = await loadCustomerTimeline(String(value.client.id));
      if (current) { setTimeline(entries); setReachedEnd(entries.length < TIMELINE_PAGE); }
    }).catch((reason: unknown) => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [clientCode]);

  const loadMore = async () => {
    const last = timeline?.at(-1);
    if (!last || !data) return;
    setLoadingMore(true);
    try {
      const more = await loadCustomerTimeline(String(data.client.id), last.occurred_at);
      setTimeline((existing) => [...(existing ?? []), ...more]);
      setReachedEnd(more.length < TIMELINE_PAGE);
    } catch (reason) { setError(errorMessage(reason)); } finally { setLoadingMore(false); }
  };

  const back = <Button onClick={onBack} variant="ghost"><ArrowLeft className="h-4 w-4" />All customers</Button>;
  if (error && !data) return <section className="w-full">{back}<div className="mt-3"><Notice tone="danger">{error}</Notice></div></section>;
  if (!data) return <section className="w-full">{back}<p className="mt-6 text-center text-soft-grey">Loading customer…</p></section>;

  const client = data.client;
  const text = (key: string) => { const value = client[key]; return typeof value === "string" && value ? value : null; };
  const count = (key: string) => { const value = client[key]; return typeof value === "number" ? value : 0; };
  const name = text("primary_name") ?? "Unnamed customer";
  const primaryPhone = data.phones.find((item) => item.kind === "primary")?.phone ?? null;
  const otherPhones = data.phones.filter((item) => item.kind !== "primary");
  const otherNames = data.names.filter((item) => item.name !== text("primary_name"));
  const family = data.family?.members.filter((member) => member.client_id !== client.id) ?? [];
  const grouped = new Set(GROUPS.flatMap((group) => group.keys));
  const otherAnswers = data.answers.filter((answer) => !grouped.has(answer.field_key));
  const pendingFollowUps = data.follow_ups.filter((item) => item.status === "pending");
  // The database constrains both columns to exactly these values (migration 0405 check constraints).
  const segment = text("segment") as CustomerSegment | null;
  const stage = text("lifecycle_stage") as CustomerLifecycleStage | null;
  const lastReached = text("last_contacted_at");

  const details = (
    <div className="space-y-4">
      <Section title="Identity">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          <Fact label="Client ID"><span className="font-mono">{text("client_code")}</span></Fact>
          {data.family ? <Fact label="Family ID"><span className="font-mono">{data.family.household_code}</span></Fact> : null}
          <Fact label="Referral ID"><span className="font-mono">{text("referral_code")}</span></Fact>
          <Fact label="Mobile number">{primaryPhone ? formatPhone(primaryPhone) : "No phone number"}</Fact>
          {otherPhones.length ? <Fact label="Other phones">{otherPhones.map((item) => `${formatPhone(item.phone)} (${item.kind})`).join(", ")}</Fact> : null}
          {otherNames.length ? <Fact label="Other names">{otherNames.map((item) => item.name).join(", ")}</Fact> : null}
          {data.identifiers.filter((item) => item.type !== "email").map((item) => <Fact key={`${item.type}:${item.value}`} label={titleCase(item.type)}>{item.value}</Fact>)}
          <Fact label="First seen">{formatDate(text("first_seen_at")) || "Not known"}</Fact>
          {text("first_source") ? <Fact label="First source">{data.sheet_rows.find((item) => item.source === text("first_source"))?.label ?? titleCase(text("first_source") ?? "")}</Fact> : null}
        </dl>
      </Section>
      {GROUPS.map((group) => <Section key={group.title} title={group.title}><AnswerFacts answers={data.answers} keys={group.keys} /></Section>)}
      {otherAnswers.length ? <Section title="Other details"><AnswerFacts answers={otherAnswers} keys={null} /></Section> : null}
      <Section title="Family and referral">
        {family.length === 0 && !data.referred_by ? <p className="text-sm text-soft-grey">No family members or referrer recorded.</p> : null}
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {family.length ? <Fact label="Family members">{family.map((member, index) => <span key={member.client_id}>{index ? ", " : ""}{member.name ?? "Unnamed"} <CodeLink code={member.client_code} onOpen={onOpenClient} /></span>)}</Fact> : null}
          {data.referred_by ? <Fact label="Referred by">{data.referred_by.name ?? "Unnamed"} <CodeLink code={data.referred_by.client_code} onOpen={onOpenClient} /></Fact> : null}
        </dl>
      </Section>
      {data.products.length ? (
        <Section count={data.products.length} title="Products">
          <ul className="space-y-2">{data.products.map((product, index) => (
            <li className="text-sm text-champagne" key={`${product.interaction_code}:${index}`}>
              {[product.code, product.category].filter(Boolean).join(" · ")} <span className="text-soft-grey">({titleCase(product.interest)}, {formatDate(product.occurred_at)})</span>{" "}
              <CodeLink code={product.interaction_code} onOpen={onOpenInteraction} />
            </li>
          ))}</ul>
        </Section>
      ) : null}
      <Section title="Where this comes from">
        {data.sheet_rows.length === 0 ? <p className="text-sm text-soft-grey">No sheet rows are linked to this customer.</p> : (
          <ul className="space-y-1 text-sm text-champagne">{data.sheet_rows.map((item) => <li key={item.source}>{item.label}: {item.rows} row{item.rows === 1 ? "" : "s"}</li>)}</ul>
        )}
      </Section>
    </div>
  );

  const followUps = (
    <div className="space-y-4">
      <Section count={data.follow_ups.length} title="Follow-ups">
        {data.follow_ups.length === 0 ? <p className="text-sm text-soft-grey">No follow-ups.</p> : (
          <ul className="space-y-2">{data.follow_ups.map((item) => (
            <li className="rounded-lg border border-task-border p-3 text-sm" key={item.code}>
              <span className="font-semibold text-champagne">{followUpLabel(item.kind)}</span> <span className="text-soft-grey">due {formatDate(item.due_at)} · {titleCase(item.status)}</span>
              <span className="block text-xs text-soft-grey">
                {[item.assigned_to ? `For ${item.assigned_to}` : null, item.reason].filter(Boolean).join(" · ")}
                {item.origin_interaction_code ? <> · From <CodeLink code={item.origin_interaction_code} onOpen={onOpenInteraction} /></> : null}
                {item.closed_by_interaction_code ? <> · Closed by <CodeLink code={item.closed_by_interaction_code} onOpen={onOpenInteraction} /></> : null}
              </span>
            </li>
          ))}</ul>
        )}
      </Section>
      <Section count={data.appointments.length} title="Appointments">
        {data.appointments.length === 0 ? <p className="text-sm text-soft-grey">No appointments.</p> : (
          <ul className="space-y-2">{data.appointments.map((item) => (
            <li className="rounded-lg border border-task-border p-3 text-sm" key={item.code}>
              <span className="font-semibold text-champagne">{appointmentLabel(item.type)}</span> <span className="text-soft-grey">{formatDateTime(item.scheduled_at)} · {titleCase(item.status)}{item.branch ? ` · ${item.branch}` : ""}</span>
              {item.origin_interaction_code ? <span className="block text-xs text-soft-grey">Booked in <CodeLink code={item.origin_interaction_code} onOpen={onOpenInteraction} /></span> : null}
            </li>
          ))}</ul>
        )}
      </Section>
    </div>
  );

  const timelineBlock = (
    <Section count={count("interaction_count")} title="Timeline">
      {timeline === null ? <p className="text-sm text-soft-grey">Loading timeline…</p> : null}
      {timeline?.length === 0 ? <p className="text-sm text-soft-grey">No interactions recorded yet.</p> : null}
      <ol className="space-y-2">{timeline?.map((entry) => <TimelineEntry entry={entry} key={entry.interaction_id} onOpen={onOpenInteraction} />)}</ol>
      {timeline && timeline.length > 0 && !reachedEnd ? <Button className="mt-3" disabled={loadingMore} onClick={() => void loadMore()} variant="secondary">{loadingMore ? "Loading…" : "Show older"}</Button> : null}
    </Section>
  );

  return (
    <section className="w-full">
      {back}
      <header className="mb-4 mt-2 rounded-xl border border-task-border p-4">
        <div className="flex flex-wrap items-start gap-3">
          <span className="rounded-xl bg-gold-sheen p-3 text-on-gold shadow-gold"><UserRound className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <h1 className="break-words font-display text-[1.6rem] font-semibold leading-tight text-gold-secondary sm:text-[2rem]">{name}</h1>
            <p className="text-sm text-soft-grey">
              <span className="font-mono text-champagne">{text("client_code")}</span>
              {text("city") ? ` · ${text("city")}` : ""}
              {segment ? ` · ${CUSTOMER_SEGMENT_LABELS[segment]}` : ""}{stage ? ` · ${CUSTOMER_STAGE_LABELS[stage]}` : ""}
            </p>
          </div>
          {primaryPhone ? <a className="inline-flex min-h-12 items-center gap-2 rounded-lg border border-gold/30 px-4 text-base font-semibold text-champagne hover:bg-gold/10" href={`tel:+${primaryPhone}`}><Phone className="h-5 w-5" />{formatPhone(primaryPhone)}</a> : null}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Last reached">{lastReached ? daysAgoLabel(lastReached) : text("last_attempt_at") ? "Tried, never reached" : "Never contacted"}</Fact>
          <Fact label="Interactions">{count("interaction_count")} <span className="text-sm text-soft-grey">({count("successful_interaction_count")} reached)</span></Fact>
          <Fact label="Follow-ups pending">{pendingFollowUps.length}</Fact>
          <Fact label="Next follow-up">{pendingFollowUps.length ? <span className="inline-flex items-center gap-1"><CalendarClock className="h-4 w-4" />{formatDate([...pendingFollowUps].sort((a, b) => a.due_at.localeCompare(b.due_at))[0]?.due_at)}</span> : "None"}</Fact>
        </dl>
        {data.archived ? <div className="mt-3"><Notice>This customer is archived{data.archive_reason ? ` (${titleCase(data.archive_reason)})` : ""}.</Notice></div> : null}
        {client.do_not_call === true ? <div className="mt-3"><Notice tone="danger">Do not call this customer.</Notice></div> : null}
      </header>
      {error ? <div className="mb-3"><Notice tone="danger">{error}</Notice></div> : null}

      {wide ? (
        <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-4">
          <div className="space-y-4">{details}{followUps}</div>
          {timelineBlock}
        </div>
      ) : (
        <>
          <div aria-label="Customer sections" className="mb-3 grid grid-cols-3 gap-2" role="tablist">
            {TABS.map((item) => (
              <button aria-selected={tab === item.key} className={`min-h-12 rounded-lg border px-2 text-sm font-semibold ${tab === item.key ? "border-gold bg-gold/10 text-gold-secondary" : "border-task-border text-soft-grey"}`} key={item.key} onClick={() => setTab(item.key)} role="tab" type="button">
                {item.label}{item.key === "follow_ups" && pendingFollowUps.length ? ` (${pendingFollowUps.length})` : ""}
              </button>
            ))}
          </div>
          {tab === "details" ? details : tab === "timeline" ? timelineBlock : followUps}
        </>
      )}
    </section>
  );
}
