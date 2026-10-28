/** Archived history remains available when the user explicitly selects all versions. */
export function formMatchesLifecycle(lifecycle: string, filter: string): boolean {
  return filter === "all" || (filter === "active" ? lifecycle !== "archived" : lifecycle === filter);
}

/** A form family built inside an FMS workflow step (`list_fms_built_forms`). Names are sent to form authors only. */
export type FmsBuiltForm = Readonly<{ familyId: string; workflows: readonly string[]; steps: readonly string[] }>;

const names = (value: unknown): readonly string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];

/** Reads the server's list; anything malformed is skipped rather than failing the library. */
export function parseFmsBuiltForms(raw: unknown): ReadonlyMap<string, FmsBuiltForm> {
  const built = new Map<string, FmsBuiltForm>();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.familyId !== "string" || !record.familyId) continue;
    built.set(record.familyId, { familyId: record.familyId, workflows: names(record.workflows), steps: names(record.steps) });
  }
  return built;
}
