import { fmsAssignedWorkPath, type FmsWorkResult } from "@jewelos/core";
import { Notice } from "@/components/ui";

/** Render only destinations returned by the committed, authorized server result. */
export function FmsWorkOutcome({ result, viewerId }: { result: FmsWorkResult; viewerId?: string }) {
  const nextWork = result.state === "successors_activated" ? result.ownWorkTargets.filter(target => target.kind !== "starter_form" && target.instanceStageId !== result.sourceInstanceStageId) : [];
  const ownedDestinations = result.destinations.filter(item => viewerId !== undefined && item.effectiveUserId === viewerId);
  return <section aria-label="Submission result" className="space-y-4 rounded-2xl border border-gold/20 bg-charcoal/40 p-4 sm:p-6">
    <header><h2 className="text-xl font-semibold text-white">{result.submissionId ? "Form submitted successfully" : "Work saved successfully"}</h2><p className="mt-1 text-sm text-soft-grey">{result.referenceNumber}</p></header>
    <Notice tone="success">{result.submissionId ? "Your answers have been saved." : "Your work has been saved."}</Notice>
    {result.state === "successors_activated" ? <ul className="space-y-2 text-sm text-champagne">{result.destinations.map((item, index) => <li key={`${item.targetStageId}:${item.effectiveUserId}:${index}`}>{item.stageName} has been assigned to {item.employeeName ?? "the configured employee"} successfully.</li>)}</ul> : null}
    {result.state === "workflow_completed" ? <p className="text-sm text-champagne">All stages in this workflow are complete.</p> : null}
    {result.state === "awaiting_approval" ? <p className="text-sm text-champagne">Your form is saved and waiting for approval.</p> : null}
    {result.state === "awaiting_other_doers" ? <p className="text-sm text-champagne">Your form is saved. Waiting for the remaining employees or stage requirements.</p> : null}
    {result.state === "workflow_on_hold" ? <p className="text-sm text-champagne">Your work is saved. The workflow is on hold for manager review.</p> : null}
    {result.state === "form_saved_pending_completion" ? <p className="text-sm text-champagne">Complete the remaining stage requirements below to assign the next work.</p> : null}
    {nextWork.length ? <div className="space-y-3"><p className="text-sm text-champagne">You have assigned work ready to continue. Review the previous answers before filling its form.</p><div className="flex flex-wrap gap-2">{nextWork.map((target, index) => {
      const label = nextWork.length === 1 && ownedDestinations.length === 1 ? ownedDestinations[0]?.stageName : null;
      return <a className="inline-flex min-h-11 items-center rounded-lg bg-gold px-4 py-2 text-sm font-semibold text-on-gold" href={fmsAssignedWorkPath(target)} key={fmsAssignedWorkPath(target)}>Continue to {label ?? (nextWork.length > 1 ? `next stage ${index + 1}` : "next stage")}</a>;
    })}</div></div> : null}
  </section>;
}
