import { describe, expect, it } from "vitest";
import * as crm from "./index";

type SyncApi = {
  validateCrmSyncBatch: (input: unknown) => unknown;
  safeCrmSyncSummary: (result: unknown) => unknown;
};

const syncApi = crm as unknown as SyncApi;

describe("CRM sync ingestion contract", () => {
  it("accepts a bounded stable source batch", () => {
    expect(syncApi.validateCrmSyncBatch({
      sourceKey: "google_sheets",
      scopeKey: "sheet-a|tab-b",
      requestKey: "1b7e0e34-4e13-4f05-b8fd-3c3c3ebd8d17",
      rows: [{
        sourceLocator: "sheet-a|tab-b",
        sourceRowKey: "sheet-a|tab-b|42",
        observedAt: "2026-08-21T00:00:00.000Z",
        sourceChecksum: "a".repeat(64),
        payload: { field_customer: "redacted" },
      }],
    })).toMatchObject({ sourceKey: "google_sheets", scopeKey: "sheet-a|tab-b" });
  });

  it("rejects batches outside the safe bounds", () => {
    expect(() => syncApi.validateCrmSyncBatch({
      sourceKey: "Google Sheets",
      scopeKey: "scope",
      requestKey: "1b7e0e34-4e13-4f05-b8fd-3c3c3ebd8d17",
      rows: [],
    })).toThrow("source key");
  });

  it("reports only aggregate counts and allowlisted review codes", () => {
    expect(syncApi.safeCrmSyncSummary({
      accepted: 1,
      replayed: 0,
      quarantined: 1,
      review_codes: ["invalid_phone", "invalid_phone", "unknown_code"],
      payload: { phone: "never expose" },
    })).toEqual({
      accepted: 1,
      replayed: 0,
      quarantined: 1,
      reviewCodes: ["invalid_phone"],
    });
  });
});
