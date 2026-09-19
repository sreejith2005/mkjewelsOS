import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, RotateCcw, Square } from "lucide-react";
import { Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { toTranscriptionWav } from "./voiceAudio";
import { interpretTaskVoiceNote, type VoiceTaskInterpretation } from "./voiceApi";

/** Matches the ceiling the Edge Function enforces on the uploaded clip. */
export const VOICE_NOTE_MAX_SECONDS = 60;
/** Anything shorter is a mis-tap, and speech-to-text invents words for it. */
export const VOICE_NOTE_MIN_MILLISECONDS = 1_000;
/**
 * Below this RMS the input is a dead or muted microphone (digital silence), not
 * a quiet voice. Only that is refused here: with noise suppression a normal
 * voice can sit well under 0.02, and the server's own no-speech and word-rate
 * checks catch anything in between.
 */
const DEAD_MIC_LEVEL = 0.003;
const LEVEL_SAMPLE_MILLISECONDS = 100;

type CaptureState = "idle" | "starting" | "recording" | "interpreting";

function preferredMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

/**
 * Created synchronously inside the tap, before the permission prompt: an
 * AudioContext created after that await can lose the user gesture and start
 * suspended, and a suspended analyser reads pure silence however loud the
 * speaker is.
 */
function createMeterContext(): AudioContext | null {
  const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  try {
    const context = new AudioContextClass();
    void context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

/** "unknown" whenever the meter could not really listen, so it never blocks a clip it did not hear. */
type MeterVerdict = "heard" | "silent" | "unknown";
type LevelMeter = Readonly<{ close: () => void; verdict: () => MeterVerdict }>;

/**
 * Samples the microphone level while recording, so the author can see the mic
 * is hearing them, and so a dead or muted microphone is caught before upload.
 */
function startLevelMeter(context: AudioContext, stream: MediaStream, onLevel: (level: number) => void): LevelMeter | null {
  let analyser: AnalyserNode;
  try {
    analyser = context.createAnalyser();
    analyser.fftSize = 1_024;
    context.createMediaStreamSource(stream).connect(analyser);
  } catch {
    void context.close().catch(() => undefined);
    return null;
  }
  const samples = new Float32Array(analyser.fftSize);
  let peak = 0;
  let runningSamples = 0;
  const timer = window.setInterval(() => {
    if (context.state !== "running") {
      void context.resume().catch(() => undefined);
      return;
    }
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const rms = Math.sqrt(sum / samples.length);
    peak = Math.max(peak, rms);
    runningSamples += 1;
    // Square root so a quiet but real voice still visibly moves the bar.
    onLevel(Math.min(1, Math.sqrt(rms / 0.1)));
  }, LEVEL_SAMPLE_MILLISECONDS);
  return {
    close: () => {
      window.clearInterval(timer);
      void context.close().catch(() => undefined);
    },
    verdict: () => runningSamples < 3 ? "unknown" : peak < DEAD_MIC_LEVEL ? "silent" : "heard",
  };
}

/**
 * Records a short task instruction and hands the interpreted draft back to the
 * composer. Nothing is stored: the clip lives in memory for one request and the
 * transcript is display-only.
 */
export function VoiceTaskCapture({ onInterpreted }: { onInterpreted: (interpretation: VoiceTaskInterpretation) => void }) {
  const [state, setState] = useState<CaptureState>("idle");
  const [secondsLeft, setSecondsLeft] = useState(VOICE_NOTE_MAX_SECONDS);
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<CaptureState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const meterRef = useRef<LevelMeter | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  // The composer re-creates its callback as fields change; the latest one must
  // receive a result that arrives after those changes.
  const onInterpretedRef = useRef(onInterpreted);
  onInterpretedRef.current = onInterpreted;

  const moveTo = useCallback((next: CaptureState) => {
    stateRef.current = next;
    if (mountedRef.current) setState(next);
  }, []);

  const releaseRecorder = useCallback(() => {
    if (stopTimerRef.current !== null) window.clearInterval(stopTimerRef.current);
    stopTimerRef.current = null;
    meterRef.current?.close();
    meterRef.current = null;
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
  }, []);

  // A recorder left running would keep the microphone open after the composer
  // closes, and a late result must not write into a closed composer.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      releaseRecorder();
    };
  }, [releaseRecorder]);

  const start = useCallback(async () => {
    // A second tap while the permission prompt is open would open a second
    // microphone stream that nothing ever stops.
    if (stateRef.current !== "idle") return;
    setError(null);
    setTranscript(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot record audio. Fill the task in manually.");
      return;
    }
    moveTo("starting");
    const meterContext = createMeterContext();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true } });
    } catch {
      void meterContext?.close().catch(() => undefined);
      moveTo("idle");
      if (mountedRef.current) setError("Microphone access was blocked. Allow it in the browser and try again.");
      return;
    }
    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      void meterContext?.close().catch(() => undefined);
      return;
    }
    let recorder: MediaRecorder;
    try {
      const mimeType = preferredMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      void meterContext?.close().catch(() => undefined);
      moveTo("idle");
      setError("This browser cannot record audio. Fill the task in manually.");
      return;
    }
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size > 0) chunks.push(event.data); });
    recorder.addEventListener("stop", () => {
      const verdict = meterRef.current?.verdict() ?? "unknown";
      releaseRecorder();
      if (mountedRef.current) setLevel(0);
      if (!mountedRef.current) return;
      const recording = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (recording.size === 0) {
        moveTo("idle");
        setError("Nothing was recorded. Try again.");
        return;
      }
      if (Date.now() - startedAt < VOICE_NOTE_MIN_MILLISECONDS) {
        moveTo("idle");
        setError("That was too short. Tap the mic, say the task, then tap stop.");
        return;
      }
      if (verdict === "silent") {
        moveTo("idle");
        setError("The microphone sent no sound at all. It may be muted, or the browser may be using a different microphone - check the mic icon in the address bar, then try again.");
        return;
      }
      moveTo("interpreting");
      toTranscriptionWav(recording)
        .then((wav) => wav
          ? interpretTaskVoiceNote(wav, "voice-note.wav")
          : interpretTaskVoiceNote(recording, `voice-note.${recording.type.includes("mp4") ? "mp4" : "webm"}`))
        .then((interpretation) => {
          if (!mountedRef.current) return;
          setTranscript(interpretation.transcript);
          onInterpretedRef.current(interpretation);
        })
        .catch((caught: unknown) => {
          if (mountedRef.current) setError(caught instanceof Error ? caught.message : "Unable to interpret the voice note.");
        })
        .finally(() => moveTo("idle"));
    });

    recorderRef.current = recorder;
    meterRef.current = meterContext ? startLevelMeter(meterContext, stream, (next) => { if (mountedRef.current) setLevel(next); }) : null;
    recorder.start();
    moveTo("recording");
    setSecondsLeft(VOICE_NOTE_MAX_SECONDS);
    let remaining = VOICE_NOTE_MAX_SECONDS;
    stopTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      setSecondsLeft(Math.max(remaining, 0));
      if (remaining <= 0 && recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, 1_000);
  }, [moveTo, releaseRecorder]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  const busy = state === "starting" || state === "interpreting";

  return (
    <section aria-label="Assign by voice" className="mb-3 rounded-xl border border-task-border bg-task-muted p-3">
      <div className="flex items-center gap-3">
        <button
          aria-label={state === "recording" ? "Stop recording" : "Record a task instruction"}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full transition",
            state === "recording" ? "bg-danger/15 text-danger" : "bg-task-accent-soft text-task-text hover:bg-task-accent/30",
            busy ? "opacity-60" : "",
          )}
          disabled={busy}
          onClick={() => state === "recording" ? stop() : void start()}
          type="button"
        >
          {state === "recording" ? <Square className="size-5" /> : busy ? <Loader2 className="size-5 animate-spin" /> : <Mic className="size-5" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-task-text">
            {state === "recording" ? `Recording · ${secondsLeft}s left` : state === "interpreting" ? "Interpreting…" : state === "starting" ? "Starting microphone…" : "Assign by voice"}
          </p>
          <p className="truncate text-xs text-task-text-muted">
            {state === "recording"
              ? "Say the task, who it is for, and when it is due. Tap stop when done."
              : state === "interpreting"
                ? "Filling the form below."
                : `Record up to ${VOICE_NOTE_MAX_SECONDS} seconds. You review everything before assigning.`}
          </p>
          {state === "recording" ? (
            <div aria-label="Microphone level" aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.round(level * 100)} className="mt-2 h-1.5 overflow-hidden rounded-full bg-task-bg" role="meter">
              <div className="h-full rounded-full bg-task-accent transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
            </div>
          ) : null}
        </div>
        {transcript && state === "idle" ? <button aria-label="Record again" className="flex size-11 shrink-0 items-center justify-center rounded-lg text-task-text-muted hover:bg-task-bg" onClick={() => void start()} type="button"><RotateCcw className="size-4" /></button> : null}
      </div>
      {transcript ? <p className="mt-3 rounded-lg bg-task-bg p-2 text-xs italic text-task-text-muted" data-testid="voice-transcript">“{transcript}”</p> : null}
      {error ? <div className="mt-3"><Notice tone="danger">{error}</Notice></div> : null}
    </section>
  );
}
