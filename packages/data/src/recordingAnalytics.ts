import { supabase, type Json } from "@jewelos/api-client";
import {
  parseSiAnalytics, parseSiDeviceDays, parseSiOptions, parseSiSessionPage,
  type SiAnalytics, type SiDeviceDayPage, type SiOptions, type SiServerFilters, type SiSessionPage,
} from "@jewelos/core/salesScore/analytics";
import { recordingFail, recordingParsed } from "./recordingWorkspace";

// Kept apart from recordingWorkspace (which the recorder loads at startup) so the
// analytics rules load only with Store Intelligence > Insights.
// ---------------------------------------------------------------------------
// 0389: analytics. Every read takes an AbortSignal so a newer filter revision
// cancels the request it replaces.

/** Thrown when a newer request replaced this one; callers ignore it. */
export class SupersededError extends Error {
  constructor() { super("superseded"); this.name = "SupersededError"; }
}
function guard(signal: AbortSignal | undefined, error: { message?: string; code?: string } | null): void {
  if (signal?.aborted) throw new SupersededError();
  if (error) recordingFail(error);
}
/** Summary for one filter revision (current and prior period, breakdowns, freshness). */
export async function fetchSiAnalytics(filters: SiServerFilters, signal?: AbortSignal): Promise<SiAnalytics> {
  let query = supabase.rpc("recording_analytics", { p_filters: filters as Json }); // Built by siServerFilters; the server re-validates every key.
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  guard(signal, error);
  return recordingParsed(parseSiAnalytics, data);
}
export type SiCursor = Readonly<{ before: string; beforeId: string }>;
/** The conversations behind one figure, newest first (metadata only). */
export async function fetchSiSessions(filters: SiServerFilters, metric: string, cursor?: SiCursor, signal?: AbortSignal, limit = 25): Promise<SiSessionPage> {
  let query = supabase.rpc("recording_analytics_sessions", {
    p_filters: filters as Json, p_metric: metric, p_limit: limit, ...(cursor ? { p_before: cursor.before, p_before_id: cursor.beforeId } : {}),
  });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  guard(signal, error);
  return recordingParsed(parseSiSessionPage, data);
}
export async function fetchSiDeviceDays(filters: SiServerFilters, offset: number, signal?: AbortSignal, limit = 25): Promise<SiDeviceDayPage> {
  let query = supabase.rpc("recording_device_days_page", { p_filters: filters as Json, p_offset: offset, p_limit: limit });
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query;
  guard(signal, error);
  return recordingParsed(parseSiDeviceDays, data);
}
export async function fetchSiOptions(): Promise<SiOptions> {
  const { data, error } = await supabase.rpc("recording_analytics_options");
  if (error) recordingFail(error);
  return recordingParsed(parseSiOptions, data);
}
