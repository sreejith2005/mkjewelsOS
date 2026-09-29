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
