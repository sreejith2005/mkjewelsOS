import { getSupabase as db } from "@jewelos/api-client/client";
import { customerListFilterPayload, type CustomerListFilterOptions, type CustomerListFilters, type CustomerListPage } from "@jewelos/core";

/** One contact on a customer's timeline (public.customer_get_timeline). */
export type CustomerTimelineEntry = Readonly<{
  interaction_id: string;
  interaction_code: string;
  occurred_at: string;
  channel: string;
  direction: string;
  purpose: string;
  outcome: string | null;
  result: "positive" | "negative" | "not_connected" | "neutral";
  successful: boolean;
  non_contact_reason: string | null;
  notes: string | null;
  source: string;
  staff: string | null;
  attended_by: string | null;
  branch: string | null;
  products: readonly Readonly<{ code: string | null; category: string | null; interest: string }>[];
  follow_ups: readonly Readonly<{ code: string; kind: string; due_at: string; status: string }>[];
  appointments: readonly Readonly<{ code: string; type: string; scheduled_at: string; status: string }>[];
}>;

/** The identity card of one customer (public.customer_get_profile). */
export type CustomerProfile = Readonly<{
  client: Readonly<Record<string, string | number | boolean | null>>;
  family: Readonly<{ household_code: string; main_client_id: string | null; members: readonly Readonly<{ client_id: string; client_code: string; name: string | null }>[] }> | null;
  phones: readonly Readonly<{ phone: string; kind: string }>[];
  names: readonly Readonly<{ name: string; source: string | null; last_seen_at: string }>[];
  identifiers: readonly Readonly<{ type: string; value: string }>[];
  referred_by: Readonly<{ client_id: string; client_code: string; name: string | null }> | null;
  field_sources: Readonly<Record<string, Readonly<{ value: string; source: string; observed_at: string }>>>;
  needs_review_count: number;
}>;

export const CUSTOMER_LIST_PAGE_SIZE = 50;

export async function loadCustomerList(filters: CustomerListFilters, page: number): Promise<CustomerListPage> {
  const { data, error } = await db().rpc("customer_list", {
    p_filters: customerListFilterPayload(filters), p_limit: CUSTOMER_LIST_PAGE_SIZE, p_offset: Math.max(0, page) * CUSTOMER_LIST_PAGE_SIZE,
  });
  if (error) throw error;
  // The RPC returns one JSON document whose shape is fixed by migration 0408.
  return data as unknown as CustomerListPage;
}

export async function loadCustomerListFilters(): Promise<CustomerListFilterOptions> {
  const { data, error } = await db().rpc("customer_list_filters");
  if (error) throw error;
  // Shape fixed by migration 0408.
  return data as unknown as CustomerListFilterOptions;
}

export async function loadCustomerProfile(clientId: string): Promise<CustomerProfile> {
  const { data, error } = await db().rpc("customer_get_profile", { p_client_id: clientId });
  if (error) throw error;
  // Shape fixed by migration 0405.
  return data as unknown as CustomerProfile;
}

export async function loadCustomerTimeline(clientId: string, before: string | null = null): Promise<CustomerTimelineEntry[]> {
  const { data, error } = await db().rpc("customer_get_timeline", { p_client_id: clientId, p_limit: 50, p_before: before });
  if (error) throw error;
  // Shape fixed by migration 0406.
  return data as unknown as CustomerTimelineEntry[];
}

/** One answer held about a customer, current or superseded. */
export type CustomerAnswer = Readonly<{
  field_key: string; label: string; value: string; source: string; source_label: string;
  observed_at: string; is_current: boolean; needs_review: boolean; has_column: boolean;
}>;
export type CustomerFollowUp = Readonly<{
  code: string; kind: string; due_at: string; status: string; reason: string | null; assigned_to: string | null;
  origin_interaction_code: string | null; closed_at: string | null; closed_by_interaction_code: string | null;
}>;
export type CustomerAppointment = Readonly<{
  code: string; type: string; scheduled_at: string; status: string; branch: string | null;
  origin_interaction_code: string | null; visit_interaction_code: string | null;
}>;
export type CustomerProduct = Readonly<{ code: string | null; category: string | null; interest: string; interaction_code: string; occurred_at: string }>;

/** Everything about one customer (public.customer_get_client_page). */
export type CustomerClientPage = CustomerProfile & Readonly<{
  answers: readonly CustomerAnswer[];
  follow_ups: readonly CustomerFollowUp[];
  appointments: readonly CustomerAppointment[];
  products: readonly CustomerProduct[];
  sheet_rows: readonly Readonly<{ source: string; label: string; rows: number }>[];
  /** Category keys (migration 0428); absent before it is applied. */
  tags?: readonly string[];
  archived: boolean;
  archive_reason: string | null;
}>;

/** Everything about one interaction (public.customer_get_interaction_page). */
export type CustomerInteractionPage = Readonly<{
  interaction: Readonly<{
    interaction_id: string; interaction_code: string; occurred_at: string; channel: string; direction: string; purpose: string;
    outcome: string | null; result: CustomerTimelineEntry["result"]; successful: boolean; non_contact_reason: string | null;
    notes: string | null; source: string; source_label: string | null; staff: string | null; staff_as_written: string | null;
    assigned_by: string | null; attended_by: string | null; branch: string | null; store_as_written: string | null;
    contact_role: string | null; customer_type_stated: string | null; process_name: string | null; fms_stage: string | null;
    external_ref: string | null; created_at: string; updated_at: string; archived: boolean; archive_reason: string | null;
  }>;
  client: Readonly<{ client_id: string; client_code: string; name: string | null; phone: string | null; city: string | null }>;
  products: readonly Readonly<{ code: string | null; category: string | null; interest: string }>[];
  follow_ups_created: readonly Readonly<{ code: string; kind: string; due_at: string; status: string; reason: string | null; assigned_to: string | null; closed_by_interaction_code: string | null }>[];
  follow_ups_closed: readonly Readonly<{ code: string; kind: string; due_at: string; origin_interaction_code: string | null }>[];
  appointments_created: readonly Readonly<{ code: string; type: string; scheduled_at: string; status: string; branch: string | null }>[];
  appointments_completed: readonly Readonly<{ code: string; type: string; scheduled_at: string }>[];
  answers: readonly Readonly<{ label: string; value: string }>[];
  sheet_row: Readonly<{
    source: string; label: string | null; sheet_row: number | null; status: string; first_seen_at: string; changed_at: string;
    columns: readonly Readonly<{ header: string; value: string | null; in_sheet: boolean }>[];
  }> | null;
}>;

export async function loadCustomerClientPage(clientCode: string): Promise<CustomerClientPage> {
  const { data, error } = await db().rpc("customer_get_client_page", { p_client_code: clientCode });
  if (error) throw error;
  // Shape fixed by migration 0413.
  return data as unknown as CustomerClientPage;
}

export async function loadCustomerInteractionPage(interactionCode: string): Promise<CustomerInteractionPage> {
  const { data, error } = await db().rpc("customer_get_interaction_page", { p_interaction_code: interactionCode });
  if (error) throw error;
  // Shape fixed by migration 0413.
  return data as unknown as CustomerInteractionPage;
}
