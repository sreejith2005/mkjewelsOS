import { useEffect, useState } from "react";
import { CheckCircle2, Mic, MicOff, Pause, Play, Square, Wifi, WifiOff } from "lucide-react";
import { hasPermission, reconcileTranscript, type TranscriptSegment } from "@jewelos/core";
import { fetchToday, recordingSnapshot, recordingWalkins } from "@jewelos/data";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { useRecorder } from "@/features/recording/useRecorder";
import { cn } from "@/lib/utils";
import { siPath } from "./routes";
import { Panel } from "./ui";
import { useLoad, useOnline } from "./useLoad";

function clock(ms: number) {
  const seconds = Math.floor(ms / 1000); const h = Math.floor(seconds / 3600);
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, "0"); const ss = String(seconds % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Microphone permission as the browser reports it; "unknown" where it cannot say. */
function useMicPermission(): "granted" | "denied" | "prompt" | "unknown" {
  const [state, setState] = useState<"granted" | "denied" | "prompt" | "unknown">("unknown");
  useEffect(() => {
    let status: PermissionStatus | null = null; let active = true;
    const update = () => { if (active && status) setState(status.state); };
    // `microphone` is not in every TypeScript PermissionName list; browsers that lack it reject.
    void navigator.permissions?.query({ name: "microphone" as PermissionName }).then((result) => { status = result; update(); result.addEventListener("change", update); }).catch(() => undefined);
    return () => { active = false; status?.removeEventListener("change", update); };
  }, []);
  return state;
}

export function RecordFlow({ navigate }: { navigate: (path: string) => void }) {
  const { profile, access } = useAuth();
  const rec = useRecorder(profile?.id);
  const online = useOnline();
  const mic = useMicPermission();
  const today = useLoad(fetchToday, []);
  const [consent, setConsent] = useState(false);
  const [walkin, setWalkin] = useState("");
  const [walkins, setWalkins] = useState<ReadonlyArray<{ ref: string; label: string }>>([]);
  const [live, setLive] = useState<readonly TranscriptSegment[]>([]);
  const [showLive, setShowLive] = useState(false);
  const canCrm = hasPermission(access, "crm.view");
  useEffect(() => { if (canCrm) void recordingWalkins().then(setWalkins).catch(() => setWalkins([])); }, [canCrm]);

  const open = ["recording", "paused", "saving", "needs_attention"].includes(rec.state) && rec.activeId;
  const done = (rec.state === "processing" || rec.state === "ready") && rec.activeId;

  useEffect(() => {
    if (!showLive || !rec.activeId) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try { const next = await recordingSnapshot(rec.activeId!); if (!cancelled) setLive((previous) => reconcileTranscript(previous, next.segments)); } catch { /* Live text is optional. */ }
      if (!cancelled) timer = setTimeout(() => { void tick(); }, document.hidden ? 5000 : 1500);
    };
    void tick(); return () => { cancelled = true; clearTimeout(timer); };
  }, [rec.activeId, showLive]);

  const canRecord = today.data?.can_record ?? hasPermission(access, "recording.capture");
  const reason = today.data && !today.data.can_record
    ? !today.data.has_capture_permission ? "Recording needs permission from your administrator." : !today.data.pilot_enabled ? "Recording is switched off for the business right now." : "Your account or branch is not on the recording list yet. Ask your administrator."
    : null;

  // ----- Finished: only after the server confirmed the last upload.
  if (done) return <div className="mx-auto max-w-lg space-y-4">
    <Panel>
      <div aria-live="polite" className="flex flex-col items-center gap-3 py-6 text-center" role="status">
        <CheckCircle2 aria-hidden className="size-12 text-success" />
        <h1 className="text-2xl font-semibold text-task-text">Saved</h1>
        <p className="max-w-sm text-sm text-task-text-muted">{rec.state === "ready" ? "Your conversation is ready to open." : "Your conversation is safely saved. We are turning it into text and preparing the summary. This page updates on its own."}</p>
        <p className="font-mono text-lg tabular-nums text-task-text">{clock(rec.elapsedMs)}</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button className="min-h-12 text-base" onClick={() => navigate(siPath.conversation(rec.activeId!))} type="button">Open conversation</Button>
        <Button className="min-h-12" onClick={() => navigate(siPath.today())} type="button" variant="secondary">Back to Today</Button>
      </div>
    </Panel>
  </div>;

  // ----- Recording (or paused, saving, interrupted).
  if (open) {
    const saving = rec.state === "saving";
    return <div className="mx-auto max-w-lg space-y-4">
      {rec.error || rec.captureError ? <Notice tone="danger">{rec.error ?? rec.captureError}</Notice> : null}
      {rec.linkNotice ? <Notice tone="task">{rec.linkNotice}</Notice> : null}
      <Panel>
        <div className="flex flex-col items-center gap-4 py-4 text-center">
          <h1 aria-live="polite" className={cn("flex items-center gap-2 text-lg font-semibold", rec.state === "recording" ? "text-danger" : "text-task-text")}>
            {rec.state === "recording" ? <span aria-hidden className="size-3 animate-pulse rounded-full bg-danger motion-reduce:animate-none" /> : null}
            {rec.state === "recording" ? "Recording" : rec.state === "paused" ? "Paused" : saving ? "Saving…" : "Needs your attention"}
          </h1>
          <output aria-label="Recording time" className="font-mono text-5xl font-semibold tabular-nums tracking-tight text-task-text">{clock(rec.elapsedMs)}</output>
          <div className="flex w-full max-w-xs items-center gap-3">
            {rec.state === "recording" ? <Mic aria-hidden className="size-5 shrink-0 text-task-text-muted" /> : <MicOff aria-hidden className="size-5 shrink-0 text-task-text-muted" />}
            <meter aria-label="Microphone level" className="h-3 w-full" max={1} min={0} value={rec.state === "recording" ? rec.level : 0} />
          </div>
          <p className="flex items-center gap-2 text-sm text-task-text-muted">
            {online && rec.network !== "offline" ? <Wifi aria-hidden className="size-4" /> : <WifiOff aria-hidden className="size-4" />}
            {!online || rec.network === "offline" ? "Offline: audio is kept on this phone and uploads when you are back online."
              : rec.network === "retrying" ? "Connection is slow: retrying the upload." : rec.network === "ticket_required" ? "Upload paused: tap Retry upload." : "Connected"}
          </p>
          {rec.queuedBytes > 0 ? <p className="text-sm text-task-text">{mb(rec.queuedBytes)} waiting to upload{saving ? ". Keep JewelOS open until it says Saved." : "."}</p> : null}
        </div>
        <div className="grid grid-cols-2 gap-2">
          {rec.state === "recording" ? <Button className="min-h-14 text-base" disabled={rec.busy || !rec.canControl} onClick={() => void rec.control("pause")} type="button" variant="secondary"><Pause aria-hidden />Pause</Button> : null}
          {rec.state === "paused" || rec.state === "needs_attention" ? <Button className="min-h-14 text-base" disabled={rec.busy || !rec.canControl} onClick={() => void rec.control("resume")} type="button" variant="secondary"><Play aria-hidden />Resume</Button> : null}
          {!saving ? <Button className="min-h-14 text-base" disabled={rec.busy || !rec.canControl} onClick={() => void rec.control("stop")} type="button" variant="danger"><Square aria-hidden />Finish</Button> : null}
          {saving || rec.queuedBytes > 0 || rec.state === "needs_attention" ? <Button className={cn("min-h-14", saving && "col-span-2")} disabled={rec.busy || !rec.canControl} onClick={() => void rec.retry()} type="button" variant="ghost">Retry upload</Button> : null}
        </div>
        {!rec.canControl ? <p className="mt-3 text-sm text-task-text-muted">This recording belongs to another sign-in on this device, so it cannot be controlled here.</p> : null}
        <p className="mt-4 text-xs text-task-text-muted">{rec.isNative ? "The phone keeps recording with the screen off. The notification has a Stop button." : "Keep this page open: a browser may stop recording in the background and does not continue after closing this tab."}</p>
      </Panel>
      <Panel>
        <button aria-expanded={showLive} className="flex min-h-11 w-full items-center justify-between text-left text-sm font-semibold text-task-text" onClick={() => setShowLive((value) => !value)} type="button">
          Live transcript <span className="text-xs font-normal text-task-text-muted">{showLive ? "Hide" : "Show"}</span>
        </button>
        {showLive ? <div className="mt-2 space-y-2" aria-live="polite">
          <p className="text-xs text-task-text-muted">Early text may change. The final transcript replaces it after you finish.</p>
          {live.length ? <ol className="space-y-2">{live.map((segment) => <li className="border-l-2 border-task-border pl-3 text-sm text-task-text" key={segment.segment_id}>{segment.text}</li>)}</ol>
            : <p className="text-sm text-task-text-muted">No text yet.</p>}
        </div> : null}
      </Panel>
    </div>;
  }

  // ----- Ready to start.
  const blocked = !rec.supported || !canRecord || !online || mic === "denied";
  return <div className="mx-auto max-w-lg space-y-4">
    <div><h1 className="text-2xl font-semibold text-task-text">New conversation</h1><p className="mt-1 text-sm text-task-text-muted">Record a customer conversation to get a summary and coaching.</p></div>
    {rec.error ? <Notice tone="danger">{rec.error}</Notice> : null}
    {!rec.supported ? <Notice tone="neutral">This device or browser cannot safely record here. Open JewelOS in Chrome over HTTPS, or use the updated Android app. No microphone was started.</Notice> : null}
    {rec.inAppWithoutNative ? <Notice tone="neutral">This app version can record only while this page stays open. Update JewelOS to keep recording with the screen off.</Notice> : null}
    {!online ? <Notice tone="neutral">You are offline. Connect to the internet to start a conversation.</Notice> : null}
    {mic === "denied" ? <Notice tone="danger">Microphone access is blocked for JewelOS. Allow the microphone in your browser or phone settings, then come back here.</Notice> : null}
    {reason ? <Notice tone="task">{reason}</Notice> : null}
    <Panel>
      <ol className="space-y-5">
        <li>
          <p className="text-xs font-semibold uppercase tracking-wider text-task-text-muted">Salesperson</p>
          <p className="mt-1 text-base font-semibold text-task-text">{profile?.employee_name ?? "You"}</p>
          <p className="text-xs text-task-text-muted">Recorded under your sign-in. This cannot be changed.</p>
        </li>
        {canCrm ? <li>
          <label className="text-xs font-semibold uppercase tracking-wider text-task-text-muted" htmlFor="si-walkin">Customer (optional)</label>
          <select className="field mt-1" id="si-walkin" onChange={(event) => setWalkin(event.target.value)} value={walkin}>
            <option value="">No customer selected</option>
            {walkins.map((item) => <option key={item.ref} value={item.ref}>{item.label}</option>)}
          </select>
          <p className="mt-1 text-xs text-task-text-muted">{walkins.length ? "Only CRM walk-ins already assigned to you or your branch are listed." : "No CRM walk-ins to link right now. You can record without one."}</p>
        </li> : null}
        <li>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-task-border p-3 has-[:checked]:border-gold/60 has-[:checked]:bg-gold/5">
            <input checked={consent} className="mt-0.5 size-6 shrink-0 accent-gold" onChange={(event) => setConsent(event.target.checked)} type="checkbox" />
            <span className="text-sm text-task-text">I told the customer this conversation is being recorded, and they agreed. <span className="text-task-text-muted">(Business recording policy, version {today.data?.consent_version ?? "pilot-v1"}.)</span></span>
          </label>
        </li>
      </ol>
      <Button className="mt-5 min-h-16 w-full text-lg" disabled={blocked || !consent || rec.busy} onClick={() => void rec.start(walkin || undefined)} type="button">
        <Mic aria-hidden className="size-6" />{rec.busy ? "Starting…" : "Start recording"}
      </Button>
      {!consent && !blocked ? <p className="mt-2 text-center text-xs text-task-text-muted">Tick the consent box to start.</p> : null}
      <p className="mt-4 text-xs text-task-text-muted">{rec.isNative ? "The phone keeps recording with the screen off." : "Keep this page open while recording. A browser does not continue after closing this tab."} Audio is kept for {today.data?.retention_days ?? 7} days.</p>
    </Panel>
  </div>;
}
