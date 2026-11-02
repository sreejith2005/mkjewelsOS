import { formMatchesLifecycle, type FmsBuiltForm } from "../forms/library";

type WorkflowForm = { id: string; family_id: string; name: string; description?: string | null; lifecycle: string; version: number };
type WorkflowSource = { origin: string; source_flow_id?: string; source_flow_name?: string; source_stage_name?: string; workflows?: readonly { id: string; name: string; stage_id?: string; stage_name?: string }[] };
export type WorkflowFormGroup<T> = { id: string; name: string; stages: { id: string; name: string; families: T[][] }[] };

export type FmsWorkflowStatus = "draft" | "published" | "archived";
export type FmsWorkflowFormStage<T> = { id: string; name: string; order: number; families: T[][] };
export type FmsWorkflowFormGroup<T> = {
  /** The workflow family, so every saved version of one workflow is one group. */
  id: string;
  name: string;
  status?: FmsWorkflowStatus;
  version?: number;
  /** Steps of the current version, in workflow order. */
  stages: FmsWorkflowFormStage<T>[];
  /** Forms used only by a draft or an older version of this workflow, listed once. */
  elsewhere: T[][];
  familyCount: number;
};
const UNAVAILABLE_WORKFLOW = "Workflow unavailable in your access";

/**
 * One group per workflow (not per saved version), the current version's steps in
 * order, and each form family listed once per step. Uses only server-authorized
 * workflow/step pairs; legacy aggregate arrays cannot establish pairs.
 */
export function groupFmsBuiltForms<T extends WorkflowForm>(forms: readonly T[], built: ReadonlyMap<string, FmsBuiltForm>, filters: { query?: string; lifecycle?: string } = {}): FmsWorkflowFormGroup<T>[] {
  type Bucket = { name: string; order: number; families: Map<string, Map<string, T>> };
  type Group = { id: string; name: string; status?: FmsWorkflowStatus; version?: number; named: boolean; stages: Map<string, Bucket>; elsewhere: Map<string, Map<string, T>> };
  const groups = new Map<string, Group>();
  const words = (filters.query ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const add = (target: Map<string, Map<string, T>>, form: T) => { let family = target.get(form.family_id); if (!family) { family = new Map(); target.set(form.family_id, family); } family.set(form.id, form); };
  for (const form of forms) {
    const source = built.get(form.family_id);
    if (!source || !formMatchesLifecycle(form.lifecycle, filters.lifecycle ?? "active")) continue;
    const links = source.links?.length ? source.links : [{ workflowId: "", workflowName: UNAVAILABLE_WORKFLOW, stageId: "", stageName: "Stage unavailable" }];
    for (const link of links) {
      const current = link.isCurrent !== false;
      const searchable = `${link.workflowName} ${current ? link.stageName : ""} ${form.name} ${form.description ?? ""}`.toLowerCase();
      if (!words.every(word => searchable.includes(word))) continue;
      const id = link.workflowFamilyId ?? link.workflowId;
      let group = groups.get(id);
      if (!group) { group = { id, name: link.workflowName, named: false, stages: new Map(), elsewhere: new Map() }; groups.set(id, group); }
      // The current version names the group; otherwise the newest version seen.
      if (current ? !group.named : !group.named && (link.workflowVersion ?? 0) >= (group.version ?? 0)) {
        group.name = link.workflowName; group.named = current;
        if (link.workflowStatus) group.status = link.workflowStatus;
        if (link.workflowVersion !== undefined) group.version = link.workflowVersion;
      }
      if (!current) { add(group.elsewhere, form); continue; }
      const stageId = link.stageId || link.stageName;
      let stage = group.stages.get(stageId);
      if (!stage) { stage = { name: link.stageName, order: link.stageOrder ?? Number.MAX_SAFE_INTEGER, families: new Map() }; group.stages.set(stageId, stage); }
      add(stage.families, form);
    }
  }
  const families = (items: Iterable<Map<string, T>>) => [...items].map(family => [...family.values()].sort((a, b) => b.version - a.version)).sort((a, b) => a[0]!.name.localeCompare(b[0]!.name));
  return [...groups.values()].map(group => {
    const shown = new Set([...group.stages.values()].flatMap(stage => [...stage.families.keys()]));
    const elsewhere = families([...group.elsewhere].filter(([familyId]) => !shown.has(familyId)).map(([, family]) => family));
    return { id: group.id, name: group.name, ...(group.status ? { status: group.status } : {}), ...(group.version !== undefined ? { version: group.version } : {}),
      stages: [...group.stages].map(([id, stage]) => ({ id, name: stage.name, order: stage.order, families: families(stage.families.values()) })).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)),
      elsewhere, familyCount: shown.size + elsewhere.length };
  }).sort((a, b) => Number(a.name === UNAVAILABLE_WORKFLOW) - Number(b.name === UNAVAILABLE_WORKFLOW) || a.name.localeCompare(b.name));
}

/** Presentation hierarchy only: never creates records or infers assignment eligibility. */
export function groupWorkflowForms<T extends WorkflowForm>(forms: readonly T[], sources: Readonly<Record<string, WorkflowSource>>, filters: { query?: string; lifecycle?: string; workflow?: string; stage?: string } = {}): WorkflowFormGroup<T>[] {
  const groups = new Map<string, { id: string; name: string; stages: Map<string, { name: string; families: Map<string, Map<string, T>> }> }>();
  const words = (filters.query ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  for (const form of forms) {
    const source = sources[form.id];
    if (source?.origin !== "fms" || !formMatchesLifecycle(form.lifecycle, filters.lifecycle ?? "active")) continue;
    // Current attachments are authoritative. Unattached revisions retain the authorized creation source.
    const links: NonNullable<WorkflowSource["workflows"]> = source.workflows?.length ? source.workflows : [{ id: source.source_flow_id ?? "", name: source.source_flow_name ?? "Workflow unavailable in your access", ...(source.source_stage_name ? { stage_name: source.source_stage_name } : {}) }];
    for (const link of links) {
      const stageName = link.stage_name ?? "Stage unavailable";
      const stageId = link.stage_id || stageName;
      if ((filters.workflow && filters.workflow !== link.id) || (filters.stage && filters.stage !== stageId)) continue;
      const searchable = `${link.name} ${stageName} ${form.name} ${form.description ?? ""}`.toLowerCase();
      if (!words.every(word => searchable.includes(word))) continue;
      let group = groups.get(link.id);
      if (!group) { group = { id: link.id, name: link.name, stages: new Map() }; groups.set(link.id, group); }
      let stage = group.stages.get(stageId);
      if (!stage) { stage = { name: stageName, families: new Map() }; group.stages.set(stageId, stage); }
      let family = stage.families.get(form.family_id);
      if (!family) { family = new Map(); stage.families.set(form.family_id, family); }
      family.set(form.id, form);
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).map(group => ({ id: group.id, name: group.name, stages: [...group.stages].map(([id, stage]) => ({ id, name: stage.name, families: [...stage.families.values()].map(family => [...family.values()].sort((a, b) => b.version - a.version)).sort((a, b) => a[0]!.name.localeCompare(b[0]!.name)) })) }));
}
