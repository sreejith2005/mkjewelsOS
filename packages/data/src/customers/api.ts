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
