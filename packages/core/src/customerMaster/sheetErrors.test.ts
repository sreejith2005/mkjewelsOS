import { describe, expect, it } from "vitest";
import { describeSheetSyncError } from "./sheetErrors";

describe("describeSheetSyncError", () => {
  it("explains a stopped removal with the count", () => {
    expect(describeSheetSyncError("too_many_rows_missing:1234").problem).toContain("1,234 rows");
  });
  it("names the missing tab and columns", () => {
    expect(describeSheetSyncError("sheet_tab_not_found:AHEMDABAD list").problem).toContain('"AHEMDABAD list"');
    expect(describeSheetSyncError("key_column_missing:Mobile, A/c Name").problem).toContain("Mobile, A/c Name");
  });
  it("covers sharing, timeouts, Google errors and database saves", () => {
    expect(describeSheetSyncError("sheet_not_shared").fix).toContain("Share");
    expect(describeSheetSyncError("sheet_read_timeout_row_40001").problem).toContain("row 40001");
    expect(describeSheetSyncError("sheet_read_failed_503").problem).toContain("503");
    expect(describeSheetSyncError("finish_failed_57014").problem).toContain("took too long");
  });
  it("never hides an unknown code", () => {
    expect(describeSheetSyncError("sync_failed_typeerror").problem).toContain("sync_failed_typeerror");
    expect(describeSheetSyncError(null).problem).toContain("unknown");
  });
});
