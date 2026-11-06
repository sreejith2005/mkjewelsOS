import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RecordingSession } from "@jewelos/core";
import { controlRecordingSession, linkRecordingWalkin, listRecordingSessions, recordingSnapshot, renewRecordingTicket, startRecordingSession } from "@jewelos/data";
import { browserRecorder, webCaptureSupported } from "./browserRecorder";
import { isJewelOSWebShell, nativeRecorderAvailable, sendNativeRecorder, useNativeCapture } from "./nativeCapture";

export type RecorderState = "idle" | "recording" | "paused" | "saving" | "processing" | "ready" | "needs_attention";
export type RecorderControl = Readonly<{
  state: RecorderState; elapsedMs: number; level: number; queuedBytes: number; network: string; captureError: string | null;
  activeId: string | null; isNative: boolean; inAppWithoutNative: boolean; supported: boolean; canControl: boolean; busy: boolean; error: string | null;
  linkNotice: string | null;
  start: (walkinRef?: string) => Promise<string | null>; control: (action: "pause" | "resume" | "stop") => Promise<void>; retry: () => Promise<void>;
}>;

function deviceId(): string {
  let id = localStorage.getItem("jewelos-recorder-device-v1");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("jewelos-recorder-device-v1", id); } return id;
}

/**
 * The microphone controls, shared by every screen that records. Identity always
 * comes from the signed-in profile; the server owns session state. "processing"
 * is reached only after the server acknowledges the final upload.
 */
export function useRecorder(profileId: string | undefined): RecorderControl {
  const recorder = browserRecorder(profileId ?? "signed-out");
  const browser = useSyncExternalStore(recorder.subscribe, recorder.snapshot);
  const native = useNativeCapture(); const isNative = nativeRecorderAvailable();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkNotice, setLinkNotice] = useState<string | null>(null);
  const [completed, setCompleted] = useState<{ id: string; status: string } | null>(null);
  const requestId = useRef<string | null>(null);
  const activeId = (isNative ? native.sessionId : browser.session?.id) ?? null;
  const capture = isNative ? native : browser;

  // After the final upload, follow the server until the conversation is ready.
  useEffect(() => {
    if (!activeId || capture.state !== "processing") return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await recordingSnapshot(activeId);
        if (!cancelled && ["ready", "needs_attention"].includes(next.session.status)) { setCompleted({ id: activeId, status: next.session.status }); return; }
      } catch { /* Keep showing Processing while reconnecting to the server's state. */ }
      if (!cancelled) timer = setTimeout(() => { void load(); }, 3000);
    };
    void load(); return () => { cancelled = true; clearTimeout(timer); };
  }, [activeId, capture.state]);

  const [ownNative, setOwnNative] = useState<RecordingSession | null>(null);
  useEffect(() => {
    if (!isNative || !native.sessionId) { setOwnNative(null); return; }
    if (native.session?.employee_id === profileId) { setOwnNative(native.session); return; }
    let active = true;
    void listRecordingSessions().then((sessions) => { if (active) setOwnNative(sessions.find((item) => item.id === native.sessionId && item.employee_id === profileId) ?? null); }).catch(() => undefined);
    return () => { active = false; };
  }, [isNative, native.session, native.sessionId, profileId]);

  const state = (capture.state === "processing" && completed && completed.id === activeId ? completed.status : capture.state) as RecorderState;
  const canControl = isNative ? Boolean(ownNative) : browser.session?.employee_id === profileId;

  const run = useCallback(async (action: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError(null);
    try { await action(); }
    catch { setError("That did not finish. Your recording and any audio waiting to upload are kept. Check your connection and microphone permission, then try again."); }
    finally { setBusy(false); }
  }, [busy]);

  const start = async (walkinRef?: string): Promise<string | null> => {
    let started: string | null = null;
    setLinkNotice(null);
    await run(async () => {
      const device = deviceId();
      const pendingKey = `jewelos-recorder-start:${profileId}:${device}`;
      requestId.current ??= localStorage.getItem(pendingKey) ?? crypto.randomUUID();
      localStorage.setItem(pendingKey, requestId.current);
      const sessions = await listRecordingSessions();
      const existing = sessions.find((item) => item.employee_id === profileId && item.device_id === device && !item.capture_ended_at && ["recording", "paused", "needs_attention"].includes(item.status));
      const ticket = existing ? await renewRecordingTicket(existing) : await startRecordingSession(device, requestId.current);
      // Once identity is known, recovery uses this durable session. An unknown outcome
      // keeps the request id across reload so a retry cannot create a second session.
      localStorage.removeItem(pendingKey); requestId.current = null;
      setCompleted(null);
      if (isNative) sendNativeRecorder("recorder.start", undefined, ticket); else await recorder.start(ticket);
      started = ticket.session.id;
      if (walkinRef) {
        try { await linkRecordingWalkin(ticket.session.id, walkinRef); setLinkNotice("Linked to the CRM walk-in."); }
        catch { setLinkNotice("Recording started, but the CRM walk-in could not be linked. You can link it later from the conversation."); }
      }
    });
    return started;
  };

  const control = (action: "pause" | "resume" | "stop") => run(async () => {
    if (!activeId || !canControl) throw new Error("not_owned");
    if (isNative) {
      if (action === "resume") {
        // Authorize before asking the phone to reopen the microphone.
        await controlRecordingSession(activeId, "resume");
        if (!ownNative) throw new Error("missing_session");
        sendNativeRecorder("recorder.start", undefined, await renewRecordingTicket(ownNative));
      }
      sendNativeRecorder(`recorder.${action}`, activeId);
      if (action === "pause") await controlRecordingSession(activeId, action);
    } else await recorder[action]();
  });

  const retry = () => run(async () => {
    if (isNative && ownNative) sendNativeRecorder("recorder.start", undefined, await renewRecordingTicket(ownNative)); else await recorder.retry();
  });

  return {
    state, elapsedMs: capture.elapsedMs, level: capture.level, queuedBytes: capture.queuedBytes, network: capture.network, captureError: capture.error,
    activeId, isNative, inAppWithoutNative: isJewelOSWebShell() && !isNative, supported: isNative || webCaptureSupported(), canControl, busy, error, linkNotice,
    start, control, retry,
  };
}
