export type CrmSourceRowEnvelope = Readonly<{
  sourceLocator: string;
  sourceRowKey: string;
  observedAt: string | null;
  sourceChecksum: string;
  payload: Record<string, unknown>;
}>;

export type CrmSyncBatchInput = Readonly<{
  sourceKey: string;
  scopeKey: string;
  requestKey: string;
  rows: readonly CrmSourceRowEnvelope[];
}>;

const SOURCE_KEY = /^[a-z][a-z0-9_]{2,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CHECKSUM = /^[a-f0-9]{64}$/;
const REVIEW_CODES = new Set([
  "invalid_phone",
  "missing_branch",
  "duplicate_contact",
  "invalid_date",
  "missing_reference",
  "unsupported_value",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonNegativeCount(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
}

export function validateCrmSyncBatch(input: CrmSyncBatchInput): CrmSyncBatchInput {
  if (!SOURCE_KEY.test(input.sourceKey)) throw new Error("Invalid source key.");
  if (input.scopeKey.trim().length === 0 || input.scopeKey.length > 500) throw new Error("Invalid source scope.");
  if (!UUID.test(input.requestKey)) throw new Error("Invalid request key.");
  if (input.rows.length < 1 || input.rows.length > 500) throw new Error("Batch must contain 1-500 rows.");

  for (const row of input.rows) {
    if (row.sourceLocator.trim().length === 0 || row.sourceRowKey.trim().length === 0 || !CHECKSUM.test(row.sourceChecksum) || !isRecord(row.payload)) {
      throw new Error("Invalid source row.");
    }
  }

  return input;
}

export function safeCrmSyncSummary(result: unknown): { accepted: number; replayed: number; quarantined: number; reviewCodes: string[] } {
  const value = isRecord(result) ? result : {};
  const reviewCodes = Array.isArray(value.review_codes)
    ? [...new Set(value.review_codes.filter((code): code is string => typeof code === "string" && REVIEW_CODES.has(code)))].sort()
    : [];
  return {
    accepted: nonNegativeCount(value.accepted),
    replayed: nonNegativeCount(value.replayed),
    quarantined: nonNegativeCount(value.quarantined),
    reviewCodes,
  };
}
