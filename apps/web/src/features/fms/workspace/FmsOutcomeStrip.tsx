import { FMS_TERMINAL_OUTCOME_LABELS, type FmsFlowReport, type FmsRecordStatus } from "@jewelos/core";
import { cn } from "@/lib/utils";
import { FMS_OUTCOME_STYLE } from "../outcomeStyle";

type Tile = Readonly<{ label: string; value: string; status?: FmsRecordStatus; tone?: string; help: string }>;

/**
 * The overview above a workflow's records. Every number is a unique workflow run
 * from the server report, for runs started in the chosen period. Tapping a tile
 * filters the list below to the same runs.
 */
export function FmsOutcomeStrip({ report, periodLabel, active, onPick }: { report: FmsFlowReport | undefined; periodLabel: string; active: FmsRecordStatus; onPick: (status: FmsRecordStatus) => void }) {
  if (!report) return <div aria-label="Loading workflow counts" className="h-24 animate-pulse rounded-2xl bg-charcoal" />;
  const tiles: Tile[] = [
    { label: "Started", value: String(report.started), status: "all", help: "Workflow runs started in this period." },
    { label: "Running", value: String(report.running), status: "running", help: "Still open, including overdue." },
    { label: FMS_TERMINAL_OUTCOME_LABELS.won, value: String(report.won), status: "won", tone: FMS_OUTCOME_STYLE.won, help: "Reached a Won End Node." },
    { label: FMS_TERMINAL_OUTCOME_LABELS.lost, value: String(report.lost), status: "lost", tone: FMS_OUTCOME_STYLE.lost, help: "Reached a Lost End Node." },
    { label: FMS_TERMINAL_OUTCOME_LABELS.do_not_contact, value: String(report.doNotContact), status: "do_not_contact", tone: FMS_OUTCOME_STYLE.do_not_contact, help: "Reached a Do not contact End Node." },
    { label: "Other endings", value: String(report.other + report.unspecified), status: report.unspecified && !report.other ? "unspecified" : "other", tone: FMS_OUTCOME_STYLE.other, help: "Other End Nodes, plus runs that finished without an End Node." },
    { label: "Completed", value: String(report.completed), status: "completed", help: "All finished runs, whatever the ending." },
    { label: "Cancelled", value: String(report.cancelled), status: "cancelled", help: "Stopped by a manager. Not a business outcome." },
    { label: "Conversion", value: `${report.conversionPercent}%`, help: "Won runs ÷ started runs × 100, for this period." },
  ];
  return <section aria-label="Workflow overview" className="space-y-2">
    <p className="text-xs text-soft-grey">Runs started: {periodLabel}. Each count is a unique workflow run.</p>
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">{tiles.map((tile) => {
      const pressed = tile.status !== undefined && tile.status === active && tile.status !== "all";
      const body = <><b className="block text-xl tabular-nums leading-tight">{tile.value}</b><span className="block truncate text-[11px]">{tile.label}</span></>;
      const className = cn("min-h-16 rounded-xl border p-2 text-left transition", tile.tone ?? "border-gold/20 bg-charcoal text-white", pressed && "outline outline-2 outline-offset-1 outline-gold");
      return tile.status ? <button aria-pressed={pressed} className={cn(className, "hover:brightness-110")} key={tile.label} onClick={() => onPick(pressed ? "all" : tile.status!)} title={tile.help} type="button">{body}</button>
        : <div className={className} key={tile.label} title={tile.help}>{body}</div>;
    })}</div>
  </section>;
}

/** Unique runs per End Node and per step, with total visits for repeated steps. */
export function FmsFunnelDetails({ report }: { report: FmsFlowReport }) {
  const steps = report.stages.filter((stage) => stage.type !== "end");
  const widest = Math.max(1, ...steps.map((stage) => stage.instances));
  return <details className="group rounded-2xl border border-gold/20 bg-charcoal/60 p-3">
    <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 text-sm font-semibold text-white">Endings and step reach<span className="text-xs font-normal text-soft-grey group-open:hidden">Show</span></summary>
    <div className="mt-2 grid gap-4 lg:grid-cols-2">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-champagne">End Nodes</p>
        {report.endNodes.length ? <ul className="space-y-1.5">{report.endNodes.map((node) => <li className={cn("flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm", FMS_OUTCOME_STYLE[node.outcome])} key={node.stageKey}>
          <span className="min-w-0 truncate">{node.name} <span className="text-xs opacity-80">· {FMS_TERMINAL_OUTCOME_LABELS[node.outcome]}</span></span><b className="tabular-nums">{node.instances}</b></li>)}</ul>
          : <p className="text-sm text-soft-grey">This workflow has no End Nodes. Add them in the builder to see business outcomes.</p>}
        {report.unspecified ? <p className="mt-2 text-xs text-soft-grey">{report.unspecified} finished without an End Node.</p> : null}
      </div>
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-champagne">Steps reached (unique runs · visits)</p>
        <ul className="space-y-1.5">{steps.map((stage) => <li key={stage.stageKey}>
          <div className="flex justify-between gap-2 text-sm text-white"><span className="min-w-0 truncate">{stage.name}</span><span className="shrink-0 tabular-nums">{stage.instances}{stage.visits > stage.instances ? <span className="text-xs text-soft-grey"> · {stage.visits} visits</span> : null}</span></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-obsidian"><div className="h-full bg-gold" style={{ width: `${Math.round(stage.instances / widest * 100)}%` }} /></div>
        </li>)}</ul>
      </div>
    </div>
    {report.period.from || report.period.to ? <p className="mt-3 text-xs text-soft-grey">Finished in this period, whenever they started: {report.completedInPeriod.completed} ({report.completedInPeriod.won} won, {report.completedInPeriod.lost} lost, {report.completedInPeriod.doNotContact} do not contact).</p> : null}
  </details>;
}
