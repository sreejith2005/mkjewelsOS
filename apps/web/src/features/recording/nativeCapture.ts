import { useSyncExternalStore } from "react";
import { parseRecordingSession, type RecordingSession, type RecordingTicket } from "@jewelos/core";

export type NativeCaptureView = Readonly<{ sessionId: string | null; session: RecordingSession | null; state: string; network: string; queuedBytes: number; elapsedMs: number; level: number; error: string | null }>;
let view: NativeCaptureView = { sessionId: null, session: null, state: "idle", network: "connected", queuedBytes: 0, elapsedMs: 0, level: 0, error: null };
const listeners = new Set<() => void>();
type ShellWindow = Window & { ReactNativeWebView?: { postMessage: (message: string) => void }; __jewelosRecorderBridgeNonce?: unknown; __jewelosRecorderVersion?: unknown };
export function isJewelOSWebShell(): boolean { return /JewelOSApp\/1/.test(navigator.userAgent); }
export function nativeRecorderAvailable(): boolean {
  const shell = window as ShellWindow;
  return isJewelOSWebShell() && shell.__jewelosRecorderVersion === 1 && typeof shell.__jewelosRecorderBridgeNonce === "string"
    && /^[0-9a-f]{64}$/.test(shell.__jewelosRecorderBridgeNonce) && typeof shell.ReactNativeWebView?.postMessage === "function";
}
export function sendNativeRecorder(kind: "recorder.start" | "recorder.pause" | "recorder.resume" | "recorder.stop" | "recorder.status", sessionId?: string, ticket?: RecordingTicket): void {
  const shell = (window as ShellWindow).ReactNativeWebView;
  if (!shell || !nativeRecorderAvailable()) throw new Error("native_recorder_unavailable");
  shell.postMessage(JSON.stringify({ ns: "jewelos-shell/1", bridgeNonce: (window as ShellWindow).__jewelosRecorderBridgeNonce, kind, requestId: crypto.randomUUID(),
    ...(sessionId ? { sessionId } : {}), ...(ticket ? { session: ticket.session, ticket: ticket.ticket, expires_at: ticket.expires_at, upload_url: ticket.upload_url, stream_url: ticket.stream_url } : {}) }));
}
function event(event: Event) {
  if (!(event instanceof CustomEvent) || !event.detail || typeof event.detail !== "object") return;
  const value = event.detail as Record<string, unknown>;
  if (value.kind !== "recorder.status" && value.kind !== "recorder.error") return;
  if (typeof value.state !== "string" || !["idle", "recording", "paused", "saving", "processing", "needs_attention"].includes(value.state)) return;
  const metric = (raw: unknown, maximum: number) => typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= maximum ? raw : 0;
  let session = value.sessionId === null ? null : view.session;
  if (value.session) { try { session = parseRecordingSession(value.session); } catch { return; } }
  view = { sessionId: typeof value.sessionId === "string" ? value.sessionId : value.sessionId === null ? null : view.sessionId, session, state: value.state,
    network: typeof value.network === "string" && ["connected", "uploading", "offline", "ticket_required"].includes(value.network) ? value.network : "connected",
    queuedBytes: metric(value.queuedBytes, 70 * 1024 * 1024), elapsedMs: metric(value.elapsedMs, 4 * 60 * 60 * 1000 + 10_000), level: metric(value.level, 1),
    error: value.kind === "recorder.error" || (typeof value.error === "string" && value.error.length > 0) ? "The recorder needs attention. Reconnect or allow microphone access, then retry this session." : null };
  listeners.forEach((listener) => listener());
}
function subscribe(listener: () => void) {
  if (!listeners.size) window.addEventListener("jewelos-recorder", event);
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener("jewelos-recorder", event); };
}
export function useNativeCapture(): NativeCaptureView { return useSyncExternalStore(subscribe, () => view); }
