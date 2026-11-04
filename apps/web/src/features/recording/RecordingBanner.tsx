import { useEffect, useRef, useSyncExternalStore } from "react";
import { renewRecordingTicket } from "@jewelos/data";
import { browserRecorder } from "./browserRecorder";
import { nativeRecorderAvailable, sendNativeRecorder, useNativeCapture } from "./nativeCapture";

/** Always visible across routes; capture belongs to the signed-in shell, not a page mount. */
export function RecordingBanner({ employeeId, onOpen }: { employeeId: string; onOpen: () => void }) {
  const recorder = browserRecorder(employeeId);
  const browser = useSyncExternalStore(recorder.subscribe, recorder.snapshot);
  const native = useNativeCapture();
  const latestNative = useRef(native); latestNative.current = native;
  const isNative = nativeRecorderAvailable();
  useEffect(() => {
    if (isNative) { sendNativeRecorder("recorder.status"); const timer = setInterval(() => sendNativeRecorder("recorder.status"), 1000); return () => clearInterval(timer); }
    void recorder.initialize();
    const beforeUnload = (event: BeforeUnloadEvent) => { const state = recorder.snapshot().state; if (["recording", "paused", "saving", "needs_attention"].includes(state)) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", beforeUnload);
    return () => { window.removeEventListener("beforeunload", beforeUnload); void recorder.suspend(); };
  }, [isNative, recorder]);
  // Native capture also stops on logout, while its encrypted upload queue remains recoverable.
  useEffect(() => () => { const last = latestNative.current; if (isNative && last.sessionId && last.state === "recording") sendNativeRecorder("recorder.pause", last.sessionId); }, [employeeId, isNative]);
  useEffect(() => {
    if (!isNative || !native.sessionId || ["idle", "processing"].includes(native.state)) return;
    const session = native.session;
    if (!session || session.employee_id !== employeeId || session.id !== native.sessionId) return;
    let cancelled = false; let pending = false;
    const renew = async () => {
      if (pending) return; pending = true;
      try { const ticket = await renewRecordingTicket(session); if (!cancelled) sendNativeRecorder("recorder.start", undefined, ticket); }
      catch { /* Native exposes ticket_required and retains the encrypted queue. */ }
      finally { pending = false; }
    };
    void renew(); const timer = setInterval(() => { void renew(); }, 45_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [employeeId, isNative, native.sessionId, native.state]);
  const state = isNative ? native.state : browser.state;
  if (!["recording", "paused", "saving", "needs_attention"].includes(state)) return null;
  return <button className={`sticky top-0 z-30 flex min-h-11 w-full items-center justify-center gap-2 px-4 py-2 text-sm font-semibold ${state === "recording" ? "bg-danger text-white" : "border-b border-warning bg-task-muted text-task-text"}`} onClick={onOpen} type="button">
    {state === "recording" ? <span aria-hidden className="size-2 animate-pulse rounded-full bg-white" /> : null}
    {state === "recording" ? "Recording" : state === "saving" ? "Saving recording" : state === "paused" ? "Recording paused" : "Recording needs attention"} · Open recorder
  </button>;
}
