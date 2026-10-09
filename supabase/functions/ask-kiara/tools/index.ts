import { getKiaraTool, validateKiaraToolInput, type KiaraToolSpec } from "../../../../packages/core/src/assistant/tools.ts";
import type { PageId } from "../../../../packages/core/src/roleMenu.ts";
import { getAppHelpOutcome } from "./appHelp.ts";
import { ACCESS_DENIED, type ActorClient, type ToolOutcome, UNAVAILABLE, serializeToolResult } from "./shared.ts";
import { getMyWorkSummary } from "./workSummary.ts";

export type { ActorClient, RpcError, RpcResult } from "./shared.ts";

export type ToolContext = Readonly<{
  actor: ActorClient;
  offered: readonly KiaraToolSpec[];
  accessibleSections: readonly PageId[];
  timeZone: string;
}>;

export type ExecutedTool = Readonly<{
  spec: KiaraToolSpec | null;
  content: string;
  isError: boolean;
}>;

/**
 * Runs one model-requested tool. A tool that was not offered to this caller is
 * refused as an access denial without touching the database; malformed input
 * is answered with an error result and never executed.
 */
export async function executeKiaraTool(name: string, input: unknown, context: ToolContext): Promise<ExecutedTool> {
  const spec = getKiaraTool(name) ?? null;
  if (!spec || !context.offered.includes(spec)) {
    return { spec, content: serializeToolResult(ACCESS_DENIED.result), isError: false };
  }
  const validated = validateKiaraToolInput(name, input);
  if (!validated.ok) {
    return { spec, content: serializeToolResult({ error: "invalid_input", message: validated.error }), isError: true };
  }
  let outcome: ToolOutcome;
  try {
    switch (validated.input.name) {
      case "get_my_work_summary":
        outcome = await getMyWorkSummary(context.actor, context.timeZone);
        break;
      case "get_app_help":
        outcome = getAppHelpOutcome(validated.input.section, context.accessibleSections);
        break;
    }
  } catch {
    outcome = UNAVAILABLE;
  }
  return { spec, content: serializeToolResult(outcome.result), isError: outcome.isError };
}
