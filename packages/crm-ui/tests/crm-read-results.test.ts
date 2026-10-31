import { expect, it } from "vitest";
import { readCrmResults } from "@/crm-port/read-results";

it("propagates Supabase error responses instead of presenting an empty successful read", async () => {
  const error = { message: "TypeError: Failed to fetch", code: "", details: "", hint: "" };
  await expect(readCrmResults([Promise.resolve({ data: null, error })])).rejects.toBe(error);
});
it("keeps successful empty reads and the original single-row missing response", async () => {
  const missing = { data: null, error: { code: "PGRST116", message: "No rows" } };
  const empty = { data: [], error: null };
  expect(await readCrmResults([Promise.resolve(missing), Promise.resolve(empty)])).toEqual([missing, empty]);
});
it("propagates authorization failures without turning them into an empty page", async () => {
  const error = { code: "42501", message: "Denied" };
  await expect(readCrmResults([Promise.resolve({ data: null, error })])).rejects.toBe(error);
});
