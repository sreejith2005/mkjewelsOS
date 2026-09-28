import { useMemo } from "react";
import { ArrowRight, CheckSquare, ChevronRight, Copy, FileText, Flag, GitBranch, Layers, Merge, Plus, ShieldCheck, Trash2, Zap } from "lucide-react";
import { fmsStagesInFlowOrder, reachableFmsStageKeys, type FmsFlowDefinition, type FmsFormFieldRef, type FmsStageDefinition } from "@jewelos/core";
import { cn } from "@/lib/utils";
import { fmsGraphEdges, fmsStageSummary, fmsTimingSummary } from "./graph";

const appearance: Record<FmsStageDefinition["type"], { Icon: typeof CheckSquare; label: string; className: string }> = {
  task: { Icon: CheckSquare, label: "Step", className: "border-gold/40 bg-gold/10 text-gold" },
  form: { Icon: FileText, label: "Form", className: "border-success/40 bg-success/10 text-success" },
  approval: { Icon: ShieldCheck, label: "Approval", className: "border-gold/50 bg-gold/15 text-gold" },
  branch: { Icon: GitBranch, label: "Decision", className: "border-danger/40 bg-danger/10 text-danger" },
  parallel_start: { Icon: Layers, label: "Split", className: "border-gold/40 bg-charcoal text-champagne" },
  parallel_join: { Icon: Merge, label: "Join", className: "border-gold/40 bg-charcoal text-champagne" },
  notification: { Icon: Zap, label: "Notify", className: "border-gold/40 bg-gold/5 text-gold" },
  end: { Icon: Flag, label: "End", className: "border-success/40 bg-success/10 text-success" },
};

/**
 * The phone view of the workflow: every step as a finger-sized card in the
 * order the flow runs, with its connections written out. Nothing here needs a
 * drag — a step's next step and routes are set in its editor ("Continue to").
 */
export function FmsStepList({ definition, formFields, selectedKey, invalidKeys, onSelect, onAddAfter, onDuplicate, onDelete }: {
  definition: FmsFlowDefinition;
  formFields: Readonly<Record<string, readonly FmsFormFieldRef[]>>;
  selectedKey: string | null;
  invalidKeys: ReadonlySet<string>;
  onSelect: (key: string) => void;
  onAddAfter: (key: string) => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
}) {
  const ordered = useMemo(() => fmsStagesInFlowOrder(definition.stages), [definition.stages]);
  const reachable = useMemo(() => reachableFmsStageKeys(definition), [definition]);
  const edges = useMemo(() => fmsGraphEdges(definition.stages, formFields), [definition.stages, formFields]);
  const names = useMemo(() => new Map(definition.stages.map((stage) => [stage.key, stage.name || "Untitled stage"])), [definition.stages]);
  const firstKey = definition.stages[0]?.key;

  return <ol aria-label="Workflow steps" className="space-y-2">
    {ordered.map((stage, index) => {
      const item = appearance[stage.type];
      const outgoing = edges.filter((edge) => edge.from === stage.key);
      const invalid = invalidKeys.has(stage.key);
      const isFirst = stage.key === firstKey;
      const canAppend = !["end", "branch", "parallel_start"].includes(stage.type);
      const orphan = !isFirst && !reachable.has(stage.key);
      return <li key={stage.key}>
        <article className={cn("rounded-2xl border bg-charcoal", stage.key === selectedKey ? "border-gold ring-1 ring-gold" : "border-gold/20", invalid && "border-danger ring-1 ring-danger")}>
          <button aria-label={`Edit ${stage.name || "Untitled stage"}`} className="flex w-full items-start gap-3 p-4 text-left" onClick={() => onSelect(stage.key)} type="button">
            <span className="grid size-8 shrink-0 place-items-center rounded-full border border-gold/30 text-sm font-semibold text-gold">{index + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide", item.className)}><item.Icon className="size-3" />{stage.sla.decisionMode === "yes_no" || stage.sla.decisionMode === "decision" ? "Decision" : item.label}</span>
                {isFirst ? <span className="rounded-full border border-gold/30 px-2 py-0.5 text-[10px] font-semibold text-gold">Starts here</span> : null}
              </span>
              <span className="mt-1.5 block text-base font-semibold text-white">{stage.name || "Untitled stage"}</span>
              <span className="mt-0.5 block text-xs text-soft-grey">{fmsStageSummary(stage)} &middot; {fmsTimingSummary(stage)}</span>
              {invalid ? <span className="mt-1 block text-xs font-medium text-danger">Needs attention</span> : null}
              {orphan ? <span className="mt-1 block text-xs text-danger">Not connected yet &mdash; choose it in an earlier step&rsquo;s &ldquo;Continue to&rdquo;</span> : null}
              <span className="mt-2 block space-y-1">
                {outgoing.length ? outgoing.map((edge) => <span className="flex items-start gap-1.5 text-xs text-champagne" key={`${edge.to}:${edge.ruleId ?? "default"}`}>
                  <ArrowRight className={cn("mt-0.5 size-3.5 shrink-0", edge.kind === "branch" ? "text-danger" : "text-gold")} />
                  <span className="min-w-0">{edge.label ? <span className="text-soft-grey">{edge.label}: </span> : null}{names.get(edge.to) ?? edge.to}</span>
                </span>) : stage.type !== "end" ? <span className="flex items-center gap-1.5 text-xs font-medium text-success"><Flag className="size-3.5" />Completes here</span> : null}
              </span>
            </span>
            <ChevronRight className="mt-1 size-5 shrink-0 text-soft-grey" />
          </button>
          {isFirst ? null : <div className="flex justify-end gap-1 border-t border-gold/10 px-2 py-1">
            <button aria-label={`Duplicate ${stage.name}`} className="grid size-11 place-items-center rounded-lg text-soft-grey hover:bg-gold/10 hover:text-gold" onClick={() => onDuplicate(stage.key)} type="button"><Copy className="size-4" /></button>
            <button aria-label={`Delete ${stage.name}`} className="grid size-11 place-items-center rounded-lg text-soft-grey hover:bg-danger/10 hover:text-danger" onClick={() => onDelete(stage.key)} type="button"><Trash2 className="size-4" /></button>
          </div>}
        </article>
        {canAppend ? <button aria-label={`Add next step after ${stage.name}`} className="mx-auto mt-2 flex min-h-11 items-center gap-1.5 rounded-full border border-dashed border-gold/40 px-4 text-xs font-semibold text-gold hover:bg-gold/10" onClick={() => onAddAfter(stage.key)} type="button"><Plus className="size-4" />Add step here</button> : null}
      </li>;
    })}
  </ol>;
}
