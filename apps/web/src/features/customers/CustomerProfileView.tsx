import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft, CalendarClock, MessageCircle, Phone } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { errorMessage, titleCase } from "@/lib/format";
import { cn } from "@/lib/utils";
import { callPartsLabel, callSummary, CUSTOMER_STAGE_LABELS, daysAgoLabel, formatPhone, type CustomerLifecycleStage } from "@jewelos/core";
import { loadCustomerClientPage, loadCustomerTimeline, type CustomerAnswer, type CustomerClientPage, type CustomerTimelineEntry } from "./api";
import { appointmentLabel, channelLabel, followUpLabel, formatDate, formatDateTime, formatProfileDate, RESULT_LABEL, RESULT_TONE } from "./format";
import { InfoCard, InfoRow, Tags, type EarlierValue } from "./parts";

type Tab = "details" | "timeline" | "follow_ups";
const TIMELINE_PAGE = 50;

/**
 * The customer page groups every answer into fixed cards, so each customer's
 * page has the same shape. A field listed here always shows (a dash when
 * empty); answers not listed anywhere go to "Other details".
 */
type FieldSpec = Readonly<{ key: string; label: string }>;
type CardSpec = Readonly<{ title: string; fields: readonly FieldSpec[]; always?: boolean }>;
const CARDS: readonly CardSpec[] = [
  { title: "Personal", always: true, fields: [
    { key: "gender", label: "Gender" }, { key: "dob", label: "Date of birth" }, { key: "anniversary", label: "Anniversary" },
    { key: "marital_status", label: "Marital status" }, { key: "wedding_month", label: "Wedding month" }, { key: "wedding_year", label: "Wedding year" },
    { key: "community", label: "Community" }, { key: "occupation", label: "Occupation" },
  ] },
  { title: "Address", always: true, fields: [
    { key: "address", label: "Address" }, { key: "city", label: "City" }, { key: "state", label: "State" },
    { key: "country", label: "Country" }, { key: "pincode", label: "Pincode" },
  ] },
  { title: "Store and sales", fields: [
    { key: "client_category", label: "Ticket size" }, { key: "store", label: "Store" }, { key: "salesperson", label: "Salesperson" }, { key: "lead_source", label: "How they came" },
    { key: "first_interaction_source", label: "First contact through" }, { key: "buyer_status", label: "Buyer status (as written)" },
    { key: "first_purchase_date", label: "First purchase" }, { key: "recent_purchase_date", label: "Latest purchase" },
    { key: "last_interaction_date", label: "Last interaction (as written)" },
    { key: "client_bought_any_product", label: "Bought any product" }, { key: "not_bought_reasons", label: "Why not bought" },
  ] },
  { title: "Product interests", fields: [
    { key: "seen_categories", label: "Seen categories" }, { key: "bought_categories", label: "Bought categories" },
    { key: "seen_tags", label: "Seen tags" }, { key: "bought_tags", label: "Bought tags" },
  ] },
  { title: "Hospitality", fields: [
    { key: "beverage", label: "Beverage" }, { key: "sugar", label: "Sugar" }, { key: "snack", label: "Snack" }, { key: "gift_given", label: "Gift given" },
  ] },
  { title: "Feedback and reviews", fields: [
    { key: "google_review", label: "Google review" }, { key: "testimonial", label: "Testimonial" }, { key: "feedback", label: "Feedback" },
    { key: "thank_you_note", label: "Thank-you note" }, { key: "referrals_given", label: "Referrals given" },
  ] },
  { title: "Calling", fields: [
    { key: "do_not_contact_reason", label: "Do not contact, why" }, { key: "do_not_contact_date", label: "Do not contact since" },
    { key: "do_not_contact_noted_by", label: "Do not contact, noted by" },
    { key: "wrong_number_reason", label: "Wrong number, why" }, { key: "wrong_number_call_status", label: "Wrong number, call status" },
    { key: "wrong_number_remark", label: "Wrong number, remark" }, { key: "wrong_number_date", label: "Wrong number, noted on" },
  ] },
  { title: "Data checks", fields: [
    { key: "data_status", label: "Data status" }, { key: "contact_type", label: "Script status" },
  ] },
];
/** Shown in the Contact card, not in Other details. */
const CONTACT_KEYS = ["email", "communication_preference", "marketing_message"];

function answerValue(answer: CustomerAnswer): string {
  if (answer.field_key === "dob" || answer.field_key === "anniversary") {
    const match = /^--(\d{2})-(\d{2})$/.exec(answer.value);
    return (match ? formatProfileDate(`1904-${match[1]}-${match[2]}`, false) : formatProfileDate(answer.value, true)) ?? answer.value;
  }
  if (/_date$/.test(answer.field_key) && /^\d{4}-\d{2}-\d{2}$/.test(answer.value)) return formatProfileDate(answer.value, true) ?? answer.value;
  return answer.value;
}

/** The current answer for a field and the different values seen before it. */
function fieldOf(answers: readonly CustomerAnswer[], key: string): { current: CustomerAnswer | null; earlier: EarlierValue[] } {
  const all = answers.filter((answer) => answer.field_key === key);
  const current = all.find((answer) => answer.is_current) ?? null;
  const seen = new Set(current ? [answerValue(current).toLowerCase()] : []);
  const earlier: EarlierValue[] = [];
  for (const answer of all) {
    const value = answerValue(answer);
    if (answer === current || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    earlier.push({ value, source: answer.source_label, date: formatDate(answer.observed_at) });
  }
  return { current, earlier };
}

function AnswerRow({ answers, field }: { answers: readonly CustomerAnswer[]; field: FieldSpec }) {
  const { current, earlier } = fieldOf(answers, field.key);
  return (
    <InfoRow current={current ? `${current.source_label}, ${formatDate(current.observed_at)}` : null} earlier={earlier} empty={!current} label={field.label}>
      {current ? answerValue(current) : null}
    </InfoRow>
  );
}

/** Old name kept for the interaction page: a titled card. */
export function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return <InfoCard count={count} title={title}>{children}</InfoCard>;
}

/** Old name kept for the interaction page: one label and value. */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <InfoRow label={label}>{children}</InfoRow>;
}

export function CodeLink({ code, onOpen, label }: { code: string; onOpen: (code: string) => void; label?: string }) {
  return <button className="font-semibold text-gold-secondary underline underline-offset-2" onClick={() => onOpen(code)} type="button">{label ?? code}</button>;
}

export function TimelineEntry({ entry, onOpen }: { entry: CustomerTimelineEntry; onOpen: (code: string) => void }) {
  const led = [...entry.follow_ups.map((item) => `${followUpLabel(item.kind)} on ${formatDate(item.due_at)}`), ...entry.appointments.map((item) => `${appointmentLabel(item.type)} on ${formatDate(item.scheduled_at)}`)];
  const who = [entry.staff ? `By ${entry.staff}` : null, entry.attended_by ? `Attended by ${entry.attended_by}` : null, entry.branch].filter(Boolean).join(", ");
  return (
    <li className="relative pl-6">
      <span aria-hidden className={cn("absolute left-0 top-5 h-3 w-3 rounded-full border-2 border-task-bg", entry.result === "positive" ? "bg-success" : entry.result === "negative" ? "bg-danger" : "bg-gold")} />
      <button aria-label={`Open interaction ${entry.interaction_code}`} className="w-full rounded-xl border border-task-border bg-task-bg p-3 text-left shadow-card hover:border-gold/50" onClick={() => onOpen(entry.interaction_code)} type="button">
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-semibold text-task-text">{formatDateTime(entry.occurred_at)}</span>
          <span className={cn("rounded-full border px-2 py-0.5 text-xs font-semibold", RESULT_TONE[entry.result])}>{RESULT_LABEL[entry.result]}</span>
        </span>
        <span className="mt-1 block text-[15px] font-medium text-task-text">
          {entry.outcome ?? (entry.successful ? "Reached" : "Not reached")}{entry.non_contact_reason ? ` (${entry.non_contact_reason})` : ""}
        </span>
        <span className="mt-0.5 block text-sm text-task-text-muted">{channelLabel(entry.channel)}{who ? `, ${who}` : ""}</span>
        {callPartsLabel(entry) ? (
          <span className="mt-1 block text-sm text-task-text-muted">
            <span className="mr-2 rounded-full border border-task-border px-2 py-0.5 text-xs font-semibold text-task-text">{callPartsLabel(entry)}</span>
            {callSummary(entry.call)}
          </span>
        ) : null}
        {entry.notes ? <span className="mt-2 block whitespace-pre-wrap break-words rounded-lg bg-task-muted p-2 text-sm text-task-text">{entry.notes}</span> : null}
        {led.length > 0 ? <span className="mt-2 block text-sm text-task-text-muted">Led to: {led.join(", ")}</span> : null}
        {entry.sheets && entry.sheets.length > 1 ? <span className="mt-1 block text-xs text-task-text-muted">In {entry.sheets.length} sheets: {entry.sheets.join(", ")}</span> : null}
      </button>
    </li>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-task-muted px-3 py-2">
      <dt className="text-[13px] text-task-text-muted">{label}</dt>
      <dd className="truncate text-[15px] font-semibold text-task-text">{value}</dd>
    </div>
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

  const back = <Button className="-ml-2" onClick={onBack} variant="ghost"><ArrowLeft className="h-4 w-4" />All customers</Button>;
  if (error && !data) return <section className="w-full">{back}<div className="mt-3"><Notice tone="danger">{error}</Notice></div></section>;
  if (!data) return <section className="w-full">{back}<p className="mt-6 text-center text-task-text-muted">Loading customer…</p></section>;

  const client = data.client;
  const text = (key: string) => { const value = client[key]; return typeof value === "string" && value ? value : null; };
  const count = (key: string) => { const value = client[key]; return typeof value === "number" ? value : 0; };
  const name = text("primary_name") ?? "Unnamed customer";
  const primaryPhone = data.phones.find((item) => item.kind === "primary")?.phone ?? null;
  const otherPhones = data.phones.filter((item) => item.kind !== "primary");
  const otherNames = data.names.filter((item) => item.name !== text("primary_name"));
  const family = data.family?.members.filter((member) => member.client_id !== client.id) ?? [];
  const listed = new Set([...CARDS.flatMap((card) => card.fields.map((field) => field.key)), ...CONTACT_KEYS]);
  const otherKeys = [...new Set(data.answers.filter((answer) => !listed.has(answer.field_key)).map((answer) => answer.field_key))];
  const pendingFollowUps = [...data.follow_ups.filter((item) => item.status === "pending")].sort((a, b) => a.due_at.localeCompare(b.due_at));
  // The database constrains this column to exactly these values (migration 0405 check constraint).
  const stage = text("lifecycle_stage") as CustomerLifecycleStage | null;
  const lastReached = text("last_contacted_at");
  const email = fieldOf(data.answers, "email");
  // The real source (migration 0434); the sheet's own name only when no real source is recorded.
  const firstSourceLabel = text("first_origin")
    ?? (text("first_source") ? data.sheet_rows.find((item) => item.source === text("first_source"))?.label ?? titleCase(text("first_source") ?? "") : null);

  const details = (
    <div className="columns-1 gap-4 lg:columns-2 2xl:columns-3">
      <InfoCard title="Contact">
        <dl>
          <InfoRow empty={!primaryPhone} label="Mobile">{primaryPhone ? formatPhone(primaryPhone) : null}</InfoRow>
          {otherPhones.map((item) => <InfoRow key={item.phone} label={item.kind === "billing" ? "Billing phone" : item.kind === "whatsapp" ? "WhatsApp" : "Other phone"}>{formatPhone(item.phone)}</InfoRow>)}
          <InfoRow current={email.current ? `${email.current.source_label}, ${formatDate(email.current.observed_at)}` : null} earlier={email.earlier} empty={!email.current} label="Email">{email.current?.value}</InfoRow>
          <AnswerRow answers={data.answers} field={{ key: "communication_preference", label: "Prefers" }} />
          <AnswerRow answers={data.answers} field={{ key: "marketing_message", label: "Marketing messages" }} />
          {otherNames.length ? <InfoRow label="Also known as">{otherNames.map((item) => item.name).join(", ")}</InfoRow> : null}
        </dl>
      </InfoCard>

      <InfoCard title="Visits and purchases">
        <dl>
          <InfoRow empty={!text("first_seen_at")} label="First seen">{formatDate(text("first_seen_at"))}</InfoRow>
          <InfoRow empty={!firstSourceLabel} label="First source">{firstSourceLabel}</InfoRow>
          <InfoRow empty={!text("first_purchase_at")} label="First purchase">{formatDate(text("first_purchase_at"))}</InfoRow>
          <InfoRow empty={!text("last_purchase_at")} label="Last purchase">{formatDate(text("last_purchase_at"))}</InfoRow>
          <InfoRow label="Contacts">{`${count("interaction_count")} (${count("successful_interaction_count")} reached)`}</InfoRow>
          <InfoRow empty={!stage} label="Stage">{stage ? CUSTOMER_STAGE_LABELS[stage] : null}</InfoRow>
        </dl>
      </InfoCard>

      {CARDS.filter((card) => card.always || card.fields.some((field) => data.answers.some((answer) => answer.field_key === field.key))).map((card) => (
        <InfoCard key={card.title} title={card.title}>
          <dl>{card.fields.map((field) => <AnswerRow answers={data.answers} field={field} key={field.key} />)}</dl>
        </InfoCard>
      ))}

      <InfoCard title="Family and referral">
        <dl>
          <InfoRow empty={!data.family} label="Family ID">{data.family?.household_code}</InfoRow>
          <InfoRow empty={family.length === 0} label="Family members" stacked>
            {family.map((member) => <span className="block" key={member.client_id}>{member.name ?? "Unnamed"} <CodeLink code={member.client_code} onOpen={onOpenClient} /></span>)}
          </InfoRow>
          <InfoRow empty={!data.referred_by} label="Referred by">
            {data.referred_by ? <>{data.referred_by.name ?? "Unnamed"} <CodeLink code={data.referred_by.client_code} onOpen={onOpenClient} /></> : null}
          </InfoRow>
          {data.possibly_same_as?.length ? (
            <InfoRow label="Possibly same person" stacked>
              {data.possibly_same_as.map((other) => <span className="block" key={other.client_code}>{other.name ?? "Unnamed"} <CodeLink code={other.client_code} onOpen={onOpenClient} /></span>)}
            </InfoRow>
          ) : null}
          <InfoRow label="Referral ID">{text("referral_code")}</InfoRow>
          {data.identifiers.filter((item) => item.type !== "email").map((item) => <InfoRow key={`${item.type}:${item.value}`} label={titleCase(item.type)}>{item.value}</InfoRow>)}
        </dl>
      </InfoCard>

      {data.products.length ? (
        <InfoCard collapsible count={data.products.length} defaultOpen={data.products.length <= 5} title="Products looked at">
          <dl>{data.products.map((product, index) => (
            <InfoRow key={`${product.interaction_code}:${index}`} label={formatDate(product.occurred_at)}>
              {[product.code, product.category].filter(Boolean).join(", ")} ({titleCase(product.interest)})
            </InfoRow>
          ))}</dl>
        </InfoCard>
      ) : null}

      {otherKeys.length ? (
        <InfoCard collapsible count={otherKeys.length} defaultOpen={false} title="Other details">
          <dl>{otherKeys.map((key) => <AnswerRow answers={data.answers} field={{ key, label: data.answers.find((answer) => answer.field_key === key)?.label ?? titleCase(key) }} key={key} />)}</dl>
        </InfoCard>
      ) : null}

      <InfoCard collapsible count={data.sheet_rows.length} defaultOpen={false} title="Where this comes from">
        {data.sheet_rows.length === 0 ? <p className="py-3 text-sm text-task-text-muted">No sheet rows are linked to this customer.</p> : (
          <dl>{data.sheet_rows.map((item) => <InfoRow key={item.source} label={item.label}>{`${item.rows} row${item.rows === 1 ? "" : "s"}`}</InfoRow>)}</dl>
        )}
      </InfoCard>
    </div>
  );

  const followUps = (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
      <InfoCard count={data.follow_ups.length} title="Follow-ups">
        {data.follow_ups.length === 0 ? <p className="py-3 text-sm text-task-text-muted">No follow-ups.</p> : (
          <ul>{data.follow_ups.map((item) => (
            <li className="border-b border-dashed border-task-border py-3 last:border-b-0" key={item.code}>
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[15px] font-semibold text-task-text">{followUpLabel(item.kind)}</span>
                <span className="text-sm text-task-text">{formatDate(item.due_at)}, {titleCase(item.status)}</span>
              </span>
              <span className="block text-sm text-task-text-muted">
                {[item.assigned_to ? `For ${item.assigned_to}` : null, item.reason].filter(Boolean).join(", ")}
                {item.origin_interaction_code ? <> From <CodeLink code={item.origin_interaction_code} onOpen={onOpenInteraction} /></> : null}
                {item.closed_by_interaction_code ? <> Closed by <CodeLink code={item.closed_by_interaction_code} onOpen={onOpenInteraction} /></> : null}
              </span>
            </li>
          ))}</ul>
        )}
      </InfoCard>
      <InfoCard count={data.appointments.length} title="Appointments">
        {data.appointments.length === 0 ? <p className="py-3 text-sm text-task-text-muted">No appointments.</p> : (
          <ul>{data.appointments.map((item) => (
            <li className="border-b border-dashed border-task-border py-3 last:border-b-0" key={item.code}>
              <span className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[15px] font-semibold text-task-text">{appointmentLabel(item.type)}</span>
                <span className="text-sm text-task-text">{formatDateTime(item.scheduled_at)}</span>
              </span>
              <span className="block text-sm text-task-text-muted">{titleCase(item.status)}{item.branch ? `, ${item.branch}` : ""}
                {item.origin_interaction_code ? <> Booked in <CodeLink code={item.origin_interaction_code} onOpen={onOpenInteraction} /></> : null}</span>
            </li>
          ))}</ul>
        )}
      </InfoCard>
    </div>
  );

  const timelineBlock = (
    <div className="max-w-3xl">
      {timeline === null ? <p className="text-sm text-task-text-muted">Loading timeline…</p> : null}
      {timeline?.length === 0 ? <p className="rounded-xl border border-task-border p-6 text-center text-sm text-task-text-muted">No contacts recorded yet.</p> : null}
      <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[5px] before:top-2 before:w-0.5 before:bg-task-border">
        {timeline?.map((entry) => <TimelineEntry entry={entry} key={entry.interaction_id} onOpen={onOpenInteraction} />)}
      </ol>
      {timeline && timeline.length > 0 && !reachedEnd ? <Button className="mt-3" disabled={loadingMore} onClick={() => void loadMore()} variant="secondary">{loadingMore ? "Loading…" : "Show older"}</Button> : null}
    </div>
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: "details", label: "Details" },
    { key: "timeline", label: `Timeline (${count("interaction_count")})` },
    { key: "follow_ups", label: pendingFollowUps.length ? `Follow-ups (${pendingFollowUps.length})` : "Follow-ups" },
  ];
  const digits = primaryPhone?.replace(/\D/g, "") ?? "";

  return (
    <section className="w-full">
      {back}
      <header className="mb-4 mt-1 rounded-2xl border border-task-border bg-task-bg p-4 shadow-card sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="break-words font-display text-[2rem] font-semibold leading-tight text-task-text sm:text-[2.4rem]">{name}</h1>
            <Tags className="mt-2" keys={data.tags} segment={text("segment")} />
            <p className="mt-2 text-sm text-task-text-muted">
              {data.franchise ? <>{data.franchise} &nbsp;</> : null}Client ID <span className="font-semibold text-task-text">{text("client_code")}</span>
              {data.family ? <> &nbsp;Family ID <span className="font-semibold text-task-text">{data.family.household_code}</span></> : null}
            </p>
          </div>
          {primaryPhone ? (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0">
              <a className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-gold-sheen px-4 text-base font-semibold text-on-gold shadow-gold" href={`tel:+${digits}`}>
                <Phone aria-hidden className="h-5 w-5" />Call
              </a>
              <a className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-task-border bg-task-bg px-4 text-base font-semibold text-task-text hover:border-gold/60" href={`https://wa.me/${digits}`} rel="noreferrer" target="_blank">
                <MessageCircle aria-hidden className="h-5 w-5" />WhatsApp
              </a>
              <p className="col-span-2 text-center text-sm font-medium text-task-text sm:hidden">{formatPhone(primaryPhone)}</p>
            </div>
          ) : null}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="Last contact" value={lastReached ? daysAgoLabel(lastReached) : text("last_attempt_at") ? "Tried, not reached" : "Never"} />
          <Stat label="Contacts" value={count("interaction_count")} />
          <Stat label="Last purchase" value={formatDate(text("last_purchase_at")) || "None"} />
          <Stat label="Next follow-up" value={pendingFollowUps[0] ? <span className="inline-flex items-center gap-1"><CalendarClock aria-hidden className="h-4 w-4" />{formatDate(pendingFollowUps[0].due_at)}</span> : "None"} />
        </dl>
        {data.archive_reason === "do_not_contact"
          ? <div className="mt-3"><Notice tone="danger">Do not contact this customer. They asked not to be contacted, so they are hidden from the list and from calling.</Notice></div>
          : data.archived ? <div className="mt-3"><Notice>This customer is archived{data.archive_reason ? ` (${titleCase(data.archive_reason)})` : ""}.</Notice></div> : null}
        {client.do_not_call === true && data.archive_reason !== "do_not_contact" ? <div className="mt-3"><Notice tone="danger">Do not call this customer.</Notice></div> : null}
      </header>
      {error ? <div className="mb-3"><Notice tone="danger">{error}</Notice></div> : null}

      <div aria-label="Customer sections" className="sticky top-[calc(3.5rem_+_env(safe-area-inset-top))] z-20 -mx-1 md:top-16 mb-4 flex gap-1 overflow-x-auto bg-obsidian/95 px-1 py-2 backdrop-blur" role="tablist">
        {tabs.map((item) => (
          <button aria-selected={tab === item.key} className={cn("min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold", tab === item.key ? "border-gold bg-gold/15 text-task-text" : "border-task-border bg-task-bg text-task-text-muted hover:text-task-text")} key={item.key} onClick={() => setTab(item.key)} role="tab" type="button">
            {item.label}
          </button>
        ))}
      </div>
      {tab === "details" ? details : tab === "timeline" ? timelineBlock : followUps}
    </section>
  );
}
