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

import { subscribeToInbox } from "./api";

afterEach(() => {
  vi.useRealTimers();
  realtimeMocks.channel.on.mockClear();
  realtimeMocks.channel.subscribe.mockClear();
  realtimeMocks.removeChannel.mockClear();
  realtimeMocks.supabaseChannel.mockClear();
});

describe("subscribeToInbox", () => {
  it("reuses a configured channel across a Strict Mode effect remount", () => {
    vi.useFakeTimers();
    const firstRefresh = vi.fn();
    const secondRefresh = vi.fn();

    const firstCleanup = subscribeToInbox("profile-1", firstRefresh);
    firstCleanup();
    const secondCleanup = subscribeToInbox("profile-1", secondRefresh);

    expect(realtimeMocks.supabaseChannel).toHaveBeenCalledTimes(1);
    expect(realtimeMocks.channel.on).toHaveBeenCalledTimes(1);
    const callback = realtimeMocks.channel.on.mock.calls[0]?.[2] as () => void;
    callback();
    expect(firstRefresh).not.toHaveBeenCalled();
    expect(secondRefresh).toHaveBeenCalledTimes(1);

    secondCleanup();
    vi.runAllTimers();
    expect(realtimeMocks.removeChannel).toHaveBeenCalledWith(realtimeMocks.channel);
  });
});
