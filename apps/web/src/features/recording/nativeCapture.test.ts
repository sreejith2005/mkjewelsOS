// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { nativeRecorderAvailable, sendNativeRecorder, useNativeCapture } from "./nativeCapture";
afterEach(() => { cleanup(); vi.restoreAllMocks(); for (const key of ["ReactNativeWebView", "__jewelosRecorderBridgeNonce", "__jewelosRecorderVersion"]) Reflect.deleteProperty(window, key); });
function shell() {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("JewelOSApp/1");
  const postMessage = vi.fn(); Object.defineProperty(window, "ReactNativeWebView", { configurable: true, value: { postMessage } }); return postMessage;
}
it("does not assume an older WebView shell contains the native recorder", () => {
  const post = shell(); expect(nativeRecorderAvailable()).toBe(false);
  expect(() => sendNativeRecorder("recorder.status")).toThrow("native_recorder_unavailable"); expect(post).not.toHaveBeenCalled();
});
it("requires the main-frame capability and sends its nonce without browser JWT", () => {
  const post = shell(); const nonce = "a".repeat(64);
  Object.defineProperty(window, "__jewelosRecorderVersion", { configurable: true, value: 1 });
  Object.defineProperty(window, "__jewelosRecorderBridgeNonce", { configurable: true, value: nonce });
  expect(nativeRecorderAvailable()).toBe(true); sendNativeRecorder("recorder.status");
  const value = JSON.parse(post.mock.calls[0]![0]); expect(value).toMatchObject({ ns: "jewelos-shell/1", kind: "recorder.status", bridgeNonce: nonce });
  expect(value).not.toHaveProperty("access_token"); expect(value).not.toHaveProperty("authorization");
});
it("treats an empty native error as healthy and preserves truthful upload credential state", () => {
  const hook = renderHook(useNativeCapture);
  act(() => window.dispatchEvent(new CustomEvent("jewelos-recorder", { detail: { kind: "recorder.status", state: "paused", sessionId: null, network: "ticket_required", queuedBytes: 1024, error: "" } })));
  expect(hook.result.current.error).toBeNull(); expect(hook.result.current.network).toBe("ticket_required"); expect(hook.result.current.queuedBytes).toBe(1024);
});
