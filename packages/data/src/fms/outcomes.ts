import { getSupabase } from "@jewelos/api-client/client";
import {
  decodeFmsFlowRecords, decodeFmsFlowReport, decodeFmsJourney, decodeFmsLibraryOutcomes, fmsRecordFilterJson, fmsReportFilterJson,
  type FmsRecordFilters, type FmsReportFilters,
} from "@jewelos/core";

/** Server-aggregated KPIs, End Node counts and stage reach for one workflow family (0359). */
export async function loadFmsFlowReport(familyId: string, filters: FmsReportFilters) {
  const result = await getSupabase().rpc("get_fms_flow_report", { p_family_id: familyId, p_filter: fmsReportFilterJson(filters) });
  if (result.error) throw new Error(result.error.message);
  return decodeFmsFlowReport(result.data);
}
/** Running and outcome counts for every workflow card the caller may see. */
export async function loadFmsLibraryOutcomes() {
  const result = await getSupabase().rpc("get_fms_library_outcomes");
  if (result.error) throw new Error(result.error.message);
  return decodeFmsLibraryOutcomes(result.data);
}
export const FMS_RECORD_PAGE_SIZE = 25;
/** One page of workflow records, filtered and authorized on the server. */
export async function loadFmsFlowRecords(familyId: string, filters: FmsRecordFilters, offset = 0) {
  const result = await getSupabase().rpc("get_fms_flow_records", { p_family_id: familyId, p_filter: fmsRecordFilterJson(filters), p_offset: offset, p_limit: FMS_RECORD_PAGE_SIZE });
  if (result.error) throw new Error(result.error.message);
  return decodeFmsFlowRecords(result.data);
}
/** The persisted journey of one instance, loaded only when it is opened. */
export async function loadFmsInstanceJourney(instanceId: string) {
  const result = await getSupabase().rpc("get_fms_instance_journey", { p_instance_id: instanceId });
  if (result.error) throw new Error(result.error.message);
  return decodeFmsJourney(result.data);
}
