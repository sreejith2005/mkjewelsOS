import { useCallback, useEffect, useRef, useState } from "react";
import { toTranscriptionWav } from "@/features/tasks/voiceAudio";

/**
 * The browser recorder behind Tasks voice (`VoiceTaskCapture`) and Ask Kiara's
 * mic button. Moved unchanged out of `VoiceTaskCapture` (Ask Kiara Phase 7):
 * one microphone per tap, a live level meter, a hard time limit, the mis-tap
 * and dead-microphone refusals, and the 16 kHz WAV re-encode before upload.
 * Each caller supplies its own wording and its own upload call. Nothing is
 * stored: the clip lives in memory for one request.
 */

/** Matches the ceiling the Edge Functions enforce on the uploaded clip. */
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

export type VoiceRecorderState = "idle" | "starting" | "recording" | "processing";

export type VoiceRecorderMessages = Readonly<{
  /** No MediaRecorder or getUserMedia in this browser. */
  unsupported: string;
  /** Shorter than VOICE_NOTE_MIN_MILLISECONDS. */
  tooShort: string;
  /** The upload failed without a message of its own. */
  failed: string;
}>;

export const MIC_BLOCKED_MESSAGE = "Microphone access was blocked. Allow it in the browser and try again.";
export const NOTHING_RECORDED_MESSAGE = "Nothing was recorded. Try again.";
export const DEAD_MIC_MESSAGE = "The microphone sent no sound at all. It may be muted, or the browser may be using a different microphone - check the mic icon in the address bar, then try again.";

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
 * Samples the microphone level while recording, so the speaker can see the mic
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

export type UseVoiceRecorderOptions<T> = Readonly<{
  /** The file name stem: "voice-note" gives voice-note.wav / .webm / .mp4. */
  filenameStem: string;
  messages: VoiceRecorderMessages;
  /** Sends the recording; a thrown Error's message is shown to the speaker. */
  upload: (recording: Blob, filename: string) => Promise<T>;
  /** Receives the result, only while the caller is still mounted. */
  onResult: (result: T) => void;
  /** Runs when a new recording is started, before anything else. */
  onStart?: () => void;
}>;

export type VoiceRecorder = Readonly<{
  state: VoiceRecorderState;
  secondsLeft: number;
  level: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}>;

export function useVoiceRecorder<T>(options: UseVoiceRecorderOptions<T>): VoiceRecorder {
  const [state, setState] = useState<VoiceRecorderState>("idle");
  const [secondsLeft, setSecondsLeft] = useState(VOICE_NOTE_MAX_SECONDS);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<VoiceRecorderState>("idle");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const meterRef = useRef<LevelMeter | null>(null);
  const stopTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  // Callers re-create their callbacks as their fields change; the latest ones
  // must receive a result that arrives after those changes.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const moveTo = useCallback((next: VoiceRecorderState) => {
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

  // A recorder left running would keep the microphone open after the caller
  // closes, and a late result must not write into a closed screen.
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
    optionsRef.current.onStart?.();
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setError(optionsRef.current.messages.unsupported);
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
      if (mountedRef.current) setError(MIC_BLOCKED_MESSAGE);
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
      setError(optionsRef.current.messages.unsupported);
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
        setError(NOTHING_RECORDED_MESSAGE);
        return;
      }
      if (Date.now() - startedAt < VOICE_NOTE_MIN_MILLISECONDS) {
        moveTo("idle");
        setError(optionsRef.current.messages.tooShort);
        return;
      }
      if (verdict === "silent") {
        moveTo("idle");
        setError(DEAD_MIC_MESSAGE);
        return;
      }
      moveTo("processing");
      const { filenameStem } = optionsRef.current;
      toTranscriptionWav(recording)
        .then((wav) => wav
          ? optionsRef.current.upload(wav, `${filenameStem}.wav`)
          : optionsRef.current.upload(recording, `${filenameStem}.${recording.type.includes("mp4") ? "mp4" : "webm"}`))
        .then((result) => {
          if (!mountedRef.current) return;
          optionsRef.current.onResult(result);
        })
        .catch((caught: unknown) => {
          if (mountedRef.current) setError(caught instanceof Error ? caught.message : optionsRef.current.messages.failed);
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

  return { state, secondsLeft, level, error, start, stop };
}
