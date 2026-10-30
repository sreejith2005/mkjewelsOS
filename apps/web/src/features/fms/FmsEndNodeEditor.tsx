import { Flag, Lock } from "lucide-react";
import { FMS_TERMINAL_OUTCOMES, FMS_TERMINAL_OUTCOME_HELP, FMS_TERMINAL_OUTCOME_LABELS, fmsOutgoingStageKeys, type FmsStageDefinition, type FmsTerminalOutcome } from "@jewelos/core";
import { Button, Field } from "@/components/ui";
import { cn } from "@/lib/utils";
import { FMS_OUTCOME_STYLE } from "./outcomeStyle";

/**
 * End Node settings. An End Node only records how the workflow ended, so the
 * assignee, deadline, form, checklist, remark and routing controls are not shown.
 */
export function FmsEndNodeEditor({ stage, stages, onChange, onDelete, completedCount }: {
  stage: FmsStageDefinition; stages: readonly FmsStageDefinition[]; onChange: (value: FmsStageDefinition) => void; onDelete: () => void;
  /** Unique finished instances that reached this End Node in published versions; undefined while unknown. */
  completedCount?: number | undefined;
}) {
  const terminal = stage.sla.terminal ?? { outcome: "other" as const };
  const setTerminal = (patch: Partial<{ outcome: FmsTerminalOutcome; reasonCode: string | undefined }>) => {
    const next = { ...terminal, ...patch };
    onChange({ ...stage, sla: { ...stage.sla, terminal: { outcome: next.outcome, ...(next.reasonCode ? { reasonCode: next.reasonCode } : {}) } } });
  };
  const incoming = stages.filter((item) => item.key !== stage.key && fmsOutgoingStageKeys(item).includes(stage.key));
  return <div className="space-y-4 pb-8" data-fms-editor>
    <p className={cn("flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold", FMS_OUTCOME_STYLE[terminal.outcome] ?? FMS_OUTCOME_STYLE.other)}><Flag aria-hidden className="size-4 shrink-0" />End Node settings</p>
    <Field label="Node name"><input autoFocus className="field" data-fms-focus="name" maxLength={150} onChange={(event) => onChange({ ...stage, name: event.target.value })} placeholder="e.g. Sales Closed" value={stage.name} /></Field>
    <fieldset>
      <legend className="mb-2 text-sm font-medium text-champagne">End type</legend>
      <div className="grid gap-2 sm:grid-cols-2">{FMS_TERMINAL_OUTCOMES.map((outcome) => <button aria-pressed={terminal.outcome === outcome} className={cn("min-h-11 rounded-xl border p-3 text-left transition", terminal.outcome === outcome ? FMS_OUTCOME_STYLE[outcome] : "border-gold/20 text-soft-grey hover:border-gold/60")} key={outcome} onClick={() => setTerminal({ outcome })} type="button">
        <span className="block text-sm font-semibold">{FMS_TERMINAL_OUTCOME_LABELS[outcome]}</span>
        <span className="mt-0.5 block text-xs text-soft-grey">{FMS_TERMINAL_OUTCOME_HELP[outcome]}</span>
      </button>)}</div>
    </fieldset>
    <div>
      <Field label="Closure reason code (optional)"><input className="field" maxLength={64} onChange={(event) => setTerminal({ reasonCode: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") || undefined })} placeholder="e.g. not_interested" value={terminal.reasonCode ?? ""} /></Field>
      <p className="mt-1 text-xs text-soft-grey">A stable code for reports, such as price_too_high. Renaming the node never changes it.</p>
    </div>
    <Field label="Description (optional)"><textarea className="field min-h-16 md:text-sm" maxLength={1000} onChange={(event) => onChange({ ...stage, method: event.target.value })} placeholder="What this ending means for the business" value={stage.method ?? ""} /></Field>
    <section className="rounded-xl border border-gold/20 p-3">
      <p className="flex items-center gap-2 text-sm font-semibold text-white"><Lock aria-hidden className="size-4 text-gold-secondary" />Automatic closure: always on</p>
      <p className="mt-1 text-sm text-soft-grey">Reaching this node automatically ends the workflow. No task or form is created.</p>
    </section>
    <section className="rounded-xl border border-gold/20 p-3">
      <p className="text-sm font-semibold text-white">Incoming connections ({incoming.length})</p>
      {incoming.length ? <ul className="mt-2 space-y-1 text-sm text-soft-grey">{incoming.map((item) => <li key={item.key}>{item.name || item.key}</li>)}</ul>
        : <p className="mt-1 text-sm text-danger">Nothing leads here yet. Connect a step's route or next step to this End Node.</p>}
    </section>
    <section className="rounded-xl border border-gold/20 p-3">
      <p className="text-sm font-semibold text-white">Finished workflows that reached this ending</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{completedCount === undefined ? "—" : completedCount}</p>
      <p className="text-xs text-soft-grey">Unique workflow runs in published versions you can see. Open the workflow's Tasks to inspect their journeys.</p>
    </section>
    <Button onClick={onDelete} variant="danger">Delete End Node</Button>
  </div>;
}
