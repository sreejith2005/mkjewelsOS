import { getSupabase } from "@jewelos/api-client/client";
import {
  parsePerformanceOptions,
  parsePerformancePayload,
  parsePerformanceRecordPage,
  parsePerformanceStages,
  performanceContext,
  type PerformanceFilter,
  type PerformanceOptions,
  type PerformancePayload,
  type PerformanceRecordPage,
  type PerformanceRecordSelector,
  type PerformanceStage,
} from "@jewelos/core";

/**
 * Employee task performance reads (migration 0382). Each call is one authorized,
 * aggregate-first RPC; records load only when a count is opened. Every call accepts an
 * AbortSignal so a superseded filter cancels its request instead of racing the new one.
 */

export async function fetchTaskPerformance(filter: PerformanceFilter, signal?: AbortSignal): Promise<PerformancePayload> {
  const request = getSupabase().rpc("get_task_performance_dashboard_v1", { p_context: performanceContext(filter) });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  return parsePerformancePayload(data);
}

export type PerformanceRecordQuery = {
  filter: PerformanceFilter;
  selector: PerformanceRecordSelector;
  stageKey?: string | undefined;
  offset?: number | undefined;
  limit?: number | undefined;
};

export async function fetchTaskPerformanceRecords(query: PerformanceRecordQuery, signal?: AbortSignal): Promise<PerformanceRecordPage> {
  const request = getSupabase().rpc("get_task_performance_records_v1", {
    p_context: performanceContext(query.filter),
    p_bucket: query.selector,
    ...(query.stageKey ? { p_stage_key: query.stageKey } : {}),
    p_offset: query.offset ?? 0,
    p_limit: query.limit ?? 25,
  });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  return parsePerformanceRecordPage(data);
}

export async function fetchTaskPerformanceStages(filter: PerformanceFilter, signal?: AbortSignal): Promise<PerformanceStage[]> {
  const request = getSupabase().rpc("get_task_performance_fms_stages_v1", { p_context: performanceContext(filter) });
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  return parsePerformanceStages(data);
}

export async function fetchTaskPerformanceOptions(signal?: AbortSignal): Promise<PerformanceOptions> {
  const request = getSupabase().rpc("get_task_performance_options_v1");
  const { data, error } = await (signal ? request.abortSignal(signal) : request);
  if (error) throw error;
  return parsePerformanceOptions(data);
}
