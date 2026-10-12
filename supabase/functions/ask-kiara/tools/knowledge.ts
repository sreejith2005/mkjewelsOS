import type { KiaraCitationSource } from "../../../../packages/core/src/assistant/citations.ts";
import { argText, isRecord, isUuid, outcomeForError, records, untrusted, type ExecutorContext, type ToolArgs, type ToolOutcome } from "./shared.ts";

/** Excerpts returned per search, and the result size Kiara receives (about 4,000 tokens). */
export const KNOWLEDGE_RESULT_LIMIT = 5;
/** The search-again retry casts a wider net (the database allows up to 8). */
export const KNOWLEDGE_RETRY_LIMIT = 8;
export const KNOWLEDGE_RESULT_MAX_CHARS = 16_000;
const EXCERPT_MAX_CHARS = 4_500;

export type KnowledgeSearch = Readonly<{ outcome: ToolOutcome; sources: readonly KiaraCitationSource[] }>;

/**
 * `search_knowledge_base`: the database search runs as the caller, so the
 * tenant, document status (active documents' live versions only), and each
 * document's visibility (everyone, departments, managers and above) are
 * enforced there, and the asker's own-department documents rank higher. Excerpts are people's writing and
 * reach the model only as untrusted text (spec 12, rule 7). The returned
 * sources are the only chunks this turn may cite; results that do not fit the
 * size cap are dropped whole (lowest ranked first) and are not citable.
 */
export async function searchKnowledge(context: ExecutorContext, args: ToolArgs, earlierSearches = 0): Promise<KnowledgeSearch> {
  const query = argText(args, "english_query") ?? "";
  const originalTerms = argText(args, "original_terms");
  const { data, error } = await context.actor.rpc("search_kiara_knowledge", {
    p_query: query,
    p_original_terms: originalTerms,
    p_limit: earlierSearches > 0 ? KNOWLEDGE_RETRY_LIMIT : KNOWLEDGE_RESULT_LIMIT,
  });
  if (error) return { outcome: outcomeForError(error), sources: [] };
  const rows = records(isRecord(data) ? data.results : null).filter((row) =>
    isUuid(row.chunk_id) && isUuid(row.document_id) && isUuid(row.version_id) && typeof row.title === "string" && typeof row.content === "string");

  const results: Record<string, unknown>[] = [];
  const sources: KiaraCitationSource[] = [];
  let size = 0;
  for (const row of rows) {
    const departments = Array.isArray(row.departments) ? row.departments.filter((name): name is string => typeof name === "string").slice(0, 20) : [];
    const item = {
      chunk_id: row.chunk_id as string,
      title: row.title as string,
      section: typeof row.heading_path === "string" && row.heading_path ? row.heading_path : null,
      // Department names are set by Super Admin; the asker's own are marked.
      departments,
      ...(row.own_department === true ? { own_department: true } : {}),
      excerpt: untrusted(row.content, EXCERPT_MAX_CHARS),
    };
    const itemSize = JSON.stringify(item).length + 1;
    if (size + itemSize > KNOWLEDGE_RESULT_MAX_CHARS - 200) break;
    size += itemSize;
    results.push(item);
    sources.push({
      chunk_id: row.chunk_id as string,
      document_id: row.document_id as string,
      version_id: row.version_id as string,
      title: row.title as string,
      heading_path: typeof row.heading_path === "string" ? row.heading_path : "",
    });
  }
  if (results.length === 0) {
    return { outcome: { result: { results: [], found: 0, message: "No matching SOP sections were found. If this was your first search, search once more with different words before saying you could not find it." }, isError: false }, sources };
  }
  return {
    outcome: { result: { results, found: results.length, ...(results.length < rows.length ? { truncated: true } : {}) }, isError: false, maxChars: KNOWLEDGE_RESULT_MAX_CHARS },
    sources,
  };
}
