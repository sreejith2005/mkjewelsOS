import { useState } from "react";
import { Button } from "@/components/ui";
import type { TaskImportIdentityCandidate } from "./api";

type UnresolvedIdentity = Readonly<{ label: string; source_rows: readonly number[] }>;
type Props = Readonly<{
  unresolved: readonly UnresolvedIdentity[];
  candidates: readonly TaskImportIdentityCandidate[];
  busy: boolean;
  onConfirm: (label: string, userProfileId: string) => void;
}>;

const normalized = (value: string) => value.trim().toLocaleLowerCase("en-IN").replace(/\s+/g, " ");
const nameKey = (value: string) => {
  const parts = normalized(value).replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts.at(-1)}` : parts[0] ?? "";
};

export function IdentityConfirmationPanel({ unresolved, candidates, busy, onConfirm }: Props) {
  const [selections, setSelections] = useState<Record<string, string>>({});
  if (!unresolved.length) return null;
  return <div className="rounded-xl border border-warning/40 bg-task-bg p-4">
    <h2 className="font-semibold text-task-text">Confirm unclear employee names once</h2>
    <p className="mt-1 text-sm text-task-text-muted">JewelOS will remember each choice for this upload and every future upload.</p>
    <div className="mt-4 space-y-3">
      {unresolved.map((item) => {
        const suggestions = candidates.filter((candidate) => normalized(candidate.employee_name) === normalized(item.label) || nameKey(candidate.employee_name) === nameKey(item.label));
        const options = suggestions.length ? suggestions : candidates;
        const selected = selections[item.label] ?? "";
        return <div className="grid gap-2 rounded-lg bg-task-muted p-3 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,1fr)_auto] lg:items-center" key={normalized(item.label)}>
          <div><p className="font-medium text-task-text">{item.label}</p><p className="text-xs text-task-text-muted">{item.source_rows.length} {item.source_rows.length === 1 ? "row" : "rows"}</p></div>
          <select aria-label={`Choose employee for ${item.label}`} className="task-field" onChange={(event) => setSelections((current) => ({ ...current, [item.label]: event.target.value }))} value={selected}>
            <option value="">Select the correct employee</option>
            {options.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.employee_name} — {candidate.email}</option>)}
          </select>
          <Button disabled={busy || !selected} onClick={() => onConfirm(item.label, selected)}>Confirm and remember</Button>
        </div>;
      })}
    </div>
  </div>;
}
