import { afterEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@jewelos/api-client/client", () => ({ getSupabase: () => mock }));
import { invalidateMasterOptions, loadMasterOptions } from "./api";
const result = (label: string, error: { message: string } | null = null) => {
  const query = { data: [{ id: "option", master_type: "metal", value: "gold", label, sort_order: 0, is_active: true }], error,
    select: vi.fn(), eq: vi.fn(), order: vi.fn(), in: vi.fn() };
  for (const method of [query.select, query.eq, query.order, query.in]) method.mockReturnValue(query);
  return query;
};
afterEach(() => { invalidateMasterOptions(); vi.resetAllMocks(); });
describe("master option refresh", () => {
  it("reloads committed remote changes after a completed read", async () => {
    mock.from.mockReturnValueOnce(result("Gold")).mockReturnValueOnce(result("Renamed gold"));
    expect((await loadMasterOptions(["metal"]))[0]?.label).toBe("Gold");
    expect((await loadMasterOptions(["metal"]))[0]?.label).toBe("Renamed gold");
  });
  it("retries after an unsuccessful read", async () => {
    mock.from.mockReturnValueOnce(result("Gold", { message: "Disconnected" })).mockReturnValueOnce(result("Gold"));
    await expect(loadMasterOptions(["metal"])).rejects.toThrow("Disconnected");
    await expect(loadMasterOptions(["metal"])).resolves.toHaveLength(1);
  });
  it("keeps a new identity's pending request when an invalidated request finishes", async () => {
    let finishFirst: (() => void) | undefined;
    let finishSecond: (() => void) | undefined;
    const firstResult = result("Old scope");
    const secondResult = result("New scope");
    type Reply = { data: typeof firstResult.data; error: null };
    const first = new Promise<Reply>((resolve) => { finishFirst = () => resolve({ data: firstResult.data, error: null }); });
    const second = new Promise<Reply>((resolve) => { finishSecond = () => resolve({ data: secondResult.data, error: null }); });
    mock.from.mockReturnValueOnce(Object.assign(firstResult, { then: first.then.bind(first) })).mockReturnValueOnce(Object.assign(secondResult, { then: second.then.bind(second) }));
    const oldRequest = loadMasterOptions(["metal"]);
    invalidateMasterOptions();
    const newRequest = loadMasterOptions(["metal"]);
    finishFirst?.(); await oldRequest;
    expect(loadMasterOptions(["metal"])).toBe(newRequest);
    expect(mock.from).toHaveBeenCalledTimes(2);
    finishSecond?.(); await expect(newRequest).resolves.toEqual(secondResult.data);
  });
});
