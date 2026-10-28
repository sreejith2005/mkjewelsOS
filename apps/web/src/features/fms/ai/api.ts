import { supabase } from "@jewelos/api-client";
import {
  FMS_AI_SCHEMA_VERSION,
  type FmsAiErrorCode, type FmsAiRequest, type FmsAiResponse,
} from "@jewelos/core";

export type FmsAiSettings = Readonly<{
  debuggerEnabled: boolean; builderEnabled: boolean; runDiagnosisEnabled: boolean;
  userDailyLimit: number; usedToday: number; canConfigure: boolean;
}>;

const OFF: FmsAiSettings = { debuggerEnabled: false, builderEnabled: false, runDiagnosisEnabled: false, userDailyLimit: 0, usedToday: 0, canConfigure: false };

function parseSettings(raw: unknown): FmsAiSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return OFF;
  const value = raw as Record<string, unknown>;
  const flag = (key: string) => value[key] === true;
  const count = (key: string) => typeof value[key] === "number" ? value[key] as number : 0;
  return { debuggerEnabled: flag("debugger_enabled"), builderEnabled: flag("builder_enabled"), runDiagnosisEnabled: flag("run_diagnosis_enabled"), userDailyLimit: count("user_daily_limit"), usedToday: count("used_today"), canConfigure: flag("can_configure") };
}

/**
 * The assistant's switches. A missing migration or any error reads as "off",
 * so manual FMS authoring never depends on the assistant being deployed.
 */
export async function loadFmsAiSettings(): Promise<FmsAiSettings> {
  try {
    const { data, error } = await supabase.rpc("get_fms_ai_settings");
    return error ? OFF : parseSettings(data);
  } catch {
    return OFF;
  }
}

export async function saveFmsAiSettings(input: Readonly<{ debuggerEnabled: boolean; builderEnabled: boolean; runDiagnosisEnabled: boolean; userDailyLimit: number }>): Promise<FmsAiSettings> {
  const { data, error } = await supabase.rpc("set_fms_ai_settings_with_audit", { p_debugger: input.debuggerEnabled, p_builder: input.builderEnabled, p_run_diagnosis: input.runDiagnosisEnabled, p_user_daily_limit: input.userDailyLimit });
  if (error) throw new Error(error.code === "42501" ? "Only organization administrators can change the FMS assistant." : "Could not save the FMS assistant settings.");
  return parseSettings(data);
}

export class FmsAiCallError extends Error {
  constructor(readonly code: FmsAiErrorCode | "cancelled" | "network", message: string) { super(message); }
}

function isResponse(value: unknown): value is FmsAiResponse {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return body.schemaVersion === FMS_AI_SCHEMA_VERSION && typeof body.kind === "string" && typeof body.message === "string" && Array.isArray(body.operations) && typeof body.baseFingerprint === "string";
}

/** One assistant turn through the `fms-ai` Edge Function, cancellable. */
export async function askFmsAi(request: FmsAiRequest, signal?: AbortSignal): Promise<FmsAiResponse> {
  if (signal?.aborted) throw new FmsAiCallError("cancelled", "Cancelled.");
  let result: Awaited<ReturnType<typeof supabase.functions.invoke>>;
  try {
    result = await supabase.functions.invoke("fms-ai", { method: "POST", body: request, ...(signal ? { signal } : {}) });
  } catch {
    if (signal?.aborted) throw new FmsAiCallError("cancelled", "Cancelled.");
    throw new FmsAiCallError("network", "You appear to be offline. Nothing was changed.");
  }
  if (signal?.aborted) throw new FmsAiCallError("cancelled", "Cancelled.");
  if (result.error) {
    const context = (result.error as { context?: unknown }).context;
    let code: FmsAiErrorCode | "network" = (result.error as { name?: unknown }).name === "FunctionsFetchError" ? "network" : "unavailable";
    let message = code === "network" ? "You appear to be offline. Nothing was changed." : "The FMS assistant is unavailable right now. Manual editing is not affected.";
    if (context instanceof Response) {
      try {
        const body = await context.json() as Record<string, unknown>;
        if (typeof body.code === "string") code = body.code as FmsAiErrorCode;
        if (typeof body.error === "string") message = body.error;
      } catch { /* keep the generic message */ }
    }
    throw new FmsAiCallError(code, message);
  }
  if (!isResponse(result.data)) throw new FmsAiCallError("invalid_model_output", "The assistant returned something unexpected. Nothing was changed.");
  return result.data;
}
