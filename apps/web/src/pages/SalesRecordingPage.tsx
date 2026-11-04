import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { hasPermission, reconcileTranscript, type RecordingSession, type RecordingSnapshot, type TranscriptSegment } from "@jewelos/core";
import { controlRecordingSession, listRecordingSessions, recordingSnapshot, renewRecordingTicket, startRecordingSession, recordingWalkins, linkRecordingWalkin } from "@jewelos/data";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { browserRecorder, webCaptureSupported } from "@/features/recording/browserRecorder";
import { isJewelOSWebShell, nativeRecorderAvailable, sendNativeRecorder, useNativeCapture } from "@/features/recording/nativeCapture";

const labels: Readonly<Record<string, string>> = { idle: "Not recording", recording: "Recording", paused: "Paused", saving: "Saving", processing: "Processing", ready: "Ready", needs_attention: "Needs attention" };
function duration(ms: number) { const seconds = Math.floor(ms / 1000); return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`; }
function deviceId(): string {
  let id = localStorage.getItem("jewelos-recorder-device-v1");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("jewelos-recorder-device-v1", id); } return id;
}
export function SalesRecordingPage() {
  const { profile, access } = useAuth();
  const recorder = browserRecorder(profile?.id ?? "signed-out");
  const browser = useSyncExternalStore(recorder.subscribe, recorder.snapshot);
  const native = useNativeCapture(); const isNative = nativeRecorderAvailable();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<RecordingSession[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<RecordingSnapshot | null>(null);
  const [segments, setSegments] = useState<readonly TranscriptSegment[]>([]);
  const [alerts, setAlerts] = useState(false);
  const [walkins, setWalkins] = useState<ReadonlyArray<{ ref: string; label: string }>>([]);
  const [walkin, setWalkin] = useState("");
  const [linked, setLinked] = useState(false);
  const [completedCapture, setCompletedCapture] = useState<{ id: string; status: string } | null>(null);
  const requestId = useRef<string | null>(null);
  const canCapture = hasPermission(access, "recording.capture");
  const canCoach = hasPermission(access, "recording.coach") && ["super_admin", "admin", "manager"].includes(access?.effectiveRole ?? "");
  const refresh = useCallback(async () => { const next = await listRecordingSessions(); setSessions(next); return next; }, []);
  useEffect(() => { if (hasPermission(access, "crm.view")) void recordingWalkins().then(setWalkins).catch(() => setWalkins([])); }, [access]);
  useEffect(() => { let active = true; void refresh().then((next) => { if (active) setSelected((id) => id ?? next[0]?.id ?? null); }).catch(() => { if (active) setError("The recording pilot is unavailable or you do not have access. No microphone was started."); }); return () => { active = false; }; }, [refresh]);
  const activeId = isNative ? native.sessionId : browser.session?.id;
  const capture = isNative ? native : browser;
  useEffect(() => {
    if (!activeId || capture.state !== "processing") return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await recordingSnapshot(activeId);
        if (!cancelled && ["ready", "needs_attention"].includes(next.session.status)) { setCompletedCapture({ id: activeId, status: next.session.status }); return; }
      } catch { /* Retain Processing while reconnecting to canonical state. */ }
      if (!cancelled) timer = setTimeout(() => { void load(); }, 2000);
    };
    void load(); return () => { cancelled = true; clearTimeout(timer); };
  }, [activeId, capture.state]);
  const selectedId = selected ?? activeId;
  useEffect(() => { setSnapshot(null); setSegments([]); setLinked(false); setWalkin(""); }, [selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try { const next = await recordingSnapshot(selectedId); if (!cancelled) { setSnapshot(next); setSegments((previous) => reconcileTranscript(previous, next.segments)); } }
      catch { if (!cancelled) setError("Live updates are unavailable. Capture and queued audio are kept; reconnect to refresh."); }
      if (!cancelled) timer = setTimeout(() => { void load(); }, document.hidden ? 5000 : 1000);
    };
    void load(); return () => { cancelled = true; clearTimeout(timer); };
  }, [selectedId]);
  const ownNativeSession = native.session?.employee_id === profile?.id ? native.session : sessions.find((item) => item.id === native.sessionId && item.employee_id === profile?.id);
  // History/transcript selection never changes the live microphone controls.
  const state = capture.state === "processing" && completedCapture && completedCapture.id === activeId ? completedCapture.status : capture.state;
  const canControlActive = isNative ? Boolean(ownNativeSession) : browser.session?.employee_id === profile?.id;
  const run = async (action: () => Promise<void>) => { if (busy) return; setBusy(true); setError(null); try { await action(); } catch { setError("The recording action could not finish. Your durable session and queued audio have been kept. Check permission and connection, then retry."); } finally { setBusy(false); } };
  const start = () => run(async () => {
    const device = deviceId();
    const pendingKey = `jewelos-recorder-start:${profile?.id}:${device}`;
    requestId.current ??= localStorage.getItem(pendingKey) ?? crypto.randomUUID();
    localStorage.setItem(pendingKey, requestId.current);
    const existing = sessions.find((item) => item.employee_id === profile?.id && item.device_id === device && !item.capture_ended_at && ["recording", "paused", "needs_attention"].includes(item.status));
    const ticket = existing ? await renewRecordingTicket(existing) : await startRecordingSession(device, requestId.current);
    // Once identity is known, recovery uses this durable session. An unknown RPC
    // outcome keeps the request UUID across reload so retry cannot create another.
    localStorage.removeItem(pendingKey); requestId.current = null;
    setSelected(ticket.session.id); setSessions((previous) => [ticket.session, ...previous.filter((item) => item.id !== ticket.session.id)]);
    if (isNative) sendNativeRecorder("recorder.start", undefined, ticket); else await recorder.start(ticket);
  });
  const control = (action: "pause" | "resume" | "stop") => run(async () => {
    if (!activeId || !canControlActive) throw new Error("not_owned");
    if (isNative) {
      if (action === "resume") {
        // Authorize before asking native to reopen the microphone. Pause/Stop
        // still release hardware first even if the web JWT cannot reach Supabase.
        await controlRecordingSession(activeId, "resume");
        const session = ownNativeSession; if (!session) throw new Error("missing_session");
        sendNativeRecorder("recorder.start", undefined, await renewRecordingTicket(session));
      }
      sendNativeRecorder(`recorder.${action}`, activeId);
      if (action === "pause") await controlRecordingSession(activeId, action);
    } else await recorder[action]();
  });
  const noOpenSession = !activeId || ["processing", "ready", "idle"].includes(capture.state);
  const supported = isNative || webCaptureSupported();
  return <main className="mx-auto w-full max-w-5xl space-y-5 p-4 pb-12 md:p-6">
    <header><h1 className="text-2xl font-semibold text-task-text">Sales Recording</h1><p className="mt-1 text-sm text-task-text-muted">Private, consented conversation capture. A customer selection is optional.</p></header>
    {!supported ? <Notice tone="neutral">This device or browser cannot safely record here. Open JewelOS in a supported browser over HTTPS, or use the updated Android app. No microphone was started.</Notice> : null}
    {isJewelOSWebShell() && !isNative ? <Notice tone="neutral">This app version can record only while this page stays active. Update JewelOS for native background recording support.</Notice> : null}
    {error || capture.error ? <Notice tone="danger">{error ?? capture.error}</Notice> : null}
    <section aria-label="Recorder" className="space-y-4 rounded-2xl border border-task-border bg-task-bg p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div aria-live="polite" className={`flex items-center gap-2 text-lg font-semibold ${state === "recording" ? "text-danger" : "text-task-text"}`}>
        {state === "recording" ? <span aria-hidden className="size-3 animate-pulse rounded-full bg-danger" /> : null}{labels[state] ?? "Needs attention"}</div>
        <output aria-label="Recording duration" className="font-mono text-xl tabular-nums text-task-text">{duration(capture.elapsedMs)}</output></div>
      <label className="block space-y-1 text-sm text-task-text-muted">Audio input <meter aria-label="Audio input" className="h-3 w-full" max={1} min={0} value={capture.level} /></label>
      <p className="text-sm text-task-text-muted">{isNative ? `Android recorder: ${native.network === "ticket_required" ? "Open JewelOS and Retry saving to renew upload access" : `Network: ${native.network}`}. The persistent notification includes Stop. Interruptions require your attention.` : `Network: ${browser.network}. Browser recording may stop in the background and does not continue after closing this tab.`} {capture.queuedBytes > 0 ? `${(capture.queuedBytes / 1024 / 1024).toFixed(1)} MiB waiting to save.` : ""}</p>
      {noOpenSession ? <><label className="flex cursor-pointer items-start gap-3 text-sm text-task-text"><input checked={consent} className="mt-1 size-5 shrink-0 accent-gold" onChange={(event) => setConsent(event.target.checked)} type="checkbox" /><span>I confirm that the people in this conversation have been informed and have consented to recording under the business recording policy.</span></label>
        <Button disabled={!supported || !consent || !canCapture || busy} onClick={() => void start()} type="button">Start recording</Button>{!canCapture ? <p className="text-sm text-task-text-muted">Recording needs an explicit pilot permission grant.</p> : null}</> : <div className="flex flex-wrap gap-3">
          {state === "recording" ? <Button disabled={busy || !canControlActive} onClick={() => void control("pause")} type="button">Pause</Button> : null}
          {state === "paused" || state === "needs_attention" ? <Button disabled={busy || !canControlActive} onClick={() => void control("resume")} type="button">Resume</Button> : null}
          {state !== "processing" && state !== "ready" && state !== "saving" ? <Button disabled={busy || !canControlActive} onClick={() => void control("stop")} type="button">Stop</Button> : null}
          <Button disabled={busy || !canControlActive} onClick={() => void run(async () => { if (isNative && ownNativeSession) sendNativeRecorder("recorder.start", undefined, await renewRecordingTicket(ownNativeSession)); else await recorder.retry(); })} type="button">Retry saving</Button>
        </div>}
      {walkins.length && selectedId ? <div className="flex flex-wrap items-center gap-2"><label className="text-sm text-task-text" htmlFor="recording-walkin">Link existing CRM walk-in (optional)</label><select className="min-h-11 max-w-full rounded-lg border border-task-border bg-task-bg p-2 text-task-text" id="recording-walkin" onChange={(event) => { setWalkin(event.target.value); setLinked(false); }} value={walkin}><option value="">No customer selected</option>{walkins.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}</select><Button disabled={!walkin || busy} onClick={() => void run(async () => { await linkRecordingWalkin(selectedId, walkin); setLinked(true); })} type="button">Link walk-in</Button>{linked ? <span role="status" className="text-sm text-success">Walk-in linked</span> : null}</div> : null}
      <p className="text-xs text-task-text-muted">Recording works without a customer. Linking is limited to authorized CRM walk-ins already synced to this branch; arbitrary customer identifiers are not accepted. Device status reflects recent recorder activity; a stale heartbeat is not proof the device is online.</p>
    </section>
    <section className="space-y-3" aria-label="Recordings"><h2 className="text-lg font-semibold text-task-text">Recordings</h2>
      <div className="flex flex-wrap items-center gap-2"><select aria-label="Recording session" className="min-h-11 min-w-0 max-w-full rounded-lg border border-task-border bg-task-bg p-2 text-task-text" onChange={(event) => setSelected(event.target.value)} value={selectedId ?? ""}><option value="" disabled>Select a session</option>{sessions.map((session) => <option key={session.id} value={session.id}>{new Date(session.created_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · {labels[session.status]}</option>)}</select><Button disabled={busy} onClick={() => void run(async () => { await refresh(); })} type="button">Refresh</Button></div>
      {selectedId ? <p className="break-all text-xs text-task-text-muted">Session {selectedId}</p> : <p className="text-sm text-task-text-muted">No recordings loaded.</p>}
    </section>
    <section aria-label="Transcript" className="space-y-3 rounded-2xl border border-task-border bg-task-bg p-4 md:p-6"><h2 className="text-lg font-semibold text-task-text">Transcript{snapshot ? ` · ${labels[snapshot.session.status] ?? "Needs attention"}` : ""}</h2><p className="text-sm text-task-text-muted">Live snippets are provisional and may change. Final text replaces them. Availability and delay depend on processing capacity; pilot p50/p95 latency has not yet been measured.</p>
      {segments.length ? <ol className="space-y-3">{segments.map((segment) => <li className="border-l-2 border-task-border pl-3" key={segment.segment_id}><span className="text-xs font-semibold text-task-text-muted">{segment.is_final ? "Final" : "Provisional"} · {duration(segment.started_ms)}</span><p className="whitespace-pre-wrap break-words text-task-text">{segment.text}</p></li>)}</ol> : <p className="text-sm text-task-text-muted">No transcript snippets yet.</p>}
    </section>
    {canCoach ? <section className="space-y-3 rounded-2xl border border-task-border bg-task-bg p-4"><label className="flex min-h-11 items-center gap-3 text-task-text"><input checked={alerts} className="size-5 accent-gold" onChange={(event) => setAlerts(event.target.checked)} type="checkbox" />Critical coaching alerts</label><p className="text-sm text-task-text-muted">Optional manager feed. Alerts require final, unambiguous evidence and are rate-limited.</p>{alerts ? <ul aria-live="polite" className="space-y-2">{snapshot?.alerts.map((alert) => <li className="rounded-lg border border-warning p-3 text-task-text" key={alert.id}>{alert.message}</li>)}{!snapshot?.alerts.length ? <li className="text-sm text-task-text-muted">No critical alerts.</li> : null}</ul> : null}</section> : null}
  </main>;
}
