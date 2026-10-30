import { CheckCircle2, CircleDot, Flag, MinusCircle, OctagonX } from "lucide-react";
import { fmsJourneyLines, fmsTerminalOutcomeLabel, formatKolkataDateTime, type FmsJourney } from "@jewelos/core";
import { cn } from "@/lib/utils";
import { FMS_OUTCOME_STYLE } from "../outcomeStyle";

const TONE = {
  done: { Icon: CheckCircle2, className: "text-success" },
  open: { Icon: CircleDot, className: "text-gold-secondary" },
  stopped: { Icon: OctagonX, className: "text-warning" },
  skipped: { Icon: MinusCircle, className: "text-soft-grey" },
  end: { Icon: Flag, className: "text-success" },
} as const;

/** What actually happened to one workflow run, from its saved visits. Read-only. */
export function FmsJourneyTimeline({ journey }: { journey: FmsJourney }) {
  const lines = fmsJourneyLines(journey);
  const outcome = journey.outcome;
  return <section aria-label="Journey" className="space-y-3 rounded-2xl border border-gold/20 p-4">
    <h2 className="font-semibold text-white">Journey</h2>
    <p className="text-xs text-soft-grey">{[journey.instance.startedAt ? `Started ${formatKolkataDateTime(journey.instance.startedAt)}` : null, journey.instance.startedBy ? `by ${journey.instance.startedBy}` : null].filter(Boolean).join(" ")}</p>
    <ol className="space-y-3">{lines.map((line) => {
      const { Icon, className } = TONE[line.tone];
      return <li className="flex gap-3" key={line.id}>
        <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", className)} />
        <div className="min-w-0 flex-1 border-l border-gold/15 pl-3">
          <p className="break-words font-medium text-white">{line.title}</p>
          {line.at ? <p className="text-xs text-soft-grey">{formatKolkataDateTime(line.at)}</p> : null}
          {line.detail.length ? <ul className="mt-1 space-y-0.5 text-sm text-champagne">{line.detail.map((item, index) => <li className="break-words" key={`${line.id}-${index}`}>{item}</li>)}</ul> : null}
        </div>
      </li>;
    })}</ol>
    {outcome ? <div className={cn("rounded-xl border p-3", FMS_OUTCOME_STYLE[outcome.outcome])}>
      <p className="font-semibold">Final outcome: {fmsTerminalOutcomeLabel(outcome.outcome)} · {outcome.stageName}</p>
      <p className="text-sm">{[`Closed ${formatKolkataDateTime(outcome.closedAt)}`, outcome.sourceStageName ? `after ${outcome.sourceStageName}` : null,
        outcome.sourceQuestion && outcome.sourceValue ? `because ${outcome.sourceQuestion} was "${outcome.sourceValue}"` : outcome.routeLabel ? `by route "${outcome.routeLabel}"` : null].filter(Boolean).join(" ")}</p>
      {outcome.reasonCode ? <p className="text-xs">Reason code: {outcome.reasonCode}</p> : null}
      {outcome.stoppedCount ? <p className="text-xs">{outcome.stoppedCount} open step{outcome.stoppedCount === 1 ? " was" : "s were"} stopped when the workflow ended.</p> : null}
    </div> : journey.instance.status === "completed" ? <p className="text-sm text-soft-grey">Finished without an End Node, so no business outcome was recorded.</p>
      : journey.instance.status === "cancelled" ? <p className="text-sm text-danger">Cancelled{journey.instance.cancelReason ? `: ${journey.instance.cancelReason}` : ""}. This is not a business outcome.</p> : null}
  </section>;
}
