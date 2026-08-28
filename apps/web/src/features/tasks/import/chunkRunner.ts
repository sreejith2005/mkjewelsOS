import { chunkTaskImportRows, type TaskImportCanonicalRow } from "@jewelos/core";

export type ChunkOutcome = Readonly<{ created: number; rejected: number; replayed: number; assigning_left_count?: number; outcome: string; issues: readonly unknown[] }>;
export async function runTaskImportChunks(
  batchId: string,
  rows: readonly TaskImportCanonicalRow[] | readonly { source_row: number }[],
  commit: (batchId: string, rows: readonly TaskImportCanonicalRow[] | readonly { source_row: number }[]) => Promise<ChunkOutcome>,
  onProgress: (processed: number) => void,
) {
  let created = 0; let rejected = 0; let replayed = 0; let processed = 0; let assigningLeft = 0; let outcome = "in_progress"; const issues: unknown[] = [];
  for (const chunk of chunkTaskImportRows(rows)) {
    const result = await commit(batchId, chunk);
    created += result.created; rejected += result.rejected; replayed += result.replayed; outcome = result.outcome; issues.push(...result.issues);
    // assigning_left_count is a batch-cumulative total, so the newest chunk supersedes earlier ones rather than adding to them.
    assigningLeft = result.assigning_left_count ?? assigningLeft;
    processed += chunk.length; onProgress(processed);
  }
  return { created, rejected, replayed, assigningLeft, outcome, issues };
}
