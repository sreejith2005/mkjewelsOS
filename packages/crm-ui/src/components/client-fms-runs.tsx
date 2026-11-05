"use client";
import { useEffect, useState } from "react";
import { fmsAssignedWorkPath } from "@jewelos/core";
import { useCrmFormsHost, type CrmClientRun } from "@/crm-port/forms-host";

const when = (value: string | null) => value ? new Date(value).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "No due date";
const STATUS: Record<string, string> = { active: "In progress", overdue: "Overdue", on_hold: "On hold", completed: "Completed", cancelled: "Cancelled" };

/**
 * FMS workflows this client's CRM events started (owner request 2026-11-04): the run, its current
 * step, who has it and when it is due, with a link to the existing FMS work page. Read in JewelOS as
 * the signed-in person (crm.view and FMS run visibility); loads only when opened.
 */
export function ClientFmsRuns({ clientId }: { clientId: string }) {
  const host = useCrmFormsHost();
  const [open, setOpen] = useState(false);
  const [runs, setRuns] = useState<readonly CrmClientRun[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !host?.loadClientRuns) return;
    let active = true; setError(""); setRuns(null);
    void host.loadClientRuns(clientId).then((value) => { if (active) setRuns(value); }).catch(() => { if (active) setError("FMS workflows could not load. Close and open again to retry."); });
    return () => { active = false; };
  }, [open, clientId, host]);
  if (!host?.loadClientRuns) return null;
  return <details className="crm-customer-journeys" onToggle={(event) => setOpen(event.currentTarget.open)}><summary>FMS workflows</summary>{open ? <div>
    {error ? <p role="alert">{error}</p> : null}
    {!runs && !error ? <p role="status">Loading…</p> : null}
    {runs && !runs.length ? <p>No FMS workflow has started from this client&apos;s CRM records.</p> : null}
    {runs?.map((run) => <article key={run.instanceId} className="crm-customer-event"><p><b>{run.workflowName}</b> · {run.referenceNumber} · {STATUS[run.status] ?? run.status}{run.crmCaseId ? ` · Not Bought case ${run.caseOpen ? "open" : "closed"}` : ""}</p>
      <p className="text-xs">Started {when(run.startedAt)}{run.completedAt ? ` · Finished ${when(run.completedAt)}` : ""}</p>
      {run.openSteps.length ? <ul>{run.openSteps.map((step) => <li key={step.instanceStageId}>{step.stageName}{step.visitNumber > 1 ? ` (attempt ${step.visitNumber})` : ""} · {step.assignees.join(", ") || "Not assigned"} · due {when(step.dueAt)} · <a href={fmsAssignedWorkPath({ kind: "stage", instanceId: run.instanceId, instanceStageId: step.instanceStageId })}>Open this work</a></li>)}</ul>
        : <a href={fmsAssignedWorkPath({ kind: "stage", instanceId: run.instanceId, instanceStageId: null })}>Open this workflow</a>}
    </article>)}
  </div> : null}</details>;
}
