/** Archived history remains available when the user explicitly selects all versions. */
export function formMatchesLifecycle(lifecycle: string, filter: string): boolean {
  return filter === "all" || (filter === "active" ? lifecycle !== "archived" : lifecycle === filter);
}

/** A form family built inside an FMS workflow step (`list_fms_built_forms`). Names are sent to form authors only. */
export type FmsBuiltFormLink = Readonly<{
  workflowId: string; workflowName: string; stageId: string; stageName: string;
  /** Since 0364: one id for every saved version of the workflow, so versions group together. */
  workflowFamilyId?: string; workflowVersion?: number; workflowStatus?: "draft" | "published" | "archived";
  stageOrder?: number;
  /** Since 0364: this row is the workflow's current version (published, else newest). */
  isCurrent?: boolean;
}>;
export type FmsBuiltForm = Readonly<{ familyId: string; workflows: readonly string[]; steps: readonly string[]; links?: readonly FmsBuiltFormLink[] }>;
const FLOW_STATUSES = ["draft", "published", "archived"] as const;

const names = (value: unknown): readonly string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];

/** Reads the server's list; anything malformed is skipped rather than failing the library. */
export function parseFmsBuiltForms(raw: unknown): ReadonlyMap<string, FmsBuiltForm> {
  const built = new Map<string, FmsBuiltForm>();
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.familyId !== "string" || !record.familyId) continue;
    const links = Array.isArray(record.links) ? record.links.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== "object") return [];
      const link = entry as Record<string, unknown>;
      if (!(typeof link.workflowId === "string" && link.workflowId && typeof link.workflowName === "string" && link.workflowName && typeof link.stageId === "string" && link.stageId && typeof link.stageName === "string" && link.stageName)) return [];
      const status = FLOW_STATUSES.find(value => value === link.workflowStatus);
      return [{ workflowId: link.workflowId, workflowName: link.workflowName, stageId: link.stageId, stageName: link.stageName,
        ...(typeof link.workflowFamilyId === "string" && link.workflowFamilyId ? { workflowFamilyId: link.workflowFamilyId } : {}),
        ...(typeof link.workflowVersion === "number" && Number.isFinite(link.workflowVersion) ? { workflowVersion: link.workflowVersion } : {}),
        ...(status ? { workflowStatus: status } : {}),
        ...(typeof link.stageOrder === "number" && Number.isFinite(link.stageOrder) ? { stageOrder: link.stageOrder } : {}),
        ...(typeof link.isCurrent === "boolean" ? { isCurrent: link.isCurrent } : {}) }];
    }) : [];
    built.set(record.familyId, { familyId: record.familyId, workflows: names(record.workflows), steps: names(record.steps), ...(links.length ? { links } : {}) });
  }
  return built;
}
