import {useState} from "react";
import {jewelosReportFilters,reportFor} from "@jewelos/core";
import {RefreshCw} from "lucide-react";
import {Button,Notice} from "@/components/ui";
import {Panel} from "@/features/analytics/components";
import {fetchReport,type ReportPayload} from "@/features/reports/api";
import {ReportTable} from "@/features/reports/ReportTable";

const istDay=(date:Date)=>date.toLocaleDateString("en-CA",{timeZone:"Asia/Kolkata"});

/**
 * Settings → Report diagnostics (Business Reports 2.0, 2026-11-02). Technical reports that
 * used to sit among the business reports: notification delivery health. (The CRM
 * synchronization exceptions export went with the CRM project on 2026-11-20.) Administrators only; nothing here shows message
 * bodies, provider payloads or customer answers.
 */
export function ReportDiagnostics(){
  const definition=reportFor("notification_delivery_health")!;
  const [data,setData]=useState<ReportPayload|null>(null);const [error,setError]=useState("");const [busy,setBusy]=useState(false);
  async function load(){setBusy(true);setError("");try{const to=new Date();const from=new Date(to.valueOf()-29*86_400_000);setData(await fetchReport(definition.key,jewelosReportFilters({from:istDay(from),to:istDay(to),page:1,page_size:100})));}catch(caught){setError(caught instanceof Error?caught.message:"Unable to load delivery health");}finally{setBusy(false);}}
  return <Panel className="mt-4" id="settings-report-diagnostics" title="Report diagnostics" description="Technical delivery checks for administrators. Business reports are on the Reports page.">
    <div className="flex flex-col gap-4">
      {error?<Notice tone="danger">{error}</Notice>:null}
      <div><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">{definition.name}</p><p className="text-xs text-task-text-muted">Last 30 days. {definition.description}</p></div><Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" disabled={busy} onClick={()=>void load()} variant="secondary"><RefreshCw/>{data?"Refresh":"Show"}</Button></div>
        {data?data.rows.length?<div className="mt-3"><ReportTable columns={definition.columns} rows={data.rows}/></div>:<p className="mt-3 text-sm text-task-text-muted">No deliveries in the last 30 days.</p>:null}</div>
    </div>
  </Panel>;
}
