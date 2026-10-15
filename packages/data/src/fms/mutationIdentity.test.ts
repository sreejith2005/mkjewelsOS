import { describe, expect, it } from "vitest";
import { getFmsMutationIdentity, markFmsMutationComplete, beginNewFmsMutation } from "./mutationIdentity";
import { setUuidFactory } from "../runtime";

function store() {
  const values = new Map<string, string>();
  return { getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => { values.set(key, value); },
    removeItem: async (key: string) => { values.delete(key); }, values };
}
describe("FMS durable retry identity", () => {
  it("reuses the request identity after remount and completion for lost-response recovery", async () => {
    let n = 0; setUuidFactory(() => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
    const storage = store();
    const key = await getFmsMutationIdentity(storage, "employee", "stage_form", "visit");
    expect(await getFmsMutationIdentity(storage, "employee", "stage_form", "visit")).toBe(key);
    await markFmsMutationComplete(storage, "employee", "stage_form", "visit");
    expect(await getFmsMutationIdentity(storage, "employee", "stage_form", "visit")).toBe(key);
    expect([...storage.values.values()].join()).not.toContain("answers");
  });
  it("isolates users, stages and operation kinds", async () => {
    let n = 0; setUuidFactory(() => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
    const storage = store();
    const keys = await Promise.all([
      getFmsMutationIdentity(storage, "a", "stage_form", "visit"),
      getFmsMutationIdentity(storage, "b", "stage_form", "visit"),
      getFmsMutationIdentity(storage, "a", "complete", "visit"),
      getFmsMutationIdentity(storage, "a", "stage_form", "other"),
    ]);
    expect(new Set(keys).size).toBe(4);
  });
  it("rotates only on an explicit new submission", async () => {
    let n = 0; setUuidFactory(() => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
    const storage = store();
    const old = await getFmsMutationIdentity(storage, "a", "flow_form", "flow");
    await markFmsMutationComplete(storage, "a", "flow_form", "flow");
    await beginNewFmsMutation(storage, "a", "flow_form", "flow");
    expect(await getFmsMutationIdentity(storage, "a", "flow_form", "flow")).not.toBe(old);
  });
  it("serializes simultaneous requests for the same unfinished operation", async () => {
    let n = 0; setUuidFactory(() => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
    const storage = store();
    const [one, two] = await Promise.all([getFmsMutationIdentity(storage, "a", "stage_form", "visit"), getFmsMutationIdentity(storage, "a", "stage_form", "visit")]);
    expect(one).toBe(two);
  });
});
