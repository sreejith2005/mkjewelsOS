/** Archived history remains available when the user explicitly selects all versions. */
export function formMatchesLifecycle(lifecycle: string, filter: string): boolean {
  return filter === "all" || (filter === "active" ? lifecycle !== "archived" : lifecycle === filter);
}
