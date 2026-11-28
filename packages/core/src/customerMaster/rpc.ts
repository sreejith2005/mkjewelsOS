import type { Json } from "../database.types";

/**
 * Public signatures of the customer master RPCs (migrations 0405-0409). Kept
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
  customer_get_client_page: { Args: { p_client_code: string }; Returns: Json };
  customer_get_interaction_page: { Args: { p_interaction_code: string }; Returns: Json };
  customer_list: { Args: { p_filters?: Json; p_limit?: number; p_offset?: number }; Returns: Json };
  customer_list_filters: { Args: { p_franchise?: string | null }; Returns: Json };
  customer_review_list: { Args: Record<string, never>; Returns: Json };
  customer_form_lookup: { Args: { p_phone: string }; Returns: Json };
  customer_pincode_lookup: { Args: { p_pincode: string }; Returns: Json };
  customer_review_decide: { Args: { p_review_id: string; p_same: boolean }; Returns: Json };
  customer_set_data_review: { Args: { p_client_code: string; p_main: boolean }; Returns: Json };
  customer_review_queue: { Args: { p_kind: string; p_offset?: number }; Returns: Json };
  customer_table: { Args: { p_request: Json }; Returns: Json };
  customer_std_overview: { Args: Record<string, never>; Returns: Json };
  customer_std_queue: { Args: { p_field: string; p_show?: string; p_offset?: number }; Returns: Json };
  customer_std_preview: { Args: { p_field: string; p_input_key: string }; Returns: Json };
  customer_std_decide: { Args: { p_field: string; p_input_key: string; p_decision: Json; p_reason?: string | null }; Returns: Json };
  customer_std_review_draft: { Args: { p_rule_id: string; p_approve: boolean; p_reason?: string | null }; Returns: Json };
  customer_std_end_rule: { Args: { p_rule_id: string; p_reason: string }; Returns: Json };
  customer_std_rules: { Args: { p_field: string; p_offset?: number }; Returns: Json };
  customer_std_set_policy: { Args: { p_field: string; p_policy: string; p_multi?: boolean }; Returns: Json };
  customer_std_reprocess: { Args: { p_field: string }; Returns: Json };
  customer_ref_values: { Args: { p_domain: string; p_q?: string | null; p_offset?: number }; Returns: Json };
  customer_ref_save: { Args: { p_request: Json }; Returns: Json };
  customer_table_fields: { Args: Record<string, never>; Returns: Json };
  customer_table_values: { Args: { p_field: string; p_q?: string | null; p_franchise?: string | null }; Returns: Json };
  customer_ingest_state: { Args: { p_source: string }; Returns: Json };
  customer_ingest_sheet_rows: { Args: { p_source: string; p_rows: Json; p_next_row?: number | null }; Returns: Json };
  customer_ingest_store: { Args: { p_source: string; p_rows: Json; p_options?: Json }; Returns: Json };
  customer_ingest_finish_scan: { Args: { p_source: string; p_limit?: number }; Returns: Json };
  customer_ingest_apply: { Args: { p_source: string; p_limit?: number }; Returns: Json };
  customer_ingest_note_error: { Args: { p_source: string; p_error: string }; Returns: undefined };
};
