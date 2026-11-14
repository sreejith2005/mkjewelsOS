/**
 * Customer master list: the filter model shared by every client, and how it is
 * sent to public.customer_list (migration 0408).
 */

export type CustomerSegment = "buyer" | "non-buyer" | "lead";
export type CustomerLifecycleStage = "lead" | "engaged" | "visited";
export type CustomerListSort = "recent" | "least_recent" | "name" | "newest";

/** "Last contacted" choices offered on the list. */
export type CustomerContactWindow = "any" | "not_30" | "not_90" | "not_180" | "within_30";

export type CustomerListFilters = Readonly<{
  query: string;
  segment: CustomerSegment | "";
  lifecycleStage: CustomerLifecycleStage | "";
  city: string;
  community: string;
  firstSource: string;
  contact: CustomerContactWindow;
  followUpDue: boolean;
  sort: CustomerListSort;
}>;

export const EMPTY_CUSTOMER_LIST_FILTERS: CustomerListFilters = {
  query: "", segment: "", lifecycleStage: "", city: "", community: "", firstSource: "",
  contact: "any", followUpDue: false, sort: "recent",
};

export const CUSTOMER_SEGMENT_LABELS: Record<CustomerSegment, string> = { buyer: "Buyer", "non-buyer": "Non-buyer", lead: "Lead" };
export const CUSTOMER_STAGE_LABELS: Record<CustomerLifecycleStage, string> = { lead: "New lead", engaged: "Spoken to", visited: "Visited" };
export const CUSTOMER_CONTACT_LABELS: Record<CustomerContactWindow, string> = {
  any: "Any time",
  not_30: "Not reached in 30 days",
  not_90: "Not reached in 90 days",
  not_180: "Not reached in 180 days",
  within_30: "Reached in the last 30 days",
};
export const CUSTOMER_SORT_LABELS: Record<CustomerListSort, string> = {
  recent: "Last reached: newest first",
  least_recent: "Last reached: oldest first",
  name: "Name",
  newest: "Newest record",
};

export type CustomerListRow = Readonly<{
  client_id: string;
  client_code: string;
  household_code: string | null;
  primary_name: string | null;
  primary_phone: string | null;
  segment: CustomerSegment;
  lifecycle_stage: CustomerLifecycleStage;
  city: string | null;
  community: string | null;
  first_source: string | null;
  first_seen_at: string | null;
  last_contacted_at: string | null;
  last_attempt_at: string | null;
  interaction_count: number;
  successful_interaction_count: number;
  next_follow_up_at: string | null;
}>;

export type CustomerListPage = Readonly<{ total: number; rows: readonly CustomerListRow[] }>;

export type CustomerFilterValue = Readonly<{ value: string; count: number; label?: string }>;
export type CustomerListFilterOptions = Readonly<{
  total: number;
  cities: readonly CustomerFilterValue[];
  communities: readonly CustomerFilterValue[];
  first_sources: readonly CustomerFilterValue[];
  segments: Readonly<Partial<Record<CustomerSegment, number>>>;
  import: readonly Readonly<{ source: string; last_run_at: string | null; rows_received: number; failed: boolean }>[];
}>;

/** The p_filters object for public.customer_list. Unset filters are left out. */
export function customerListFilterPayload(filters: CustomerListFilters): Record<string, string | number | boolean | string[]> {
  const payload: Record<string, string | number | boolean | string[]> = {};
  const query = filters.query.trim();
  if (query) payload.q = query;
  if (filters.segment) payload.segment = filters.segment;
  if (filters.lifecycleStage) payload.lifecycle_stage = filters.lifecycleStage;
  if (filters.city) payload.cities = [filters.city];
  if (filters.community) payload.communities = [filters.community];
  if (filters.firstSource) payload.first_sources = [filters.firstSource];
  if (filters.contact === "not_30") payload.not_contacted_days = 30;
  if (filters.contact === "not_90") payload.not_contacted_days = 90;
  if (filters.contact === "not_180") payload.not_contacted_days = 180;
  if (filters.contact === "within_30") payload.contacted_within_days = 30;
  if (filters.followUpDue) payload.follow_up_due = true;
  if (filters.sort !== "recent") payload.sort = filters.sort;
  return payload;
}

/** How many filters are set, not counting the sort order. */
export function activeCustomerFilterCount(filters: CustomerListFilters): number {
  return [filters.query.trim(), filters.segment, filters.lifecycleStage, filters.city, filters.community, filters.firstSource,
    filters.contact !== "any", filters.followUpDue].filter(Boolean).length;
}

/** "Today", "Yesterday", "12 days ago", then the date. Null when never. */
export function daysAgoLabel(iso: string | null, now: Date = new Date()): string | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  const dayMs = 86_400_000;
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(then)) / dayMs);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 60) return `${days} days ago`;
  return then.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}
