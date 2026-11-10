import { CornerDownRight, Repeat } from "lucide-react";
import { fmsFollowUpGroups, fmsOutgoingStageKeys, type FmsStageDefinition } from "@jewelos/core";
import { cn } from "@/lib/utils";

/**
 * Shown above a follow-up step's settings. It only summarises the group the
 * step belongs to; the step itself is configured and routed below exactly
 * like any other step.
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
  return <section aria-label="Follow-Up Group" className="mb-4 space-y-3 rounded-xl border border-gold/25 bg-gold/[0.04] p-3 text-sm" data-testid="fms-follow-up-group">
    <header className="flex items-center gap-2">
      <span className="grid size-7 place-items-center rounded-lg bg-gold/15 text-gold-secondary"><Repeat aria-hidden className="size-4" /></span>
      <div className="min-w-0 flex-1"><p className="font-semibold text-white">Follow-Up Group</p><p className="text-xs text-soft-grey">This step is follow-up {tag.number} of 3</p></div>
    </header>
    <label className="block">
      <span className="label">Follows up</span>
      <select aria-label="Follows up" className="field" disabled={readOnly} onChange={(event) => onSetParent(group.groupId, event.target.value || undefined)} value={group.parentStageKey ?? ""}>
        <option value="">Choose the main step</option>
        {parents.map((item) => <option key={item.key} value={item.key}>{item.name || "Untitled step"}</option>)}
      </select>
      <span className="mt-1 block text-xs text-soft-grey">{group.parentStageKey && !group.parentSaved ? "Taken from the canvas. Choose it here to keep it in reports even if connections change." : "Reports count these follow-ups against this step."}</span>
    </label>
    <div>
      <p className="label">Steps in this group</p>
      <ol className="space-y-1">
        {group.members.map((item) => {
          const next = fmsOutgoingStageKeys(item);
          return <li key={item.key}><button aria-current={item.key === stage.key ? "step" : undefined} className={cn("flex min-h-11 w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left", item.key === stage.key ? "border-gold bg-gold/10" : "border-gold/15 hover:border-gold/50")} onClick={() => onOpenStage(item.key)} type="button">
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-white">{item.name || `Follow-Up ${item.sla.followUpGroup?.number ?? ""}`}</span>
              <span className="flex min-w-0 items-center gap-1 text-xs text-soft-grey"><CornerDownRight aria-hidden className="size-3 shrink-0" /><span className="truncate">{next.length ? next.map(nameOf).join(", ") : "Completes here"}</span></span></span>
            {item.key === stage.key ? <span className="shrink-0 rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-semibold text-gold-secondary">Open</span> : null}
          </button></li>;
        })}
      </ol>
    </div>
    {group.problems.length ? <ul className="space-y-1 rounded-lg border border-danger/30 bg-danger/5 p-2 text-xs text-danger">{group.problems.map((problem) => <li key={problem}>{problem}</li>)}</ul> : null}
    {group.notes.map((note) => <p className="text-xs text-soft-grey" key={note}>{note}</p>)}
    <p className="text-xs text-soft-grey">Set this step's questions, assignee, timing and routing below, the same as any step.</p>
  </section>;
}
