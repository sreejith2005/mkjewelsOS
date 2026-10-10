import type { JewelosClient } from "@jewelos/api-client";
import type { FmsFlowRow, FmsStageRow } from "./api";

/** Supabase's server page cap must not hide a workflow's newer visits. */
export async function readAllFmsRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const rows: T[] = []; const size = 500;
  for (let from = 0; ; from += size) {
    const result = await page(from, from + size - 1);
    if (result.error) throw new Error(`Load FMS history: ${result.error.message}`);
    const batch = result.data ?? []; rows.push(...batch);
    if (batch.length < size) return rows;
  }
}

/** Scoped, RLS-enforced history; no workspace caps or template-based inference. */
export async function loadFmsVisitHistory(client: JewelosClient, instanceId: string) {
  const instance = await client.from("fms_instances").select("*").eq("id", instanceId).maybeSingle();
  if (instance.error) throw new Error(`Load FMS instance: ${instance.error.message}`);
  if (!instance.data) return null;
  const row = instance.data;
  const [stages, definitions, flow, users, relatives] = await Promise.all([
    readAllFmsRows((from, to) => client.from("fms_instance_stages").select("*").eq("fms_instance_id", row.id).order("created_at").order("id").range(from, to)),
    client.from("fms_stages").select("*").eq("fms_flow_id", row.fms_flow_id).order("sort_order"),
    client.from("fms_flows").select("*").eq("id", row.fms_flow_id),
    client.from("user_profiles").select("id,employee_name,user_role,branch_id,department_id,working_status,is_login_enabled").order("employee_name").limit(500),
    readAllFmsRows((from, to) => client.from("fms_instances").select("*").or(`parent_instance_id.eq.${row.id},id.eq.${row.parent_instance_id ?? row.id}`).order("id").range(from, to)),
  ]);
  for (const result of [definitions, flow, users]) if (result.error) throw new Error(`Load FMS history: ${result.error.message}`);
  const ids = stages.map((stage) => stage.id);
  // Keep query URLs bounded, even after thousands of loop visits.
  const chunks = Array.from({ length: Math.ceil(ids.length / 100) }, (_, index) => ids.slice(index * 100, (index + 1) * 100));
  const checklist = []; const evidence = []; const logs = [];
  for (const chunk of chunks) {
    const [items, files, events] = await Promise.all([
      readAllFmsRows((from, to) => client.from("fms_instance_checklist_items").select("*").in("fms_instance_stage_id", chunk).order("id").range(from, to)),
      readAllFmsRows((from, to) => client.from("fms_evidence").select("*").in("fms_instance_stage_id", chunk).is("removed_at", null).order("id").range(from, to)),
      readAllFmsRows((from, to) => client.from("fms_stage_logs").select("*").in("fms_instance_stage_id", chunk).order("created_at").order("id").range(from, to)),
    ]);
    checklist.push(...items); evidence.push(...files); logs.push(...events);
  }
  const stageDefinitions: FmsStageRow[] = (definitions.data ?? []).map((definition) => {
    const position = definition.canvas_position;
    const canvas_position = position && typeof position === "object" && !Array.isArray(position) && typeof position.x === "number" && typeof position.y === "number" && Number.isFinite(position.x) && Number.isFinite(position.y) ? { x: position.x, y: position.y } : null;
    return { ...definition, is_required: definition.is_required ?? true, parallel_target_stage_ids: definition.parallel_target_stage_ids ?? [], canvas_position };
  });
  const flows = (flow.data ?? []).map((item): FmsFlowRow => {
    const scope_type = item.scope_type;
    if (scope_type !== "tenant" && scope_type !== "branch" && scope_type !== "department") throw new Error("Workflow scope is invalid");
    return { ...item, scope_type, is_active: item.is_active ?? false, usage_count: item.usage_count ?? 0 };
  });
  return { instances: [row, ...relatives.filter((relative) => relative.id !== row.id)], stages, definitions: stageDefinitions, flows, users: users.data ?? [], checklist, evidence, logs };
}
