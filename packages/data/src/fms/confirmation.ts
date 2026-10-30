import type { FmsHandoffDecision, FmsTransitionRequest, FmsWorkPreview, FmsWorkResult } from "@jewelos/core";
import { fmsRequestTarget, previewFmsWork, recoverFmsWork, submitConfirmedFmsWork } from "./work";

/** Confirmation is a UI decision; routing and activation remain server-owned. */
export async function runFmsHandoff(request: FmsTransitionRequest,
  choose: (preview: FmsWorkPreview) => Promise<FmsHandoffDecision | null>): Promise<FmsWorkResult | null> {
  const recovered = await recoverFmsWork({ kind: request.kind, targetId: fmsRequestTarget(request) });
  if (recovered) return recovered;
  const preview = await previewFmsWork(request);
  // The answer leads to an End Node and nobody else receives work: close it without a handoff question.
  if (preview.terminal && preview.destinations.length === 0 && !preview.wouldDefer) return submitConfirmedFmsWork(request, preview, []);
  const decision = await choose(preview);
  return decision === null ? null : submitConfirmedFmsWork(request, decision.preview, decision.handoffs);
}
