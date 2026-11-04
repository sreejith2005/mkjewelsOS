import { describe, expect, it } from "vitest";
import { isRecorderBridgeAuthorized, parseWebShellMessage, webShellInjectedScript } from "./webShellBridge";
import vm from "node:vm";
const id = "11111111-1111-4111-8111-111111111111";
const start = { ns: "jewelos-shell/1", kind: "recorder.start", requestId: "request-1", session: { id, tenant_id: id, branch_id: id, employee_id: id, device_id: id }, ticket: "opaque-ticket", expires_at: new Date(Date.now()+60000).toISOString(), upload_url: "https://ingest.example", stream_url: "wss://ingest.example/v1/stream" };
describe("recorder bridge", () => {
 it("rejects fallback iframe messages without the unpredictable shell nonce", () => {
  const nonce = "a".repeat(64);
  expect(isRecorderBridgeAuthorized(JSON.stringify(start), nonce)).toBe(false);
  expect(isRecorderBridgeAuthorized(JSON.stringify({...start,bridgeNonce:"b".repeat(64)}), nonce)).toBe(false);
  expect(isRecorderBridgeAuthorized(JSON.stringify({...start,bridgeNonce:nonce}), null)).toBe(false);
  expect(isRecorderBridgeAuthorized(JSON.stringify({...start,bridgeNonce:nonce}), nonce)).toBe(true);
 });
 it("never injects recorder capability into a subframe and leaves old modules unadvertised", () => {
  const nonce = "a".repeat(64);
  const frame: Record<string, unknown> = {}; frame.top = {};
  vm.runInNewContext(webShellInjectedScript(nonce), {window:frame});
  expect(frame.__jewelosRecorderBridgeNonce).toBeUndefined();
  expect(frame.__jewelosRecorderVersion).toBeUndefined();
  expect(webShellInjectedScript()).not.toContain("__jewelosRecorderVersion = 1");
 });
 it("advertises the native capability only to the top frame with a valid nonce", () => {
  const nonce = "a".repeat(64);
  for (const token of [nonce, undefined]) {
   const frame: Record<string, unknown> = {addEventListener() {}}; frame.top = frame;
   vm.runInNewContext(webShellInjectedScript(token), {window:frame, URL,
    HTMLAnchorElement: class { click() {} }, MutationObserver: class { observe() {} },
    document:{documentElement:{},readyState:"loading",addEventListener() {}},
    history:{pushState() {},replaceState() {}},setTimeout() {}});
   expect(frame.__jewelosRecorderBridgeNonce).toBe(token);
   expect(frame.__jewelosRecorderVersion).toBe(token ? 1 : undefined);
  }
 });
 it("accepts scoped start and unknown-session recovery status", () => {
  expect(parseWebShellMessage(JSON.stringify(start))?.kind).toBe("recorder.start");
  expect(parseWebShellMessage(JSON.stringify({ns:start.ns,kind:"recorder.status",requestId:"reload"}))).toEqual({kind:"recorder.status",requestId:"reload"});
 });
 it("rejects cleartext, credentials, unbound identities and malformed commands", () => {
  for (const change of [{upload_url:"http://ingest.example"},{upload_url:"https://user:pass@ingest.example"},{session:{...start.session,tenant_id:""}},{ticket:""},{expires_at:"invalid"}]) expect(parseWebShellMessage(JSON.stringify({...start,...change}))).toBeNull();
  expect(parseWebShellMessage(JSON.stringify({ns:start.ns,kind:"recorder.stop",requestId:"x"}))).toBeNull();
 });
});
