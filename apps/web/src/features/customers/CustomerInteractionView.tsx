import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Button, Notice } from "@/components/ui";
import { errorMessage, titleCase } from "@/lib/format";
import { formatPhone } from "@jewelos/core";
import { loadCustomerInteractionPage, type CustomerInteractionPage } from "./api";
import { CodeLink, Fact, Section } from "./CustomerProfileView";
import { appointmentLabel, channelLabel, followUpLabel, formatDate, formatDateTime, RESULT_LABEL, RESULT_TONE } from "./format";

const DIRECTION_LABEL: Record<string, string> = { inbound: "Customer contacted us", outbound: "We contacted the customer", in_person: "In person", not_recorded: "Not recorded in the sheet" };

/** One interaction on a full page: who, when, how it ended, what it led to, and its whole sheet row (/crm/master/i/MKI-...). */
export function CustomerInteractionView({ interactionCode, onBack, onOpenClient, onOpenInteraction }: {
  interactionCode: string; onBack: () => void; onOpenClient: (code: string) => void; onOpenInteraction: (code: string) => void;
}) {
  const [data, setData] = useState<CustomerInteractionPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);

  useEffect(() => {
    let current = true;
    setData(null); setError(null);
    loadCustomerInteractionPage(interactionCode).then((value) => { if (current) setData(value); }).catch((reason: unknown) => { if (current) setError(errorMessage(reason)); });
    return () => { current = false; };
  }, [interactionCode]);

  const back = <Button className="-ml-2" onClick={onBack} variant="ghost"><ArrowLeft className="h-4 w-4" />All customers</Button>;
  if (error) return <section className="w-full">{back}<div className="mt-3"><Notice tone="danger">{error}</Notice></div></section>;
  if (!data) return <section className="w-full">{back}<p className="mt-6 text-center text-task-text-muted">Loading interaction…</p></section>;

  const item = data.interaction;
  const columns = data.sheet_row?.columns ?? [];
  const filled = columns.filter((column) => column.value !== null && column.value !== "");
  const shown = showEmpty ? columns : filled;
  const facts: [string, string | null][] = [
    ["Date and time", formatDateTime(item.occurred_at)],
    ["How", channelLabel(item.channel)],
    ["Direction", DIRECTION_LABEL[item.direction] ?? titleCase(item.direction)],
    ["Purpose", titleCase(item.purpose)],
    ["Status", item.outcome],
    ["Reason not reached", item.non_contact_reason],
    ["Spoken to by", item.staff],
    ["Attended by", item.attended_by],
    ["Assigned by", item.assigned_by],
    ["Branch", item.branch],
    ["Who we spoke to", item.contact_role],
    ["Old or new customer", item.customer_type_stated],
    ["Process", item.process_name],
    ["Stage", item.fms_stage],
    ["Source", item.source_label ?? titleCase(item.source)],
    ["Recorded", formatDateTime(item.created_at)],
    ["Last changed", item.updated_at !== item.created_at ? formatDateTime(item.updated_at) : null],
  ];
  const led = data.follow_ups_created.length + data.appointments_created.length + data.follow_ups_closed.length + data.appointments_completed.length;

  return (
    <section className="w-full">
      <div className="flex flex-wrap gap-2">{back}<Button onClick={() => onOpenClient(data.client.client_code)} variant="secondary">Open customer</Button></div>
      <header className="mb-4 mt-1 rounded-2xl border border-task-border bg-task-bg p-4 shadow-card sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="break-words font-display text-[1.7rem] font-semibold leading-tight text-task-text sm:text-[2rem]">
              {channelLabel(item.channel)} with {data.client.name ?? "Unnamed customer"}
            </h1>
            <p className="mt-1 text-sm text-task-text-muted">
              {formatDateTime(item.occurred_at)}, <span className="font-semibold text-task-text">{item.interaction_code}</span>
              {data.client.phone ? `, ${formatPhone(data.client.phone)}` : ""}{data.client.city ? `, ${data.client.city}` : ""}
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${RESULT_TONE[item.result]}`}>{RESULT_LABEL[item.result]}</span>
        </div>
        {item.archived ? <div className="mt-3"><Notice>This interaction is archived{item.archive_reason ? ` (${titleCase(item.archive_reason)})` : ""}. It is not counted.</Notice></div> : null}
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Section title="What happened">
            <dl>
              {facts.filter(([, value]) => value).map(([label, value]) => <Fact key={label} label={label}>{value}</Fact>)}
            </dl>
          </Section>
          <Section title="Remark">
            {item.notes ? <p className="whitespace-pre-wrap break-words py-3 text-[15px] text-task-text">{item.notes}</p> : <p className="py-3 text-sm text-task-text-muted">No remark was written.</p>}
          </Section>
          <Section count={led} title="What it led to">
            {led === 0 ? <p className="py-3 text-sm text-task-text-muted">Nothing was scheduled or closed by this interaction.</p> : (
              <ul className="space-y-2 py-3 text-sm text-task-text">
                {data.follow_ups_created.map((followUp) => (
                  <li key={followUp.code}>Created: {followUpLabel(followUp.kind)}, due {formatDate(followUp.due_at)} ({titleCase(followUp.status)}){followUp.assigned_to ? `, for ${followUp.assigned_to}` : ""}{followUp.reason ? `. ${followUp.reason}` : ""}
                    {followUp.closed_by_interaction_code ? <> · Closed by <CodeLink code={followUp.closed_by_interaction_code} onOpen={onOpenInteraction} /></> : null}</li>
                ))}
                {data.appointments_created.map((appointment) => <li key={appointment.code}>Booked: {appointmentLabel(appointment.type)}, {formatDateTime(appointment.scheduled_at)} ({titleCase(appointment.status)}){appointment.branch ? `, ${appointment.branch}` : ""}</li>)}
                {data.follow_ups_closed.map((followUp) => (
                  <li key={followUp.code}>Closed: {followUpLabel(followUp.kind)} that was due {formatDate(followUp.due_at)}
                    {followUp.origin_interaction_code ? <> · From <CodeLink code={followUp.origin_interaction_code} onOpen={onOpenInteraction} /></> : null}</li>
                ))}
                {data.appointments_completed.map((appointment) => <li key={appointment.code}>Completed: {appointmentLabel(appointment.type)} of {formatDateTime(appointment.scheduled_at)}</li>)}
              </ul>
            )}
          </Section>
          {data.products.length ? (
            <Section count={data.products.length} title="Products">
              <ul className="space-y-1 py-3 text-sm text-task-text">{data.products.map((product, index) => <li key={index}>{[product.code, product.category].filter(Boolean).join(" · ")} <span className="text-task-text-muted">({titleCase(product.interest)})</span></li>)}</ul>
            </Section>
          ) : null}
          {data.answers.length ? (
            <Section count={data.answers.length} title="Details learned in this interaction">
              <dl>{data.answers.map((answer, index) => <Fact key={`${answer.label}:${index}`} label={answer.label}>{answer.value}</Fact>)}</dl>
            </Section>
          ) : null}
        </div>

        <Section count={filled.length} title="Sheet row">
          {data.sheet_row === null ? <p className="py-3 text-sm text-task-text-muted">This interaction did not come from a sheet.</p> : (
            <>
              <p className="mb-1 pt-3 text-sm text-task-text-muted">
                {data.sheet_row.label ?? titleCase(data.sheet_row.source)}{data.sheet_row.sheet_row ? `, row ${data.sheet_row.sheet_row}` : ""} · {titleCase(data.sheet_row.status)} · First read {formatDateTime(data.sheet_row.first_seen_at)}
              </p>
              <dl className="divide-y divide-dashed divide-task-border">
                {shown.map((column) => (
                  <div className="grid grid-cols-1 gap-x-4 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]" key={column.header}>
                    <dt className="text-sm text-task-text-muted">{column.header}{column.in_sheet ? "" : " (no longer in the sheet)"}</dt>
                    <dd className="whitespace-pre-wrap break-words text-[15px] font-medium text-task-text">{column.value === null || column.value === "" ? <span className="text-task-text-muted">Empty</span> : column.value}</dd>
                  </div>
                ))}
              </dl>
              {columns.length > filled.length ? (
                <Button className="my-3" onClick={() => setShowEmpty((value) => !value)} variant="secondary">
                  {showEmpty ? "Hide empty columns" : `Show ${columns.length - filled.length} empty columns`}
                </Button>
              ) : null}
            </>
          )}
        </Section>
      </div>
    </section>
  );
}
