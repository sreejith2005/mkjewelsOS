import { expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  appListener: undefined as ((state: string) => void) | undefined,
  networkListener: undefined as ((state: { isConnected: boolean; isInternetReachable: boolean }) => void) | undefined,
  removeApp: vi.fn(), removeNetwork: vi.fn(),
  addApp: vi.fn(), addNetwork: vi.fn(),
}));
vi.mock("react-native", () => ({ AppState: { currentState: "active", addEventListener: native.addApp } }));
vi.mock("@react-native-community/netinfo", () => ({ default: { addEventListener: native.addNetwork } }));
vi.mock("@react-navigation/native", () => ({ useNavigation: vi.fn() }));

it("shares OS listeners, reports background and reconnect, and releases them after the last observer", async () => {
  native.addApp.mockImplementation((_event: string, listener: typeof native.appListener) => { native.appListener = listener; return { remove: native.removeApp }; });
  native.addNetwork.mockImplementation((listener: typeof native.networkListener) => { native.networkListener = listener; return native.removeNetwork; });
  const { subscribeAppAvailability } = await import("./useTenantRealtimeRefresh");
  const first = vi.fn(); const second = vi.fn();
  const stopFirst = subscribeAppAvailability(first);
  const stopSecond = subscribeAppAvailability(second);
  expect(native.addApp).toHaveBeenCalledTimes(1);
  expect(native.addNetwork).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenLastCalledWith(true);
  native.appListener?.("background");
  expect(second).toHaveBeenLastCalledWith(false);
  native.networkListener?.({ isConnected: false, isInternetReachable: false });
  native.appListener?.("active");
  expect(second).toHaveBeenLastCalledWith(false);
  native.networkListener?.({ isConnected: true, isInternetReachable: true });
  expect(second).toHaveBeenLastCalledWith(true);
  stopFirst();
  expect(native.removeApp).not.toHaveBeenCalled();
  first.mockClear();
  native.appListener?.("background");
  expect(first).not.toHaveBeenCalled();
  stopSecond();
  expect(native.removeApp).toHaveBeenCalledTimes(1);
  expect(native.removeNetwork).toHaveBeenCalledTimes(1);
});
