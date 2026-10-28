import { resolvePageAccess, hasPermission, validateAccessContext } from "../../../packages/core/src/permissions/resolve.ts";
import { validateSectionControls } from "../../../packages/core/src/settings/sectionAvailability.ts";
import {
  FMS_AI_LIMITS, FMS_AI_SCHEMA_VERSION, FmsAiContractError, parseFmsAiModelText, parseFmsAiRequest,
  type FmsAiErrorBody, type FmsAiErrorCode, type FmsAiModelOutput, type FmsAiRequest, type FmsAiResponse, type FmsAiUsage, type FmsAiValidationIssue,
} from "../../../packages/core/src/fms/aiContract.ts";
import { applyFmsAiOperations, coerceFmsDefinition, fmsAiIdFactory } from "../../../packages/core/src/fms/aiOperations.ts";
import { buildFmsAiContext, fmsAiSystemPrompt } from "../../../packages/core/src/fms/aiContext.ts";
import { fmsDefinitionFingerprint } from "../../../packages/core/src/fms/definitionDiff.ts";
import { diagnoseFmsDefinition } from "../../../packages/core/src/fms/diagnostics.ts";
import { validateFmsDefinition } from "../../../packages/core/src/fms/engine.ts";
import { parseFmsRunSnapshot, type FmsRunSnapshot } from "../../../packages/core/src/fms/runDiagnosis.ts";
import type { FmsFlowDefinition } from "../../../packages/core/src/fms/types.ts";
import { CatalogError, loadFmsAiCatalog, type FmsAiActor } from "./catalog.ts";
import { ModelFailure, type FmsAiModel, type ModelTurn } from "./model.ts";

export type FmsAiConfig = Readonly<{ model: string; effort: "low" | "medium" | "high"; requestTimeoutMs: number; totalBudgetMs: number; maxTokens: number }>;
export const DEFAULT_FMS_AI_CONFIG: FmsAiConfig = { model: "claude-opus-5-5", effort: "medium", requestTimeoutMs: 100_000, totalBudgetMs: 140_000, maxTokens: 16_000 };

export type FmsAiDeps = Readonly<{
  /** Validates the bearer token; resolves to null when it is not a signed-in user. */
  authenticate(token: string): Promise<"ok" | "invalid" | "unavailable">;
  actorFor(token: string): FmsAiActor;
  model: FmsAiModel | null;
  config: FmsAiConfig;
  disabled: boolean;
  now(): Date;
  log(entry: Record<string, unknown>): void;
}>;

export type FmsAiHttpResult = Readonly<{ status: number; body: FmsAiResponse | FmsAiErrorBody }>;

const fail = (status: number, code: FmsAiErrorCode, error: string): FmsAiHttpResult => ({ status, body: { error, code, schemaVersion: FMS_AI_SCHEMA_VERSION } });
const UNAVAILABLE = "The FMS assistant is unavailable right now. Manual editing is not affected.";

/** Maps the start RPC's documented refusals; anything else is "unavailable". */
function startFailure(error: Readonly<{ code?: string | undefined; message: string }>): FmsAiHttpResult {
  if (error.message === "fms_ai_disabled") return fail(403, "disabled", "This part of the FMS assistant is switched off for your organization.");
  if (error.message === "fms_ai_daily_limit_reached") return fail(429, "rate_limited", "You have reached today's FMS assistant limit. Manual editing still works.");
  if (error.message === "fms_ai_duplicate_request") return fail(409, "invalid_request", "This request was already sent.");
  if (error.message === "This section is currently unavailable") return fail(403, "disabled", "FMS is currently unavailable.");
  if (error.code === "42501") return fail(403, "forbidden", "You do not have access to the FMS assistant.");
  if (error.code === "22023") return fail(400, "invalid_request", "The request was not valid.");
  return fail(503, "unavailable", UNAVAILABLE);
}

function pinnedForms(...definitions: (FmsFlowDefinition | null)[]): string[] {
  return [...new Set(definitions.flatMap((definition) => definition?.stages.flatMap((stage) => stage.formTemplateId ? [stage.formTemplateId] : []) ?? []))];
}

/**
 * One assistant turn. Order matters: authentication, request bounds, the
 * caller's permission and section, then the database's own quota/switch check,
 * and only then any model call. The model's reply is parsed as untrusted data
 * and every operation is compiled and validated here before it is returned.
 */
export async function handleFmsAiTurn(token: string | null, rawBody: string, deps: FmsAiDeps): Promise<FmsAiHttpResult> {
  if (deps.disabled) return fail(503, "disabled", "The FMS assistant is switched off. Manual editing is not affected.");
  if (!token) return fail(401, "unauthenticated", "Sign in again to use the FMS assistant.");
  if (rawBody.length > FMS_AI_LIMITS.maxRequestBytes) return fail(413, "too_large", "This workflow is too large for the assistant.");
  const auth = await deps.authenticate(token);
  if (auth === "invalid") return fail(401, "unauthenticated", "Sign in again to use the FMS assistant.");
  if (auth === "unavailable") return fail(503, "unavailable", UNAVAILABLE);
  let parsedBody: unknown;
  try { parsedBody = JSON.parse(rawBody); } catch { return fail(400, "invalid_request", "The request was not valid."); }
  const request = parseFmsAiRequest(parsedBody);
  if (!request) return fail(400, "invalid_request", "The request was not valid.");
  if (request.includeRunData !== (request.instanceId !== null)) return fail(400, "invalid_request", "Choose a run to include, or turn off run data.");
  const draft = coerceFmsDefinition(request.draft);
  const published = request.publishedDraft ? coerceFmsDefinition(request.publishedDraft) : null;
  if (!draft || (request.publishedDraft && !published)) return fail(400, "invalid_request", "The workflow could not be read.");

  const actor = deps.actorFor(token);
  const [accessResult, controlsResult] = await Promise.all([actor.rpc("get_my_access_context"), actor.rpc("get_section_availability")]);
  if (accessResult.error?.code === "42501") return fail(403, "forbidden", "An active profile is required.");
  if (accessResult.error || controlsResult.error) return fail(503, "unavailable", UNAVAILABLE);
  try {
    const access = validateAccessContext(accessResult.data);
    const page = resolvePageAccess(access, validateSectionControls(controlsResult.data), "fms_builder");
    if (page !== "allowed") return fail(403, page === "disabled" ? "disabled" : "forbidden", page === "disabled" ? "FMS is currently unavailable." : "You do not have access to FMS.");
    if (!hasPermission(access, "fms.manage")) return fail(403, "forbidden", "Only workflow authors can use the FMS assistant.");
  } catch {
    return fail(503, "unavailable", UNAVAILABLE);
  }

  const started = await actor.rpc("start_fms_ai_request", { p_request_id: request.requestId, p_mode: request.mode, p_include_run: request.includeRunData });
  if (started.error) return startFailure(started.error);

  const usage = { requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, model: deps.config.model };
  const finish = async (status: "completed" | "failed") => {
    const { error } = await actor.rpc("finish_fms_ai_request", { p_request_id: request.requestId, p_status: status, p_model: usage.requests ? usage.model : null, p_input_tokens: usage.inputTokens, p_output_tokens: usage.outputTokens, p_cache_read_tokens: usage.cacheReadTokens, p_cache_write_tokens: usage.cacheWriteTokens });
    if (error) deps.log({ event: "fms_ai_finish_failed", code: error.code ?? null });
  };
  try {
    const result = await runTurn(request, draft, published, actor, deps, usage);
    await finish(result.status === 200 ? "completed" : "failed");
    deps.log({ event: "fms_ai_turn", mode: request.mode, status: result.status, run_data: request.includeRunData, requests: usage.requests, input_tokens: usage.inputTokens, output_tokens: usage.outputTokens, cache_read: usage.cacheReadTokens, code: "code" in result.body ? result.body.code : (result.body as FmsAiResponse).kind });
    return result;
  } catch (caught) {
    await finish("failed");
    deps.log({ event: "fms_ai_turn_failed", kind: caught instanceof CatalogError ? "catalog" : caught instanceof ModelFailure ? caught.kind : "internal", detail: caught instanceof ModelFailure ? caught.detail : caught instanceof CatalogError ? caught.message : null });
    if (caught instanceof ModelFailure) return caught.kind === "timeout" ? fail(504, "timeout", "The assistant took too long. Try a shorter question.") : fail(503, "provider_error", UNAVAILABLE);
    return fail(503, "unavailable", UNAVAILABLE);
  }
}

type MutableUsage = { requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; model: string };

async function runTurn(request: FmsAiRequest, draft: FmsFlowDefinition, published: FmsFlowDefinition | null, actor: FmsAiActor, deps: FmsAiDeps, usage: MutableUsage): Promise<FmsAiHttpResult> {
  if (!deps.model) return fail(503, "unavailable", UNAVAILABLE);
  const now = deps.now();
  const { catalog, diagnosticCatalog, directory } = await loadFmsAiCatalog(actor, pinnedForms(draft, published), now);
  const findings = diagnoseFmsDefinition(draft, diagnosticCatalog);
  let run: FmsRunSnapshot | null = null;
  if (request.includeRunData && request.instanceId) {
    const snapshot = await actor.rpc("get_fms_run_diagnostic_snapshot", { p_instance_id: request.instanceId });
    if (snapshot.error) return snapshot.error.message === "fms_ai_disabled" ? fail(403, "disabled", "Run diagnosis is switched off for your organization.") : snapshot.error.code === "42501" ? fail(403, "forbidden", "That run is not one you can inspect.") : fail(503, "unavailable", UNAVAILABLE);
    run = parseFmsRunSnapshot(snapshot.data);
    if (!run) return fail(503, "unavailable", UNAVAILABLE);
  }
  const readOnly = request.readOnly || request.mode === "debug";
  const context = buildFmsAiContext({ mode: request.mode, readOnly, draft, published, selectedStageKey: request.selectedStageKey, findings, catalog, directory, run, now });
  const turns: ModelTurn[] = [
    ...request.history.map((entry) => ({ role: entry.role, text: entry.text })),
    { role: "user", text: `<fms_data>\n${context}\n</fms_data>\n\nAuthor's message:\n${request.question}` },
  ];
  const deadline = Date.now() + deps.config.totalBudgetMs;
  const call = async () => {
    const remaining = deadline - Date.now();
    if (remaining < 5_000) throw new ModelFailure("timeout");
    const reply = await deps.model!.complete({ system: fmsAiSystemPrompt(), turns, timeoutMs: Math.min(deps.config.requestTimeoutMs, remaining - 2_000) });
    usage.requests += 1; usage.model = reply.model;
    usage.inputTokens += reply.usage.inputTokens; usage.outputTokens += reply.usage.outputTokens; usage.cacheReadTokens += reply.usage.cacheReadTokens; usage.cacheWriteTokens += reply.usage.cacheWriteTokens;
    return reply;
  };

  // One bounded repair: a malformed reply or operations that do not compile
  // are sent back once with the exact problems; a second failure is reported.
  let repairUsed = false;
  let output: FmsAiModelOutput | null = null;
  let issues: FmsAiValidationIssue[] = [];
  let proposed: FmsFlowDefinition | null = null;
  let notes: readonly string[] = [];
  while (true) {
    const reply = await call();
    if (reply.stopReason === "refusal") return fail(422, "invalid_model_output", "The assistant could not help with this request. Try rephrasing it.");
    let problem: string | null = null;
    try {
      output = parseFmsAiModelText(reply.text);
    } catch (caught) {
      output = null;
      problem = reply.stopReason === "max_tokens" ? "Your reply was cut off. Return a shorter reply with fewer operations." : `Your reply did not match the contract (${caught instanceof FmsAiContractError ? caught.message : "unreadable"}).`;
    }
    if (output) {
      if (readOnly && output.operations.length) output = { ...output, operations: [] };
      if (output.kind === "proposal" && output.operations.length) {
        const applied = applyFmsAiOperations(draft, output.operations, catalog, fmsAiIdFactory(request.requestId));
        if (applied.ok) { proposed = applied.definition; notes = applied.notes; issues = []; }
        else { proposed = null; issues = [...applied.errors]; problem = `These operations could not be applied, so nothing was changed:\n${applied.errors.map((error) => `- ${error.message}`).join("\n")}\nFix them using only ids, keys and values from the data block, or ask the author.`; }
      }
    }
    if (!problem || repairUsed) break;
    repairUsed = true;
    turns.push({ role: "assistant", text: reply.text.slice(0, 20_000) || "(empty)" }, { role: "user", text: problem });
  }
  if (!output) return fail(502, "invalid_model_output", "The assistant's answer could not be read. Nothing was changed. Please try again.");

  // Suggested fixes keep only operations that compile on the current draft.
  const suggestedFixes = output.suggestedFixes.map((fix, index) => fix.operations.length && !applyFmsAiOperations(draft, fix.operations, catalog, fmsAiIdFactory(`${request.requestId}:fix:${index}`)).ok ? { ...fix, operations: [] } : fix);
  const readiness = proposed ? validateFmsDefinition(proposed, { formFields: catalog.formFields, availableFormIds: catalog.forms.map((form) => form.id) }) : [];
  const response: FmsAiResponse = {
    ...output,
    suggestedFixes,
    assumptions: [...output.assumptions, ...notes].slice(0, FMS_AI_LIMITS.maxListItems + 6),
    schemaVersion: FMS_AI_SCHEMA_VERSION,
    sessionId: request.sessionId,
    requestId: request.requestId,
    mode: request.mode,
    baseFingerprint: request.baseFingerprint,
    proposedFingerprint: proposed ? fmsDefinitionFingerprint(proposed) : null,
    validationIssues: proposed ? readiness.map(({ code, message, stageKey }) => ({ code, message, ...(stageKey ? { stageKey } : {}) })) : issues,
    findingIds: findings.map((finding) => finding.id),
    runDataIncluded: run !== null,
    usage: usage.requests ? ({ model: usage.model, requests: usage.requests, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, cacheReadTokens: usage.cacheReadTokens, cacheWriteTokens: usage.cacheWriteTokens } satisfies FmsAiUsage) : null,
  };
  return { status: 200, body: response };
}
