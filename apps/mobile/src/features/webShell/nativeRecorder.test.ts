import { afterEach, describe, expect, it, vi } from "vitest";
const registry = vi.hoisted(() => ({ JewelOSRecorder: undefined as unknown }));
vi.mock("react-native", () => ({ NativeModules: registry, NativeEventEmitter: vi.fn(), PermissionsAndroid: {}, Platform: {} }));
afterEach(() => { registry.JewelOSRecorder = undefined; vi.resetModules(); });
describe("native recorder capability", () => {
 it("leaves shells without a native module usable without recorder capability", async () => {
  expect(await (await import("./nativeRecorder")).recorderBridgeToken()).toBeNull();
 });
 it("leaves old native modules without bridgeToken unadvertised", async () => {
  registry.JewelOSRecorder = {command: vi.fn(), addListener: vi.fn(), removeListeners: vi.fn()};
  expect(await (await import("./nativeRecorder")).recorderBridgeToken()).toBeNull();
 });
 it("accepts only a native generated 256-bit token", async () => {
  const bridgeToken = vi.fn().mockResolvedValueOnce("a".repeat(64)).mockResolvedValueOnce("predictable").mockRejectedValueOnce(new Error("unavailable"));
  registry.JewelOSRecorder = {command: vi.fn(), bridgeToken, addListener: vi.fn(), removeListeners: vi.fn()};
  const recorder = await import("./nativeRecorder");
  expect(await recorder.recorderBridgeToken()).toBe("a".repeat(64));
  expect(await recorder.recorderBridgeToken()).toBeNull();
  expect(await recorder.recorderBridgeToken()).toBeNull();
 });
});