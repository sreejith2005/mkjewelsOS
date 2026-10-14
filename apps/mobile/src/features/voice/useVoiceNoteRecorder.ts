import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import type { NativeVoiceRecording } from "@jewelos/data/tasks/voice";
import {
  initialVoiceCaptureState,
  reduceVoiceCapture,
  VOICE_NOTE_MAX_SECONDS,
  type VoiceCaptureState,
} from "@/features/tasks/voiceCaptureModel";

export type VoiceNoteRecorder = Readonly<{
  state: VoiceCaptureState;
  /** True while the microphone is recording (reducer or native recorder). */
  recording: boolean;
  start: () => Promise<void>;
  /** Stops and uploads the recording. Safe to call twice. */
  finish: () => Promise<void>;
}>;

/**
 * The native voice-note lifecycle, shared by Tasks voice assignment and Ask
 * Kiara voice questions: microphone permission, recording up to
 * VOICE_NOTE_MAX_SECONDS with an automatic stop, uploading the file by URI,
 * deleting the cached file, and restoring the audio mode. Each caller passes
 * its own upload (interpret-task-voice, ask-kiara/transcribe) and decides what
 * the result does; nothing here sends anything else.
 */
export function useVoiceNoteRecorder<T>({ fileName, upload, transcriptOf, onResult, failureMessage }: {
  fileName: string;
  upload: (recording: NativeVoiceRecording) => Promise<T>;
  transcriptOf: (result: T) => string;
  onResult: (result: T) => void;
  failureMessage: string;
}): VoiceNoteRecorder {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [state, dispatch] = useReducer(reduceVoiceCapture, initialVoiceCaptureState);
  const finishing = useRef(false);
  const temporaryUri = useRef<string | null>(null);
  const callbacks = useRef({ upload, transcriptOf, onResult, failureMessage, fileName });
  callbacks.current = { upload, transcriptOf, onResult, failureMessage, fileName };

  const restoreAudioMode = useCallback(async () => {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
  }, []);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    let file: File | null = null;
    try {
      if (recorder.getStatus().isRecording) await recorder.stop();
      const uri = recorder.uri;
      temporaryUri.current = uri;
      if (!uri) {
        dispatch({ type: "stopped", size: 0 });
        return;
      }
      file = new File(uri);
      const size = file.size;
      dispatch({ type: "stopped", size });
      if (size === 0) return;
      const result = await callbacks.current.upload({ uri, name: callbacks.current.fileName, size, type: "audio/mp4" });
      dispatch({ type: "interpreted", transcript: callbacks.current.transcriptOf(result) });
      callbacks.current.onResult(result);
    } catch (caught) {
      dispatch({ type: "failed", message: caught instanceof Error ? caught.message : callbacks.current.failureMessage });
    } finally {
      try {
        file?.delete();
      } catch {
        // Cache cleanup is best effort; no business record points at the file.
      }
      temporaryUri.current = null;
      await restoreAudioMode();
      finishing.current = false;
    }
  }, [recorder, restoreAudioMode]);

  const start = useCallback(async () => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        dispatch({ type: "permission_denied" });
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: VOICE_NOTE_MAX_SECONDS });
      dispatch({ type: "start" });
    } catch (caught) {
      await restoreAudioMode();
      dispatch({ type: "failed", message: caught instanceof Error ? caught.message : "Recording could not start." });
    }
  }, [recorder, restoreAudioMode]);

  useEffect(() => {
    if (state.status !== "recording") return;
    const timer = setInterval(() => dispatch({ type: "tick" }), 1_000);
    return () => clearInterval(timer);
  }, [state.status]);

  useEffect(() => {
    if (state.status === "recording" && state.stopRequested) void finish();
  }, [finish, state.status, state.stopRequested]);

  useEffect(() => () => {
    if (recorder.getStatus().isRecording) void recorder.stop();
    const uri = temporaryUri.current;
    if (uri) {
      try { new File(uri).delete(); } catch { /* best effort */ }
    }
    void restoreAudioMode();
  }, [recorder, restoreAudioMode]);

  return { state, recording: state.status === "recording" || recorderState.isRecording, start, finish };
}
