import { useCallback, useMemo, useState } from "react";
import { reportFor } from "@jewelos/core";
import { createCrmReportReader } from "@jewelos/crm-ui/analytics";
import { supabase } from "@jewelos/api-client";
import { crmProjectConfig } from "@/lib/crmProject";
import { usePerformanceRequest } from "./usePerformanceRequest";

/**
 * Business activity (calls, visits, sales outcomes) from the CRM project, read through the
 * existing Reports engine: the same report keys, columns and rules as Reports > People.
 * Nothing here is a task count. It loads only when opened and on its own, so a CRM failure
 * can never stop the task dashboard from opening. A value the CRM does not record shows "—".
 */
const REPORTS = [
  { key: "customer_report_sales", label: "Salesperson accountability" },
  { key: "customer_report_crm_staff", label: "CRM calling & follow-up" },
] as const;

export function Accountability({ from, to }: { from: string; to: string }) {
  const [open, setOpen] = useState(false);
  const [reportKey, setReportKey] = useState<(typeof REPORTS)[number]["key"]>("customer_report_sales");
  const reader = useMemo(() => (crmProjectConfig.url && crmProjectConfig.anonKey ? createCrmReportReader({ jewelos: supabase, crmProject: crmProjectConfig }) : null), []);
  const definition = reportFor(reportKey);
  const key = open && reader ? JSON.stringify([reportKey, from, to]) : null;
  const load = useCallback(() => {
    if (!reader) throw new Error("CRM is not configured");
    return reader.report(reportKey, { from, to }, 0, 100);
  }, [reader, reportKey, from, to]);
  const { data, error, loading, refresh } = usePerformanceRequest(key, load);

  return (
    <details className="group rounded-2xl border border-task-border bg-task-bg shadow-card" onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <span>
          <span className="block text-sm font-semibold">Employee accountability — sales, calls and client activity</span>
          <span className="block text-xs text-task-text-muted">From the CRM. Business activity, not assigned tasks: a call or sale is never counted as a completed task.</span>
        </span>
        <span className="text-xs font-medium text-task-accent group-open:hidden">Show</span>
      </summary>
      <div className="border-t border-task-border p-4">
        {!reader ? <p className="text-sm text-task-text-muted">CRM reporting is not configured in this deployment.</p> : (
          <>
            <div className="mb-3 flex flex-wrap gap-2" role="tablist">
              {REPORTS.map((item) => (
                <button aria-selected={reportKey === item.key} className={`min-h-10 rounded-full px-4 text-sm ${reportKey === item.key ? "bg-task-accent font-semibold text-task-bg" : "border border-task-border"}`} key={item.key} onClick={() => setReportKey(item.key)} role="tab" type="button">
                  {item.label}
                </button>
              ))}
              <a className="ml-auto inline-flex min-h-10 items-center text-sm font-medium text-task-accent" href={`/reports?report=${reportKey}&from=${from}&to=${to}`}>Open in Reports &rarr;</a>
            </div>
            {loading && !data ? <div className="skeleton h-40 rounded-xl" /> : null}
            {error ? <p className="text-sm" role="alert">CRM activity could not load. The task dashboard above is unaffected. <button className="font-medium text-task-accent" onClick={() => void refresh()} type="button">Retry</button></p> : null}
            {data && definition ? (
              data.rows.length ? (
                <div className="max-h-[28rem] overflow-auto rounded-xl border border-task-border">
                  <table className="w-full min-w-[56rem] text-left text-xs">
                    <thead className="sticky top-0 bg-task-muted text-[0.6875rem] uppercase tracking-wider text-task-text-muted">
                      <tr>{definition.columns.map((column) => <th className="whitespace-nowrap px-2.5 py-2 font-semibold" key={column.key} scope="col">{column.label}</th>)}</tr>
                    </thead>
                    <tbody>
                      {data.rows.map((row, index) => (
                        <tr className="border-t border-task-border" key={index}>
                          {definition.columns.map((column) => {
                            const value = row[column.key];
                            return <td className={`whitespace-nowrap px-2.5 py-1.5 ${typeof value === "number" ? "text-right tabular-nums" : ""}`} key={column.key}>{value === null || value === undefined || value === "" ? <span className="text-task-text-muted">—</span> : typeof value === "number" && column.format === "percent" ? `${value}%` : String(value)}</td>;
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="py-4 text-center text-sm text-task-text-muted">No CRM activity in this period.</p>
            ) : null}
            {definition?.notes?.length ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-task-text-muted">{definition.notes.map((note) => <li key={note}>{note}</li>)}</ul>
            ) : null}
            {data && data.total > data.rows.length ? <p className="mt-2 text-xs text-task-text-muted">Showing {data.rows.length} of {data.total}. Open in Reports for all rows and export.</p> : null}
          </>
        )}
      </div>
    </details>
  );
}
