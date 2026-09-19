import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, RotateCcw, Square } from "lucide-react";
import { Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { interpretTaskVoiceNote, type VoiceTaskInterpretation } from "./voiceApi";

/** Matches the ceiling the Edge Function enforces on the uploaded clip. */
export const VOICE_NOTE_MAX_SECONDS = 60;
/** Anything shorter is a mis-tap, and speech-to-text invents words for it. */
export const VOICE_NOTE_MIN_MILLISECONDS = 1_000;
/** RMS level a speaking voice clears and room hiss does not. */
const SPEECH_LEVEL = 0.02;
/** How long speech must be heard, in total, before the clip is worth sending. */
const MIN_SPEECH_MILLISECONDS = 300;
const LEVEL_SAMPLE_MILLISECONDS = 100;

type CaptureState = "idle" | "starting" | "recording" | "interpreting";

function preferredMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

type LevelMeter = Readonly<{ close: () => void; heardSpeechMs: () => number }>;

/**
 * Samples the microphone level while recording. It shows the author that the
 * mic is actually hearing them, and lets a silent clip be refused here: sent
 * on, speech-to-text returns invented text rather than nothing. Browsers
 * without Web Audio get no meter and the clip is sent unchecked.
 */
function startLevelMeter(stream: MediaStream, onLevel: (level: number) => void): LevelMeter | null {
  const AudioContextClass = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  let context: AudioContext;
  try {
    context = new AudioContextClass();
  } catch {
    return null;
  }
  const analyser = context.createAnalyser();
  analyser.fftSize = 1_024;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  let speechMs = 0;
  const timer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) sum += sample * sample;
    const rms = Math.sqrt(sum / samples.length);
    if (rms >= SPEECH_LEVEL) speechMs += LEVEL_SAMPLE_MILLISECONDS;
    onLevel(Math.min(1, rms / 0.2));
  }, LEVEL_SAMPLE_MILLISECONDS);
  return {
    close: () => {
      window.clearInterval(timer);
      void context.close().catch(() => undefined);
    },
    heardSpeechMs: () => speechMs,
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
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { autoGainControl: true, echoCancellation: true, noiseSuppression: true } });
    } catch {
      moveTo("idle");
      if (mountedRef.current) setError("Microphone access was blocked. Allow it in the browser and try again.");
      return;
    }
    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    let recorder: MediaRecorder;
    try {
      const mimeType = preferredMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      stream.getTracks().forEach((track) => track.stop());
      moveTo("idle");
      setError("This browser cannot record audio. Fill the task in manually.");
      return;
    }
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size > 0) chunks.push(event.data); });
    recorder.addEventListener("stop", () => {
      const heardSpeechMs = meterRef.current?.heardSpeechMs() ?? null;
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
      if (heardSpeechMs !== null && heardSpeechMs < MIN_SPEECH_MILLISECONDS) {
        moveTo("idle");
        setError("No voice was picked up. Check that the right microphone is selected and not muted, then try again.");
        return;
      }
      moveTo("interpreting");
      interpretTaskVoiceNote(recording, `voice-note.${recording.type.includes("mp4") ? "mp4" : "webm"}`)
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
    meterRef.current = startLevelMeter(stream, (next) => { if (mountedRef.current) setLevel(next); });
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
