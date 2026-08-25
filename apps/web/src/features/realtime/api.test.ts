import { afterEach, describe, expect, it, vi } from "vitest";

const realtimeMocks = vi.hoisted(() => {
  const channel = { on: vi.fn(), subscribe: vi.fn() };
  channel.on.mockReturnValue(channel);
  channel.subscribe.mockReturnValue(channel);
  return { channel, removeChannel: vi.fn().mockResolvedValue("ok"), supabaseChannel: vi.fn(() => channel) };
});

vi.mock("@jewelos/api-client", () => ({
  supabase: { channel: realtimeMocks.supabaseChannel, removeChannel: realtimeMocks.removeChannel },
}));

import { subscribeToTenantRealtime } from "./api";

afterEach(() => {
  vi.useRealTimers();
  realtimeMocks.channel.on.mockClear();
  realtimeMocks.channel.subscribe.mockClear();
  realtimeMocks.removeChannel.mockClear();
  realtimeMocks.supabaseChannel.mockClear();
});

describe("subscribeToTenantRealtime", () => {
  it("shares one tenant channel and notifies only matching topics", () => {
    vi.useFakeTimers();
    const tasksListener = vi.fn();
    const crmListener = vi.fn();
    const stopTasks = subscribeToTenantRealtime("tenant-1", ["tasks"], tasksListener);
    const stopCrm = subscribeToTenantRealtime("tenant-1", ["crm"], crmListener);

    expect(realtimeMocks.supabaseChannel).toHaveBeenCalledTimes(1);
    const callback = realtimeMocks.channel.on.mock.calls[0]?.[2] as (payload: { new: { topic: string } }) => void;
    callback({ new: { topic: "tasks" } });
    expect(tasksListener).toHaveBeenCalledTimes(1);
    expect(crmListener).not.toHaveBeenCalled();

    stopTasks();
    stopCrm();
    vi.runAllTimers();
    expect(realtimeMocks.removeChannel).toHaveBeenCalledWith(realtimeMocks.channel);
  });
});
