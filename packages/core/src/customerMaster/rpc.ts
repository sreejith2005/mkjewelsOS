import type { Json } from "../database.types";

/**
 * Public signatures of the customer master RPCs (migrations 0405-0408). Kept
 * separate from the generated bulk types, like the customer integration
 * signatures. The customer_ingest_* functions are service-role only.
 */
export type CustomerMasterFunctions = {
  customer_search: {
    Args: { p_query: string; p_limit?: number };
    Returns: {
      client_id: string; client_code: string; household_code: string; referral_code: string;
      primary_name: string | null; primary_phone: string | null; segment: string; lifecycle_stage: string;
      city: string | null; matched_on: string;
    }[];
  };
  customer_get_profile: { Args: { p_client_id: string }; Returns: Json };
  customer_get_timeline: { Args: { p_client_id: string; p_limit?: number; p_before?: string | null }; Returns: Json };
  customer_calls_by_staff: {
    Args: { p_day?: string | null };
    Returns: { staff_user_id: string | null; staff_name: string | null; calls: number; reached: number; positive: number; negative: number; not_connected: number }[];
  };
  customer_list: { Args: { p_filters?: Json; p_limit?: number; p_offset?: number }; Returns: Json };
  customer_list_filters: { Args: Record<never, never>; Returns: Json };
  customer_ingest_state: { Args: { p_source: string }; Returns: Json };
  customer_ingest_sheet_rows: { Args: { p_source: string; p_rows: Json; p_next_row?: number | null }; Returns: Json };
  customer_ingest_apply: { Args: { p_source: string; p_limit?: number }; Returns: Json };
  customer_ingest_note_error: { Args: { p_source: string; p_error: string }; Returns: undefined };
};
