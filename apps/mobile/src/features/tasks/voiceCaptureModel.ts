export const VOICE_NOTE_MAX_SECONDS = 60;

export type VoiceCaptureStatus = "idle" | "recording" | "interpreting" | "error";
export type VoiceCaptureState = Readonly<{
  status: VoiceCaptureStatus;
  secondsLeft: number;
  stopRequested: boolean;
  transcript: string | null;
  error: string | null;
}>;

export type VoiceCaptureEvent =
  | Readonly<{ type: "start" }>
  | Readonly<{ type: "tick" }>
  | Readonly<{ type: "permission_denied" }>
  | Readonly<{ type: "stopped"; size: number }>
  | Readonly<{ type: "interpreted"; transcript: string }>
  | Readonly<{ type: "failed"; message: string }>
  | Readonly<{ type: "cancel" }>;

export const initialVoiceCaptureState: VoiceCaptureState = {
  status: "idle",
  secondsLeft: VOICE_NOTE_MAX_SECONDS,
  stopRequested: false,
  transcript: null,
  error: null,
};

export function reduceVoiceCapture(state: VoiceCaptureState, event: VoiceCaptureEvent): VoiceCaptureState {
  if (event.type === "start") return { ...initialVoiceCaptureState, status: "recording" };
  if (event.type === "cancel") return initialVoiceCaptureState;
  if (event.type === "permission_denied") return {
    ...initialVoiceCaptureState,
    status: "error",
    error: "Microphone access was blocked. Enable it in device settings and try again.",
  };
  if (event.type === "tick") {
    if (state.status !== "recording" || state.stopRequested) return state;
    const secondsLeft = Math.max(0, state.secondsLeft - 1);
    return { ...state, secondsLeft, stopRequested: secondsLeft === 0 };
  }
  if (event.type === "stopped") {
    return event.size > 0
      ? { ...state, status: "interpreting", secondsLeft: 0, stopRequested: false, error: null }
      : { ...initialVoiceCaptureState, status: "error", error: "Nothing was recorded. Try again." };
  }
  if (event.type === "interpreted") return {
    ...initialVoiceCaptureState,
    transcript: event.transcript,
  };
  return { ...state, status: "error", stopRequested: false, error: event.message };
}
