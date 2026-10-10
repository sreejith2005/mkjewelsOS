import { describe, expect, it } from "vitest";
import { readAllFmsRows } from "./visitHistory";
describe("FMS visit history", () => {
  it("retains over a thousand visits including the latest open work", async () => {
    const rows = Array.from({ length: 1203 }, (_, id) => ({ id, status: id === 1202 ? "in_progress" : "completed" }));
    const result = await readAllFmsRows((from, to) => Promise.resolve({ data: rows.slice(from, to + 1), error: null }));
    expect(result).toEqual(rows);
    expect(result.at(-1)!.status).toBe("in_progress");
  });
  it("reports a later-page error instead of silently returning partial history", async () => {
    await expect(readAllFmsRows((from) => Promise.resolve(from === 0 ? { data: Array.from({ length: 500 }, (_, id) => id), error: null } : { data: null, error: { message: "access denied" } }))).rejects.toThrow("access denied");
  });
});
