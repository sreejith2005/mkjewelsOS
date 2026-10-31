export function normalizeRosterValue(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, " ");
}

export function rosterNames<T extends { crm_name: string }>(items: T[]): string[] {
  const names = new Set<string>();
  for (const item of items) {
    const name = normalizeRosterValue(item.crm_name);
    if (name) names.add(name);
  }
  return [...names];
}

/** CRM filter value for records whose CRM is not on the current roster (former staff). */
export const OFF_ROSTER = "__off_roster__";

/** The CRM dropdowns list the current roster (JewelOS Users -> crm_allocation); records keep the name they were saved with. */
export function rosterFilterMatches(name: string, selected: string, roster: ReadonlySet<string>): boolean {
  if (!selected) return true;
  const normalized = normalizeRosterValue(name);
  return selected === OFF_ROSTER ? !roster.has(normalized) : normalized === selected;
}
