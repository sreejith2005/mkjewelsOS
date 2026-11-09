import { CheckCircle2, Repeat } from "lucide-react";
import { FMS_FOLLOW_UP_DECISION_OPTIONS, fmsFollowUpGroups, type FmsStageDefinition } from "@jewelos/core";
import { cn } from "@/lib/utils";

/**
 * Shown above a follow-up step's settings. It summarises the group the step
 * belongs to; every follow-up is still configured as an ordinary step below.
 */
export function FmsFollowUpGroupPanel({ stage, stages, onOpenStage, onSetParent, readOnly = false }: {
  stage: FmsStageDefinition;
  stages: readonly FmsStageDefinition[];
  onOpenStage: (key: string) => void;
  onSetParent: (groupId: string, parentStageKey: string | undefined) => void;
  readOnly?: boolean;
}) {
  const tag = stage.sla.followUpGroup;
  const group = tag ? fmsFollowUpGroups(stages).find((item) => item.groupId === tag.groupId) : undefined;
  if (!tag || !group) return null;
  const memberKeys = new Set(group.members.map((item) => item.key));
  const nameOf = (key: string) => stages.find((item) => item.key === key)?.name || "Untitled step";
  const parents = stages.filter((item) => !memberKeys.has(item.key) && !["end", "branch", "parallel_start"].includes(item.type));
  const list = (keys: readonly string[]) => keys.length ? keys.map(nameOf).join(", ") : "Not chosen yet";
  return <section aria-label="Follow-Up Group" className="mb-4 space-y-3 rounded-2xl border border-gold/25 bg-gold/5 p-3 text-sm" data-testid="fms-follow-up-group">
    <header className="flex items-center gap-2">
      <Repeat aria-hidden className="size-4 text-gold-secondary" />
      <p className="font-semibold text-white">Follow-Up Group</p>
      <span className="ml-auto rounded-full border border-gold/30 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-secondary">Follow-Up {tag.number} of 3</span>
    </header>
    <label className="block">
      <span className="label">Follows up</span>
      <select aria-label="Follows up" className="field" disabled={readOnly} onChange={(event) => onSetParent(group.groupId, event.target.value || undefined)} value={group.parentStageKey ?? ""}>
        <option value="">Choose the main step</option>
        {parents.map((item) => <option key={item.key} value={item.key}>{item.name || "Untitled step"}</option>)}
      </select>
      {group.parentStageKey && !group.parentSaved ? <span className="mt-1 block text-[11px] text-soft-grey">Taken from the canvas. Choose it here to keep it in reports even if connections change.</span> : null}
    </label>
    <ol className="flex flex-wrap gap-1.5">
      {group.members.map((item) => <li key={item.key}><button aria-current={item.key === stage.key ? "step" : undefined} className={cn("min-h-9 rounded-lg border px-2.5 text-xs", item.key === stage.key ? "border-gold bg-gold/15 font-semibold text-white" : "border-gold/25 text-champagne hover:border-gold")} onClick={() => onOpenStage(item.key)} type="button">{item.name || `Follow-Up ${item.sla.followUpGroup?.number ?? ""}`}</button></li>)}
    </ol>
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
      <dt className="text-soft-grey">{FMS_FOLLOW_UP_DECISION_OPTIONS[0]!.label}</dt><dd className="text-champagne">{list(group.proceedStageKeys)}</dd>
      <dt className="text-soft-grey">{FMS_FOLLOW_UP_DECISION_OPTIONS[1]!.label}</dt><dd className="text-champagne">Next follow-up{group.loopsBack ? `; ${group.members.at(-1)?.name || "the last"} returns to ${group.members[0]?.name || "the first"}` : ""}</dd>
      <dt className="text-soft-grey">{FMS_FOLLOW_UP_DECISION_OPTIONS[2]!.label}</dt><dd className="text-champagne">{list(group.closeStageKeys)}</dd>
    </dl>
    {group.problems.length ? <ul className="space-y-1 rounded-lg border border-danger/30 bg-danger/5 p-2 text-xs text-danger">{group.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>
      : <p className="flex items-center gap-1.5 text-xs text-success"><CheckCircle2 aria-hidden className="size-3.5" />Loop configured: each answer continues, proceeds or closes.</p>}
    {group.notes.map((note) => <p className="text-xs text-soft-grey" key={note}>{note}</p>)}
    <p className="text-[11px] text-soft-grey">Each follow-up is an ordinary step: set its assignee, form and timing below. A new task is created only after the employee answers, and every round is kept as a separate visit. If the previous step's form asks for a follow-up date, a follow-up with no deadline of its own is due on that date.</p>
  </section>;
}
