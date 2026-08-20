import { supabase } from "@jewelos/api-client";
import type { Json } from "@jewelos/core";
import type { ImportedTaskRow } from "./normalizeRows";

export type TaskImportResult = Readonly<{ batch_id: string; created_count: number; rejected_count: number; replayed: boolean }>;

export async function submitTaskImport(rows: readonly ImportedTaskRow[], importHash: string): Promise<TaskImportResult> {
  const rpc = supabase.rpc as unknown as (name: string, args: { p_rows: Json; p_import_hash: string }) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("import_delegation_tasks_with_audit", { p_rows: rows as unknown as Json, p_import_hash: importHash });
  if (error) throw new Error(`Import tasks: ${error.message}`);
  return data as TaskImportResult;
}
