import { getKiaraTool, validateKiaraToolInput, type KiaraToolSpec } from "../../../../packages/core/src/assistant/tools.ts";
import type { KiaraCitationSource } from "../../../../packages/core/src/assistant/citations.ts";
import type { PageId } from "../../../../packages/core/src/roleMenu.ts";
import { hasPermission, type AccessContext } from "../../../../packages/core/src/permissions/resolve.ts";
import { getAppHelpOutcome } from "./appHelp.ts";
import { getAvailability } from "./availability.ts";
import { getDashboardMetrics } from "./dashboard.ts";
import { getFmsWork } from "./fms.ts";
import { searchForms } from "./forms.ts";
import { searchKnowledge } from "./knowledge.ts";
import { getLeave } from "./leave.ts";
import { getMyNotifications } from "./notifications.ts";
import { findColleague, findPeople } from "./people.ts";
import { getTeamProgress } from "./progress.ts";
import { listReports, runReport } from "./reports.ts";
import { ACCESS_DENIED, type ActorClient, type ExecutorContext, type ToolOutcome, UNAVAILABLE, serializeToolResult } from "./shared.ts";
import { searchMyTasks } from "./tasks.ts";
import { getMyWorkSummary } from "./workSummary.ts";

export type { ActorClient, RpcError, RpcResult, SelectFilter, SelectQuery, SelectResult } from "./shared.ts";

export type ToolContext = Readonly<{
  actor: ActorClient;
  offered: readonly KiaraToolSpec[];
  accessibleSections: readonly PageId[];
  timeZone: string;
  /** The caller's verified access context (identity and effective permissions). */
  access: AccessContext;
  now: Date;
}>;

export type ExecutedTool = Readonly<{
  spec: KiaraToolSpec | null;
  content: string;
  isError: boolean;
  /** Knowledge-base chunks returned by this call: the only ones the turn may cite. */
  citationSources?: readonly KiaraCitationSource[] | undefined;
}>;

/**
 * Runs one model-requested tool. A tool that was not offered to this caller is
 * refused as an access denial without touching the database; malformed input
 * is answered with an error result and never executed. Every executor reads
 * through `context.actor`, the caller's JWT client: no service role.
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
  const args = validated.input;
  const executor: ExecutorContext = {
    actor: context.actor,
    profileId: context.access.profileId,
    baseRole: context.access.baseRole,
    effectiveRole: context.access.effectiveRole,
    timeZone: context.timeZone,
    now: context.now,
    hasPermission: (key) => hasPermission(context.access, key),
  };
  let outcome: ToolOutcome;
  let citationSources: readonly KiaraCitationSource[] = [];
  try {
    switch (args.name) {
      case "get_my_work_summary":
        outcome = await getMyWorkSummary(context.actor, context.timeZone);
        break;
      case "get_app_help":
        outcome = getAppHelpOutcome(args.section as PageId, context.accessibleSections);
        break;
      case "search_knowledge_base": {
        const search = await searchKnowledge(executor, args);
        outcome = search.outcome;
        citationSources = search.sources;
        break;
      }
      case "search_my_tasks":
        outcome = await searchMyTasks(executor, args);
        break;
      case "get_fms_work":
        outcome = await getFmsWork(executor, args);
        break;
      case "get_my_notifications":
        outcome = await getMyNotifications(executor, args);
        break;
      case "search_forms":
        outcome = await searchForms(executor, args);
        break;
      case "get_leave":
        outcome = await getLeave(executor, args);
        break;
      case "get_availability":
        outcome = await getAvailability(executor, args);
        break;
      case "get_dashboard_metrics":
        outcome = await getDashboardMetrics(executor, args);
        break;
      case "get_team_progress":
        outcome = await getTeamProgress(executor, args);
        break;
      case "list_reports":
        outcome = listReports(executor);
        break;
      case "run_report":
        outcome = await runReport(executor, args);
        break;
      case "find_people":
        outcome = await findPeople(executor, args);
        break;
      case "find_colleague":
        outcome = await findColleague(executor, args);
        break;
    }
  } catch {
    outcome = UNAVAILABLE;
  }
  return {
    spec,
    content: serializeToolResult(outcome.result, outcome.maxChars),
    isError: outcome.isError,
    ...(citationSources.length ? { citationSources } : {}),
  };
}
