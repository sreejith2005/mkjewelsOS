import { normalizeIndianPhone } from "./phone";
import type { CrmSearchInput, NormalizedCrmSearch } from "./types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function normalizeCrmSearch(input: CrmSearchInput): NormalizedCrmSearch {
  const query = input.query?.trim().replace(/\s+/g, " ").slice(0, 100) ?? "";
  const phone = query ? normalizeIndianPhone(query) : null;
  const identifiers = [input.branchId, input.assignedCrmId, input.clientTypeId, input.sourceId];
  if (identifiers.some((id) => id && !UUID.test(id))) throw new Error("A search filter identifier is invalid.");
  return { ...input, query: phone?.normalized ?? query, limit: Math.min(100, Math.max(1, Math.trunc(input.limit ?? 25))) };
}
