import { formMatchesLifecycle } from "../forms/library";

type WorkflowForm = { id: string; family_id: string; name: string; description?: string | null; lifecycle: string; version: number };
type WorkflowSource = { origin: string; source_flow_id?: string; source_flow_name?: string; source_stage_name?: string; workflows?: readonly { id: string; name: string; stage_name?: string }[] };
export type WorkflowFormGroup<T> = { id: string; name: string; stages: { name: string; families: T[][] }[] };

/** Presentation hierarchy only: never creates records or infers assignment eligibility. */
export function groupWorkflowForms<T extends WorkflowForm>(forms: readonly T[], sources: Readonly<Record<string, WorkflowSource>>, filters: { query?: string; lifecycle?: string; workflow?: string; stage?: string } = {}): WorkflowFormGroup<T>[] {
  const groups = new Map<string, { id: string; name: string; stages: Map<string, Map<string, Map<string, T>>> }>();
  const words = (filters.query ?? "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  for (const form of forms) {
    const source = sources[form.id];
    if (source?.origin !== "fms" || !formMatchesLifecycle(form.lifecycle, filters.lifecycle ?? "active")) continue;
    // Current attachments are authoritative. Unattached revisions retain the authorized creation source.
    const links = source.workflows?.length ? source.workflows : [{ id: source.source_flow_id ?? "", name: source.source_flow_name ?? "Workflow unavailable in your access", stage_name: source.source_stage_name }];
    for (const link of links) {
      const stageName = link.stage_name ?? "Stage unavailable";
      if ((filters.workflow && filters.workflow !== link.id) || (filters.stage && filters.stage !== stageName)) continue;
      const searchable = `${link.name} ${stageName} ${form.name} ${form.description ?? ""}`.toLowerCase();
      if (!words.every(word => searchable.includes(word))) continue;
      let group = groups.get(link.id);
      if (!group) { group = { id: link.id, name: link.name, stages: new Map() }; groups.set(link.id, group); }
      let stage = group.stages.get(stageName);
      if (!stage) { stage = new Map(); group.stages.set(stageName, stage); }
      let family = stage.get(form.family_id);
      if (!family) { family = new Map(); stage.set(form.family_id, family); }
      family.set(form.id, form);
    }
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)).map(group => ({ id: group.id, name: group.name, stages: [...group.stages].map(([name, families]) => ({ name, families: [...families.values()].map(family => [...family.values()].sort((a, b) => b.version - a.version)).sort((a, b) => a[0]!.name.localeCompare(b[0]!.name)) })) }));
}
