import { useState } from "react";
import { Loader2, Mic, RotateCcw, Square } from "lucide-react";
import { VOICE_TASK_SPEAKING_EXAMPLE, VOICE_TASK_SPEAKING_GUIDE } from "@jewelos/core";
import { Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { VOICE_NOTE_MAX_SECONDS, useVoiceRecorder } from "@/features/voice/useVoiceRecorder";
import { interpretTaskVoiceNote, type VoiceTaskInterpretation } from "./voiceApi";

// The recorder (microphone, level meter, limits, WAV re-encode) is shared with
// Ask Kiara's mic button since Phase 7; these names stay exported from here.
export { VOICE_NOTE_MAX_SECONDS, VOICE_NOTE_MIN_MILLISECONDS } from "@/features/voice/useVoiceRecorder";

/**
 * Records a short task instruction and hands the interpreted draft back to the
 * composer. Nothing is stored: the clip lives in memory for one request and the
 * transcript is display-only.
 */
export function VoiceTaskCapture({ onInterpreted }: { onInterpreted: (interpretation: VoiceTaskInterpretation) => void }) {
  const [transcript, setTranscript] = useState<string | null>(null);
  const recorder = useVoiceRecorder<VoiceTaskInterpretation>({
    filenameStem: "voice-note",
    messages: {
      unsupported: "This browser cannot record audio. Fill the task in manually.",
      tooShort: "That was too short. Tap the mic, say the task, then tap stop.",
      failed: "Unable to interpret the voice note.",
    },
    upload: interpretTaskVoiceNote,
    onStart: () => setTranscript(null),
    onResult: (interpretation) => {
      setTranscript(interpretation.transcript);
      onInterpreted(interpretation);
    },
  });
  const { secondsLeft, level, error, start, stop } = recorder;
  const state = recorder.state === "processing" ? "interpreting" : recorder.state;

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
          <p className="text-sm text-task-text-muted">
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
      {state === "recording" || state === "starting" || (state === "idle" && !transcript) ? <VoiceSpeakingGuide active={state === "recording"} /> : null}
      {transcript ? <p className="mt-3 rounded-lg bg-task-bg p-2 text-xs italic text-task-text-muted" data-testid="voice-transcript">“{transcript}”</p> : null}
      {error ? <div className="mt-3"><Notice tone="danger">{error}</Notice></div> : null}
    </section>
  );
}

/**
 * What to say, in order, so the author does not forget the assignee or the
 * deadline mid-sentence. Display only: the interpreted draft is still checked
 * by the composer's gap rules.
 */
function VoiceSpeakingGuide({ active }: { active: boolean }) {
  return (
    <div className="mt-3 rounded-lg bg-task-bg p-3" data-testid="voice-speaking-guide">
      <p className="mb-3 text-base font-semibold text-task-text">{active ? "Speak in this order" : "What to say"}</p>
      <ol className="grid gap-3 sm:grid-cols-2">
        {VOICE_TASK_SPEAKING_GUIDE.map((step, index) => (
          <li className="flex items-center gap-3 text-base" key={step.id}>
            <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold", step.required ? "bg-task-accent text-task-text" : "bg-task-muted text-task-text-muted")}>{index + 1}</span>
            <span className="min-w-0 flex flex-wrap items-baseline gap-x-2">
              <span className="font-semibold text-task-text">{step.label}</span>
              <span className={cn("text-sm", step.required ? "text-danger" : "text-task-text-muted")}>{step.required ? "Required" : "Optional"}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-base leading-relaxed text-task-text-muted">Example: {VOICE_TASK_SPEAKING_EXAMPLE}</p>
    </div>
  );
}
