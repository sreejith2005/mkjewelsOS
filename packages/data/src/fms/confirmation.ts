import type { FmsHandoffChoice, FmsTransitionRequest, FmsWorkPreview, FmsWorkResult } from "@jewelos/core";
import { previewFmsWork, submitConfirmedFmsWork } from "./work";

/** Confirmation is a UI decision; routing and activation remain server-owned. */
export async function runFmsHandoff(request: FmsTransitionRequest,
  choose: (preview: FmsWorkPreview) => Promise<readonly FmsHandoffChoice[] | null>): Promise<FmsWorkResult | null> {
  const preview = await previewFmsWork(request);
  const choices = await choose(preview);
  return choices === null ? null : submitConfirmedFmsWork(request, preview, choices);
}
