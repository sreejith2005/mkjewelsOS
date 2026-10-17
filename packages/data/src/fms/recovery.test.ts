import { beforeEach, expect, it, vi } from "vitest";
const rpc = vi.hoisted(() => vi.fn());
vi.mock("@jewelos/api-client/client", () => ({ getSupabase: () => ({ rpc, auth: { getSession: async () => ({ error: null, data: { session: { user: { id: "actor" } } } }) } }) }));
import { beginNewFmsStartingFlow, recoverFmsStartingFlow } from "./work";
import { getFmsMutationIdentity, setFmsMutationStorage } from "./mutationIdentity";
import { setUuidFactory } from "../runtime";
const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
beforeEach(() => {
  values.clear(); rpc.mockReset(); setFmsMutationStorage(storage);
  let serial = 0; setUuidFactory(() => `00000000-0000-4000-8000-${String(++serial).padStart(12, "0")}`);
});
it("allows an explicit new submission after recovering a lost successful response", async () => {
  const old = await getFmsMutationIdentity(storage, "actor", "flow_form", "flow");
  rpc.mockResolvedValue({ error: null, data: { state: "workflow_completed", instanceId: "instance", referenceNumber: "FMS-1", submissionId: "submission", sourceInstanceStageId: null, destinations: [], ownWorkTargets: [] } });
  expect(await recoverFmsStartingFlow("flow")).toMatchObject({ instanceId: "instance" });
  await expect(beginNewFmsStartingFlow("flow")).resolves.toBeUndefined();
  expect(await getFmsMutationIdentity(storage, "actor", "flow_form", "flow")).not.toBe(old);
});
it("keeps an unfinished identity when there is no saved server result", async () => {
  const old = await getFmsMutationIdentity(storage, "actor", "flow_form", "flow");
  rpc.mockResolvedValue({ error: null, data: null });
  expect(await recoverFmsStartingFlow("flow")).toBeNull();
  await expect(beginNewFmsStartingFlow("flow")).rejects.toThrow();
  expect(await getFmsMutationIdentity(storage, "actor", "flow_form", "flow")).toBe(old);
});
