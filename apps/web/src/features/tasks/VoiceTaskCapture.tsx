import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, RotateCcw, Square } from "lucide-react";
import { Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { interpretTaskVoiceNote, type VoiceTaskInterpretation } from "./voiceApi";

/** Matches the ceiling the Edge Function enforces on the uploaded clip. */
export const VOICE_NOTE_MAX_SECONDS = 60;

type CaptureState = "idle" | "recording" | "interpreting";

function preferredMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

/**
 * Records a short task instruction and hands the interpreted draft back to the
 * composer. Nothing is stored: the clip lives in memory for one request and the
 * transcript is display-only.
 */
export function VoiceTaskCapture({ onInterpreted }: { onInterpreted: (interpretation: VoiceTaskInterpretation) => void }) {
  const [state, setState] = useState<CaptureState>("idle");
  const [secondsLeft, setSecondsLeft] = useState(VOICE_NOTE_MAX_SECONDS);
  const [transcript, setTranscript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const stopTimerRef = useRef<number | null>(null);

  const releaseRecorder = useCallback(() => {
    if (stopTimerRef.current !== null) window.clearInterval(stopTimerRef.current);
    stopTimerRef.current = null;
    recorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    recorderRef.current = null;
  }, []);

  // A recorder left running would keep the microphone open after the composer closes.
  useEffect(() => releaseRecorder, [releaseRecorder]);

  const start = useCallback(async () => {
    setError(null);
    setTranscript(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot record audio. Fill the task in manually.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Microphone access was blocked. Allow it in the browser and try again.");
      return;
    }
    const mimeType = preferredMimeType();
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size > 0) chunks.push(event.data); });
    recorder.addEventListener("stop", () => {
      releaseRecorder();
      const recording = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
      if (recording.size === 0) {
        setState("idle");
        setError("Nothing was recorded. Try again.");
        return;
      }
      setState("interpreting");
      interpretTaskVoiceNote(recording, `voice-note.${recorder.mimeType.includes("mp4") ? "mp4" : "webm"}`)
        .then((interpretation) => {
          setTranscript(interpretation.transcript);
          onInterpreted(interpretation);
        })
        .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Unable to interpret the voice note."))
        .finally(() => setState("idle"));
    });

    recorderRef.current = recorder;
    recorder.start();
    setState("recording");
    setSecondsLeft(VOICE_NOTE_MAX_SECONDS);
    let remaining = VOICE_NOTE_MAX_SECONDS;
    stopTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      setSecondsLeft(Math.max(remaining, 0));
      if (remaining <= 0 && recorderRef.current?.state === "recording") recorderRef.current.stop();
    }, 1_000);
  }, [onInterpreted, releaseRecorder]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }, []);

  return (
    <section aria-label="Assign by voice" className="mb-3 rounded-xl border border-task-border bg-task-muted p-3">
      <div className="flex items-center gap-3">
        <button
          aria-label={state === "recording" ? "Stop recording" : "Record a task instruction"}
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-full transition",
            state === "recording" ? "bg-danger/15 text-danger" : "bg-task-accent-soft text-task-text hover:bg-task-accent/30",
            state === "interpreting" ? "opacity-60" : "",
          )}
          disabled={state === "interpreting"}
          onClick={() => state === "recording" ? stop() : void start()}
          type="button"
        >
          {state === "recording" ? <Square className="size-5" /> : state === "interpreting" ? <Loader2 className="size-5 animate-spin" /> : <Mic className="size-5" />}
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-task-text">
            {state === "recording" ? `Recording · ${secondsLeft}s left` : state === "interpreting" ? "Interpreting…" : "Assign by voice"}
          </p>
          <p className="truncate text-xs text-task-text-muted">
            {state === "recording"
              ? "Say the task, who it is for, and when it is due."
              : state === "interpreting"
                ? "Filling the form below."
                : `Record up to ${VOICE_NOTE_MAX_SECONDS} seconds. You review everything before assigning.`}
          </p>
        </div>
        {transcript && state === "idle" ? <button aria-label="Record again" className="flex size-11 shrink-0 items-center justify-center rounded-lg text-task-text-muted hover:bg-task-bg" onClick={() => void start()} type="button"><RotateCcw className="size-4" /></button> : null}
      </div>
      {transcript ? <p className="mt-3 rounded-lg bg-task-bg p-2 text-xs italic text-task-text-muted" data-testid="voice-transcript">“{transcript}”</p> : null}
      {error ? <div className="mt-3"><Notice tone="danger">{error}</Notice></div> : null}
    </section>
  );
}
