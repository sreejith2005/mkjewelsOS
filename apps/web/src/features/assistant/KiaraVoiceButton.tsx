import { Loader2, Mic, Square } from "lucide-react";
import { appendKiaraTranscript } from "@jewelos/core";
import { transcribeKiaraVoice, type KiaraTranscript } from "@jewelos/data/assistant/api";
import { cn } from "@/lib/utils";
import { VOICE_NOTE_MAX_SECONDS, useVoiceRecorder, type VoiceRecorder } from "@/features/voice/useVoiceRecorder";

/**
 * Ask Kiara's voice input (Phase 7). The recording becomes text in the input
 * box; it is never sent on its own. Shown only with `assistant.voice`, which
 * the transcribe function and `consume_my_voice_quota` check again.
 */
export function useKiaraVoice(onTranscript: (text: string) => void): VoiceRecorder {
  return useVoiceRecorder<KiaraTranscript>({
    filenameStem: "voice-question",
    messages: {
      unsupported: "This browser cannot record audio. Please type your question.",
      tooShort: "That was too short. Tap the mic, say your question, then tap stop.",
      failed: "Voice input is unavailable right now. Please type your question.",
    },
    upload: (recording, filename) => transcribeKiaraVoice({ body: recording, name: filename, size: recording.size, type: recording.type }),
    onResult: (transcript) => onTranscript(transcript.text),
  });
}

/** Adds spoken words to whatever is already typed, within the input limit (shared with Android). */
export const appendTranscript = appendKiaraTranscript;

export function KiaraMicButton({ disabled, voice }: { disabled: boolean; voice: VoiceRecorder }) {
  const recording = voice.state === "recording";
  const busy = voice.state === "starting" || voice.state === "processing";
  return <button
    aria-label={recording ? "Stop recording" : "Ask by voice"}
    className={cn(
      "flex size-11 shrink-0 items-center justify-center rounded-lg border transition disabled:cursor-not-allowed disabled:opacity-50",
      recording ? "border-danger/40 bg-danger/15 text-danger" : "border-task-border bg-task-bg text-task-text hover:border-task-accent hover:bg-task-accent-soft",
    )}
    disabled={busy || (disabled && !recording)}
    onClick={() => recording ? voice.stop() : void voice.start()}
    title={recording ? "Stop recording" : `Ask by voice (up to ${VOICE_NOTE_MAX_SECONDS} seconds)`}
    type="button"
  >
    {recording ? <Square aria-hidden className="size-5" /> : busy ? <Loader2 aria-hidden className="size-5 animate-spin" /> : <Mic aria-hidden className="size-5" />}
  </button>;
}

/** Recording state, the time left, the level, and any error, above the input row. */
export function KiaraVoiceStatus({ voice }: { voice: VoiceRecorder }) {
  if (voice.state === "recording") {
    return <div className="mb-2 rounded-lg bg-task-muted px-3 py-2" role="status">
      <p className="text-sm font-semibold text-task-text">Recording · {voice.secondsLeft}s left</p>
      <p className="text-xs text-task-text-muted">Speak in Hindi, Hinglish, or English (up to {VOICE_NOTE_MAX_SECONDS} seconds). Tap stop when done. You can edit the words before sending.</p>
      <div aria-label="Microphone level" aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.round(voice.level * 100)} className="mt-2 h-1.5 overflow-hidden rounded-full bg-task-bg" role="meter">
        <div className="h-full rounded-full bg-task-accent transition-[width] duration-100" style={{ width: `${Math.round(voice.level * 100)}%` }} />
      </div>
    </div>;
  }
  if (voice.state === "starting") return <p className="mb-2 rounded-lg bg-task-muted px-3 py-2 text-sm text-task-text" role="status">Starting microphone…</p>;
  if (voice.state === "processing") return <p className="mb-2 inline-flex w-full items-center gap-2 rounded-lg bg-task-muted px-3 py-2 text-sm text-task-text" role="status"><Loader2 aria-hidden className="size-4 animate-spin" />Writing down what you said…</p>;
  if (voice.error) return <p className="mb-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{voice.error}</p>;
  return null;
}
