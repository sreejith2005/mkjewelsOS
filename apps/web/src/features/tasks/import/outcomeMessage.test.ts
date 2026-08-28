import { describe, expect, it } from "vitest";
import { taskImportOutcomeMessage } from "./outcomeMessage";

describe("task import outcome message", () => {
  it("shows rejected database rows as an error instead of claiming they are Assigning Left", () => {
    expect(taskImportOutcomeMessage({ created: 0, replayed: 0, rejected: 1932, assigningLeft: 1129 })).toEqual({
      tone: "danger",
      text: "No records were imported. 1,932 rows were rejected by the database. You can retry this same file after correcting the problem.",
    });
  });

  it("reports the server-derived Assigning Left count for a successful import", () => {
    expect(taskImportOutcomeMessage({ created: 1932, replayed: 0, rejected: 0, assigningLeft: 1129 })).toEqual({
      tone: "success",
      text: "1,932 new records imported. 1,129 of them still need an assignee and are waiting in Assigning Left.",
    });
  });

  it("omits the Assigning Left sentence when every imported record was assigned", () => {
    expect(taskImportOutcomeMessage({ created: 803, replayed: 12, rejected: 0, assigningLeft: 0 })).toEqual({
      tone: "success",
      text: "803 new records imported. 12 existing records were skipped.",
    });
  });

  it("never claims new work when a re-uploaded file only replays existing records", () => {
    expect(taskImportOutcomeMessage({ created: 0, replayed: 1932, rejected: 0, assigningLeft: 0 })).toEqual({
      tone: "success",
      text: "This file was already imported. 1,932 existing records were skipped and no duplicates were created.",
    });
  });
});
