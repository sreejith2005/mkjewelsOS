import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui";
import { Panel } from "@/features/analytics/components";
import { PURGE_MODULE_KEYS, type PurgeCounts, type PurgeModuleKey } from "./api";

type Props = {
  isSuperAdmin: boolean;
  onLoadCounts: () => Promise<PurgeCounts>;
  onPurge: (modules: PurgeModuleKey[]) => Promise<PurgeCounts>;
};

const rows = (counts: Record<string, number>) =>
  Object.entries(counts)
    .filter(([, count]) => count > 0)
    .map(([name, count]) => (
      <div key={name} className="flex justify-between gap-3">
        <dt className="text-task-text-muted">{name.replaceAll("_", " ")}</dt>
        <dd className="tabular-nums">{count.toLocaleString("en-IN")}</dd>
      </div>
    ));

export function DataPurgeCard({ isSuperAdmin, onLoadCounts, onPurge }: Props) {
  const [counts, setCounts] = useState<PurgeCounts | null>(null);
  const [selected, setSelected] = useState<PurgeModuleKey[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      setCounts(await onLoadCounts());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to read the current data counts.");
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (isSuperAdmin) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  if (!isSuperAdmin) return null;

  const toggle = (key: PurgeModuleKey) =>
    setSelected((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));
  const allSelected = selected.length === PURGE_MODULE_KEYS.length;
  const selectedTotal = counts ? selected.reduce((sum, key) => sum + (counts.modules[key]?.total ?? 0), 0) : 0;
  const canPurge = selected.length > 0 && confirmation === "DELETE" && !busy;

  const purge = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      setCounts(await onPurge(selected));
      setDone(`Deleted ${selected.length} section${selected.length === 1 ? "" : "s"}. Counts below are live.`);
      setSelected([]);
      setConfirmation("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The purge was denied or could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Clear data"
      description="Delete operational records section by section, as often as you need. Users, branches, departments, Availability, dropdowns, settings, CRM and audit history are never touched."
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-warning/40 bg-task-bg p-3 text-sm text-task-text-muted">
          <div className="flex gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
            <p>Deletion is immediate and cannot be undone from inside the app. Nothing here removes any screen or setting — only records.</p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-task-text-muted">Choose what to delete</span>
          <Button
            disabled={busy}
            onClick={() => setSelected(allSelected ? [] : [...PURGE_MODULE_KEYS])}
            variant="secondary"
          >
            {allSelected ? "Clear selection" : "Select everything"}
          </Button>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          {PURGE_MODULE_KEYS.map((key) => {
            const module = counts?.modules[key];
            return (
              <label
                key={key}
                className="flex items-start gap-2 rounded-lg border border-task-border p-3 text-sm"
              >
                <input
                  aria-label={module?.label ?? key}
                  checked={selected.includes(key)}
                  disabled={busy}
                  onChange={() => toggle(key)}
                  type="checkbox"
                />
                <span className="flex-1">
                  <span className="block font-medium">{module?.label ?? key.replaceAll("_", " ")}</span>
                  <span className="block text-xs text-task-text-muted">
                    {module ? `${module.total.toLocaleString("en-IN")} records` : "…"}
                  </span>
                </span>
              </label>
            );
          })}
        </div>

        {counts ? (
          <details className="rounded-lg border border-task-border p-3 text-xs">
            <summary className="cursor-pointer text-task-text-muted">
              Always cleared with any deletion (logs, delivery records and realtime events)
            </summary>
            <dl className="mt-2 grid gap-1">{rows(counts.always_swept)}</dl>
          </details>
        ) : null}

        <label>
          <span className="mb-1 block text-xs font-medium text-task-text-muted">
            Type DELETE to confirm{selected.length > 0 ? ` — ${selectedTotal.toLocaleString("en-IN")} records selected` : ""}
          </span>
          <input
            aria-label="Confirmation"
            className="task-field"
            disabled={busy || selected.length === 0}
            onChange={(event) => setConfirmation(event.target.value)}
            value={confirmation}
          />
        </label>

        <div className="flex gap-2">
          <Button
            className="border-task-overdue bg-task-overdue text-white hover:bg-task-overdue/90"
            disabled={!canPurge}
            onClick={() => void purge()}
          >
            {busy ? "Deleting…" : "Delete selected"}
          </Button>
          <Button disabled={busy} onClick={() => void load()} variant="secondary">
            Refresh counts
          </Button>
        </div>

        {counts ? (
          <details className="rounded-lg border border-task-border p-3 text-xs">
            <summary className="cursor-pointer text-task-text-muted">Retained — never deleted here</summary>
            <dl className="mt-2 grid gap-1">{rows(counts.retained)}</dl>
          </details>
        ) : null}

        {done ? (
          <p aria-live="polite" className="text-sm text-success">
            {done}
          </p>
        ) : null}
        {error ? (
          <p aria-live="polite" className="text-sm text-task-overdue">
            {error}
          </p>
        ) : null}
      </div>
    </Panel>
  );
}
