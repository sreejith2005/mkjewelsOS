import { useState } from "react";
import { Button, Notice } from "@/components/ui";
import type { AssigningLeftRecord, TaskImportIdentityCandidate } from "./api";

const number = new Intl.NumberFormat("en-IN");

type Props = Readonly<{
  records: readonly AssigningLeftRecord[];
  candidates: readonly TaskImportIdentityCandidate[];
  busy: boolean;
  onAssign: (recordKind: "task" | "template", recordId: string, userProfileId: string) => void;
}>;

export function AssigningLeftPanel({ records, candidates, busy, onAssign }: Props) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  if (!records.length) return <Notice tone="success">Nothing is waiting for assignment.</Notice>;
  return <div className="space-y-3">
    <div aria-live="polite" className="rounded-xl border border-task-border bg-task-muted px-4 py-3">
      <p className="text-lg font-semibold text-task-text">{number.format(records.length)} {records.length === 1 ? "task" : "tasks"} awaiting assignment</p>
      <p className="mt-1 text-sm text-task-text-muted">This total updates whenever an assignment is completed.</p>
    </div>
    {records.map((record) => {
      const selected = selections[record.id] ?? "";
      return <article className="rounded-xl border border-task-border bg-task-bg p-4" key={`${record.record_kind}-${record.id}`}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-task-text">{record.title}</h3><span className="rounded-full bg-task-muted px-2 py-1 text-xs text-task-text-muted">{record.destination}</span></div>
            <p className="mt-1 text-sm text-task-text-muted">{record.starts_at ? `Starts ${new Date(record.starts_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: record.record_kind === "task" ? "short" : undefined })}` : "No start date"}{record.verification_pending ? " · Verifier will also be resolved" : ""}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row lg:w-[32rem]">
            <select aria-label={`Assign ${record.title}`} className="task-field min-w-0 flex-1" onChange={(event) => setSelections((current) => ({ ...current, [record.id]: event.target.value }))} value={selected}>
              <option value="">Select employee</option>
              {candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.employee_name} — {candidate.email}</option>)}
            </select>
            <Button disabled={busy || !selected} onClick={() => onAssign(record.record_kind, record.id, selected)}>Assign now</Button>
          </div>
        </div>
      </article>;
    })}
  </div>;
}
