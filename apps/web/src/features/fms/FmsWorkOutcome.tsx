import { CheckCircle2, UserRound } from "lucide-react";
import { fmsAssignedWorkPath, type FmsWorkResult } from "@jewelos/core";

/** Render only destinations returned by the committed, authorized server result. */
export function FmsWorkOutcome({ result, viewerId }: { result: FmsWorkResult; viewerId?: string }) {
  const nextWork = result.state === "successors_activated" ? result.ownWorkTargets.filter(target => target.kind !== "starter_form" && target.instanceStageId !== result.sourceInstanceStageId) : [];
  const ownedDestinations = result.destinations.filter(item => viewerId !== undefined && item.effectiveUserId === viewerId);
  return <section aria-label="Submission result" className="space-y-4 rounded-2xl border border-success/40 bg-task-bg p-4 sm:p-6">
    <header className="flex items-start gap-3">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-success/15"><CheckCircle2 aria-hidden="true" className="size-6 text-success" /></span>
      <div className="min-w-0"><h2 className="text-xl font-semibold text-task-text">{result.submissionId ? "Form submitted successfully" : "Work saved successfully"}</h2>
        <p className="mt-0.5 text-sm text-task-text-muted">{result.submissionId ? "Your answers have been saved." : "Your work has been saved."} · {result.referenceNumber}</p></div>
    </header>
    {result.state === "successors_activated" && result.destinations.length ? <div className="rounded-xl bg-task-muted p-3">
      <p className="text-sm font-semibold text-task-text">What happens next</p>
      <ul className="mt-2 space-y-2 text-sm text-task-text">{result.destinations.map((item, index) => <li className="flex items-start gap-2" key={`${item.targetStageId}:${item.effectiveUserId}:${index}`}><UserRound aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-gold-secondary" /><span>{item.stageName} has been assigned to {item.employeeName ?? "the configured employee"} successfully.</span></li>)}</ul>
    </div> : null}
    {result.state === "workflow_completed" ? <p className="text-sm text-task-text">All stages in this workflow are complete.</p> : null}
    {result.state === "awaiting_approval" ? <p className="text-sm text-task-text">Your form is saved and waiting for approval.</p> : null}
    {result.state === "awaiting_other_doers" ? <p className="text-sm text-task-text">Your form is saved. Waiting for the remaining employees or stage requirements.</p> : null}
    {result.state === "workflow_on_hold" ? <p className="text-sm text-task-text">Your work is saved. The workflow is on hold for manager review.</p> : null}
    {result.state === "form_saved_pending_completion" ? <p className="text-sm text-task-text">Complete the remaining stage requirements below to assign the next work.</p> : null}
    {nextWork.length ? <div className="space-y-3"><p className="text-sm text-task-text">You have assigned work ready to continue. Review the previous answers before filling its form.</p><div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">{nextWork.map((target, index) => {
      const label = nextWork.length === 1 && ownedDestinations.length === 1 ? ownedDestinations[0]?.stageName : null;
      return <a className="inline-flex min-h-12 items-center justify-center rounded-lg bg-gold-sheen px-4 py-2 text-sm font-semibold text-on-gold shadow-gold" href={fmsAssignedWorkPath(target)} key={fmsAssignedWorkPath(target)}>Continue to {label ?? (nextWork.length > 1 ? `next stage ${index + 1}` : "next stage")}</a>;
    })}</div></div> : null}
  </section>;
}
