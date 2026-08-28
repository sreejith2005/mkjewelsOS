import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";
import { Panel } from "@/features/analytics/components";

export type RetirementPreview = {
  operation_id: string;
  manifest_hash: string;
  expires_at: string;
  removal_counts: Record<string, number>;
  retained_counts: Record<string, number>;
};

type Props = {
  isSuperAdmin: boolean;
  onPreview: (backupReference: string) => Promise<RetirementPreview>;
  onExecute: (input: { operationId: string; manifestHash: string; confirmation: "RETIRE DEMO DATA" }) => Promise<void>;
};

export function ProductionDemoDataRetirementCard({ isSuperAdmin, onPreview, onExecute }: Props) {
  const [backupReference, setBackupReference] = useState("");
  const [maintenanceAcknowledged, setMaintenanceAcknowledged] = useState(false);
  const [preview, setPreview] = useState<RetirementPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  if (!isSuperAdmin) return null;
  const canPreview = backupReference.trim().length >= 3 && maintenanceAcknowledged && !busy;
  const canExecute = preview !== null && confirmation === "RETIRE DEMO DATA" && !busy;
  const previewRetirement = async () => {
    setBusy(true); setError(null); setCompleted(false);
    try { setPreview(await onPreview(backupReference.trim())); setConfirmation(""); }
    catch (cause) { setPreview(null); setError(cause instanceof Error ? cause.message : "Unable to create retirement preview."); }
    finally { setBusy(false); }
  };
  const executeRetirement = async () => {
    if (!preview) return;
    setBusy(true); setError(null);
    try { await onExecute({ operationId: preview.operation_id, manifestHash: preview.manifest_hash, confirmation: "RETIRE DEMO DATA" }); setCompleted(true); setPreview(null); setConfirmation(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Retirement could not be completed. Create a new preview before retrying."); setPreview(null); setConfirmation(""); }
    finally { setBusy(false); }
  };
  return <Panel title="Production demo-data retirement" description="One-time operational cutover. It preserves the app, users, organisation, Availability, CRM, configuration, and audit history.">
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-warning/40 bg-task-bg p-3 text-sm text-task-text-muted"><div className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /><p>Only demo Tasks, FMS, Forms, notifications, reports, imports, and related runtime data are eligible. CRM is retained.</p></div></div>
      <label><span className="mb-1 block text-xs font-medium text-task-text-muted">Backup reference</span><input aria-label="Backup reference" className="task-field" disabled={busy || completed} maxLength={500} onChange={(event) => setBackupReference(event.target.value)} value={backupReference} /></label>
      <label className="flex items-start gap-2 text-sm"><input aria-label="Maintenance window confirmed" checked={maintenanceAcknowledged} disabled={busy || completed} onChange={(event) => setMaintenanceAcknowledged(event.target.checked)} type="checkbox" /><span>I confirmed a maintenance window and paused mutation-capable workers through approved operational controls.</span></label>
      <Button disabled={!canPreview || completed} onClick={() => void previewRetirement()} variant="secondary">{busy ? "Preparing preview…" : "Preview demo-data retirement"}</Button>
      {preview ? <div className="rounded-lg border border-task-border p-3"><p className="text-sm font-medium">Review this expiring server-side manifest before continuing.</p><dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">{Object.entries(preview.removal_counts).filter(([, count]) => count > 0).map(([name, count]) => <div key={name}><dt className="text-task-text-muted">{name.replaceAll("_", " ")}</dt><dd>{name === "task_instances" ? `Task instances: ${count}` : count}</dd></div>)}</dl><p className="mt-3 text-xs text-task-text-muted">Expires {new Date(preview.expires_at).toLocaleString("en-IN")}. The exact inventory hash is retained server-side.</p><label className="mt-3 block"><span className="mb-1 block text-xs font-medium text-task-text-muted">Confirmation</span><input aria-label="Confirmation" className="task-field" disabled={busy} onChange={(event) => setConfirmation(event.target.value)} value={confirmation} /></label><Button className="mt-3 border-task-overdue bg-task-overdue text-white hover:bg-task-overdue/90" disabled={!canExecute} onClick={() => void executeRetirement()}>{busy ? "Retiring…" : "Retire demo data"}</Button></div> : null}
      {completed ? <p aria-live="polite" className="text-sm text-success">Retirement completed. Verify the post-cutover count report before reopening normal operations.</p> : null}
      {error ? <p aria-live="polite" className="text-sm text-task-overdue">{error}</p> : null}
    </div>
  </Panel>;
}
