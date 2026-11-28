import { getSupabase as db } from "@jewelos/api-client/client";
import { customerListFilterPayload, type CustomerCallLog, type CustomerListFilterOptions, type CustomerListFilters, type CustomerListPage } from "@jewelos/core";

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
  /** Migration 0446: the Runo call log of this call, whether an interaction form was filled, and the sheets it is in. */
  call?: CustomerCallLog | null;
  has_interaction_form?: boolean;
  sheets?: readonly string[];
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

/** Counts for the list's filters, for the chosen franchise ("" = own, "all", or an id; migration 0433). */
export async function loadCustomerListFilters(franchise = ""): Promise<CustomerListFilterOptions> {
  const { data, error } = await db().rpc("customer_list_filters", { p_franchise: franchise || null });
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
  /** The customer's franchise (migration 0433). */
  franchise?: string | null;
  /** Records that may be the same person (migration 0436); absent before it is applied. */
  possibly_same_as?: readonly Readonly<{ client_code: string; name: string | null }>[];
  /** Category keys (migration 0428); absent before it is applied. */
  tags?: readonly string[];
  archived: boolean;
  archive_reason: string | null;
  /** Migration 0451/0452: bad-data kinds, whether a person moved the customer into the main list, and whether this person may. */
  data_problems?: readonly string[];
  data_review?: "main" | null;
  data_reviewed_at?: string | null;
  data_reviewed_by?: string | null;
  can_review_data?: boolean;
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
    /** Migration 0446. */
    call?: CustomerCallLog | null; has_interaction_form?: boolean; sheets?: readonly string[];
  }>;
  /** Migration 0446: the same call's rows in other sheets. */
  other_sheet_rows?: readonly Readonly<{ source: string; label: string; sheet_row: number | null; status: string }>[];
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

/** One side of a pair on the "Possibly same person" review (migration 0438). */
export type CustomerReviewSide = Readonly<{
  client_code: string; name: string | null; other_names: readonly string[]; phones: readonly string[];
  franchise: string | null; segment: string | null; city: string | null; first_source: string | null; first_origin: string | null;
  first_seen_at: string | null; last_contacted_at: string | null; interaction_count: number | null; sheet_rows: number;
}>;

/** A pair waiting for a verdict: a flag ("possible") or a join made automatically ("joined", b is the record joined into a). */
export type CustomerReviewItem = Readonly<{
  id: string; kind: "possible" | "joined"; note: string | null; created_at: string;
  a: CustomerReviewSide; b: CustomerReviewSide;
  linking_rows: readonly Readonly<{ source: string; sheet_row: number | null }>[] | null;
}>;

export type CustomerReviewResult = Readonly<{ result: "merged" | "kept_separate" | "kept_joined" | "separated"; client_code: string | null }>;

export async function loadCustomerReviewList(): Promise<CustomerReviewItem[]> {
  const { data, error } = await db().rpc("customer_review_list", {});
  if (error) throw error;
  // Shape fixed by migration 0438.
  return (data ?? []) as unknown as CustomerReviewItem[];
}

export async function decideCustomerReview(reviewId: string, same: boolean): Promise<CustomerReviewResult> {
  const { data, error } = await db().rpc("customer_review_decide", { p_review_id: reviewId, p_same: same });
  if (error) throw error;
  // Shape fixed by migration 0438.
  return data as unknown as CustomerReviewResult;
}

/** Move a customer with a data problem into the main list (main = true) or set them aside again (migration 0452). */
export async function setCustomerDataReview(clientCode: string, main: boolean): Promise<void> {
  const { error } = await db().rpc("customer_set_data_review", { p_client_code: clientCode, p_main: main });
  if (error) throw error;
}

/**
 * A form's client lookup (migration 0441): the known details of the customer with this phone
 * number, keyed as forms ask them, or null; and city, state and country for a pincode.
 */
export async function lookupCustomerForForm(kind: "client_phone" | "pincode", value: string): Promise<Readonly<Record<string, string | null>> | null> {
  const { data, error } = kind === "pincode"
    ? await db().rpc("customer_pincode_lookup", { p_pincode: value })
    : await db().rpc("customer_form_lookup", { p_phone: value });
  if (error) throw error;
  // Shape fixed by migration 0441: an object of text values, or null.
  return (data ?? null) as Readonly<Record<string, string | null>> | null;
}

export async function loadCustomerInteractionPage(interactionCode: string): Promise<CustomerInteractionPage> {
  const { data, error } = await db().rpc("customer_get_interaction_page", { p_interaction_code: interactionCode });
  if (error) throw error;
  // Shape fixed by migration 0413.
  return data as unknown as CustomerInteractionPage;
}
