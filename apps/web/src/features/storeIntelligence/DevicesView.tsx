import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { DEVICE_STATUS, DEVICE_STATUSES, formatRecordedTotal, relativeTime, type DeviceStatus } from "@jewelos/core";
import { fetchDevices } from "@jewelos/data";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { siPath } from "./routes";
import { Disclosure, EmptyState, ErrorState, Panel, SkeletonRows } from "./ui";
import { useLoad } from "./useLoad";

const PAGE = 25;
const TONE: Readonly<Record<DeviceStatus, string>> = {
  interrupted: "border-warning/50 bg-warning/10 text-task-text", recording: "border-danger/30 bg-danger/10 text-danger", paused: "border-gold/30 bg-gold/10 text-task-text",
  saving: "border-gold/30 bg-gold/10 text-task-text", idle: "border-task-border bg-task-muted text-task-text-muted", not_seen: "border-task-border bg-task-bg text-task-text-muted",
};

export function DevicesView({ navigate }: { navigate: (path: string) => void }) {
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [text, setText] = useState(""); const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [definitions, setDefinitions] = useState(false);
  const typing = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(typing.current), []);
  const page = useLoad(() => fetchDevices(status, search, offset, PAGE), [status, search, offset], 20_000);
  const data = page.data;
  const choose = (next: DeviceStatus | null) => { setStatus(next); setOffset(0); };
  return <div className="space-y-4">
    <header><h1 className="text-2xl font-semibold text-task-text">Devices</h1>
      <p className="mt-0.5 text-sm text-task-text-muted">Recorders in your branch. Refreshes every 20 seconds. No location or personal tracking.</p></header>
    {data?.counts.interrupted ? <Notice tone="danger">{data.counts.interrupted} {data.counts.interrupted === 1 ? "phone has" : "phones have"} an open recording that stopped sending audio. Ask the salesperson to open JewelOS and check the recorder.</Notice> : null}
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div aria-label="Filter by status" className="scroll-x no-scrollbar -mx-1 flex gap-2 px-1" role="group">
        <button aria-pressed={status === null} className={cn("min-h-11 shrink-0 rounded-full border px-3 text-sm font-semibold", status === null ? "border-task-text bg-task-text text-task-bg" : "border-task-border text-task-text")} onClick={() => choose(null)} type="button">All</button>
        {DEVICE_STATUSES.map((key) => <button aria-pressed={status === key} className={cn("min-h-11 shrink-0 rounded-full border px-3 text-sm font-semibold", status === key ? "border-task-text bg-task-text text-task-bg" : "border-task-border text-task-text")} key={key} onClick={() => choose(key)} type="button">
          {DEVICE_STATUS[key].label}{data ? <span className="ml-1.5 tabular-nums opacity-70">{data.counts[key]}</span> : null}</button>)}
      </div>
      <label className="relative sm:ml-auto sm:w-64"><span className="sr-only">Search by salesperson</span>
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-task-text-muted" />
        <input className="field pl-9" onChange={(event) => { const value = event.target.value; setText(value); clearTimeout(typing.current); typing.current = setTimeout(() => { setSearch(value); setOffset(0); }, 300); }} placeholder="Salesperson" type="search" value={text} /></label>
    </div>
    {page.error && !data ? <ErrorState message={page.error} onRetry={page.reload} />
      : !data ? <SkeletonRows label="Loading devices" rows={4} />
      : !data.rows.length ? <EmptyState title={status || search ? "No devices match" : "No recorders yet"}>{status || search ? "Try another status or name." : "A phone appears here after its first recording."}</EmptyState>
      : <Panel>
        <ul className="divide-y divide-task-border">{data.rows.map((row) => <li className="flex flex-wrap items-start gap-3 py-3" key={row.device_id}>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-task-text">{row.employee_name ?? "Salesperson"}</p>
            <p className="text-xs text-task-text-muted">{row.device_label} · last contact {relativeTime(row.last_seen_at)}</p>
            <p className="mt-1 text-xs text-task-text-muted">Today: {row.sessions_today} {row.sessions_today === 1 ? "conversation" : "conversations"}{row.recorded_ms_today ? `, ${formatRecordedTotal(row.recorded_ms_today)}` : ""}</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={cn("inline-flex min-h-6 items-center rounded-full border px-2.5 text-xs font-semibold", TONE[row.status])} title={DEVICE_STATUS[row.status].meaning}>{DEVICE_STATUS[row.status].label}</span>
            {row.open_session_id ? <Button className="min-h-11" onClick={() => navigate(siPath.conversation(row.open_session_id!))} type="button" variant="ghost">Open recording</Button> : null}
          </div>
        </li>)}</ul>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-task-border pt-3 text-sm text-task-text-muted">
          <span aria-live="polite">{offset + 1}–{offset + data.rows.length} of {data.total}</span>
          <div className="flex gap-2"><Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))} type="button" variant="secondary">Previous</Button>
            <Button disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)} type="button" variant="secondary">Next</Button></div>
        </div>
      </Panel>}
    <Disclosure onToggle={setDefinitions} open={definitions} summary="What the statuses mean">
      <dl className="space-y-2 text-sm">{DEVICE_STATUSES.map((key) => <div key={key}><dt className="font-semibold text-task-text">{DEVICE_STATUS[key].label}</dt><dd className="text-task-text-muted">{DEVICE_STATUS[key].meaning}</dd></div>)}
        <div><dt className="font-semibold text-task-text">Battery</dt><dd className="text-task-text-muted">The recorder does not report battery level, so it is not shown.</dd></div></dl>
    </Disclosure>
  </div>;
}
