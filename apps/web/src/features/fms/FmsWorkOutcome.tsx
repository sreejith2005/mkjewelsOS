import { CheckCircle2 } from "lucide-react";
import { fmsAssignedWorkPath, type FmsWorkResult } from "@jewelos/core";

/** One plain sentence naming who received the work next, or null when nobody did. */
export function sentToLine(items: ReadonlyArray<{ employeeName?: string | null | undefined }> | null | undefined): string | null {
  const people = [...new Set((items ?? []).map(item => item.employeeName).filter((name): name is string => !!name))];
  return people.length ? `Sent to ${people.join(", ")}.` : null;
}

const STATE_LINE: Partial<Record<FmsWorkResult["state"], string>> = {
  workflow_completed: "All steps are finished.",
  awaiting_approval: "Waiting for approval.",
  awaiting_other_doers: "Waiting for the others to finish.",
  workflow_on_hold: "On hold for manager review.",
  form_saved_pending_completion: "Finish the rest of this step below.",
};

/** Render only destinations returned by the committed, authorized server result. */
export function FmsWorkOutcome({ result }: { result: FmsWorkResult; viewerId?: string }) {
  const nextWork = result.state === "successors_activated" ? result.ownWorkTargets.filter(target => target.kind !== "starter_form" && target.instanceStageId !== result.sourceInstanceStageId) : [];
  const line = result.state === "successors_activated" ? sentToLine(result.destinations) : STATE_LINE[result.state] ?? null;
  return <section aria-label="Submission result" className="space-y-3 rounded-2xl border border-success/40 bg-success/10 p-4">
    <h2 className="flex items-center gap-2 font-semibold text-success"><CheckCircle2 aria-hidden="true" className="size-5 shrink-0" />{result.submissionId ? "Submitted" : "Done"}</h2>
    {line ? <p className="text-sm text-task-text">{line}</p> : null}
    {nextWork.length ? <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{nextWork.map((target, index) =>
      <a className="inline-flex min-h-12 items-center justify-center rounded-lg bg-gold-sheen px-4 py-2 text-sm font-semibold text-on-gold shadow-gold" href={fmsAssignedWorkPath(target)} key={fmsAssignedWorkPath(target)}>{nextWork.length > 1 ? `Open my next step ${index + 1}` : "Open my next step"}</a>)}</div> : null}
  </section>;
}
