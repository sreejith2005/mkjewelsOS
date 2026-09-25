import { normalizeRosterValue, rosterNames } from "@/lib/roster";

export function availableCrmNames(
  allocation: { crm_name: string }[],
  availability: { crm_name: string; is_available: boolean }[],
) {
  const unavailable = new Set(
    availability.filter((item) => !item.is_available).map((item) => normalizeRosterValue(item.crm_name)),
  );
  return rosterNames(allocation).filter((item) => !unavailable.has(item));
}
