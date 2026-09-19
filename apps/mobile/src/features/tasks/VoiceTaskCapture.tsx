import { useCallback, useEffect, useReducer, useRef } from "react";
import { StyleSheet, View } from "react-native";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import { File } from "expo-file-system";
import { interpretTaskVoiceNote, type VoiceTaskInterpretation } from "@jewelos/data/tasks/voice";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Banner } from "@/ui/states";
import { Text } from "@/ui/Text";
import {
  initialVoiceCaptureState,
  reduceVoiceCapture,
  VOICE_NOTE_MAX_SECONDS,
} from "./voiceCaptureModel";

export function VoiceTaskCapture({ onInterpreted }: { onInterpreted: (value: VoiceTaskInterpretation) => void }) {
  const styles = useStyles();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 250);
  const [state, dispatch] = useReducer(reduceVoiceCapture, initialVoiceCaptureState);
  const finishing = useRef(false);
  const temporaryUri = useRef<string | null>(null);

  const restoreAudioMode = useCallback(async () => {
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
  }, []);

  const finishRecording = useCallback(async () => {
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
      const body = await file.arrayBuffer();
      dispatch({ type: "stopped", size: body.byteLength });
      if (body.byteLength === 0) return;
      const interpretation = await interpretTaskVoiceNote({
        body,
        name: "voice-note.m4a",
        size: body.byteLength,
        type: "audio/mp4",
      });
      dispatch({ type: "interpreted", transcript: interpretation.transcript });
      onInterpreted(interpretation);
    } catch (caught) {
      dispatch({ type: "failed", message: caught instanceof Error ? caught.message : "Unable to interpret the voice note." });
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
  }, [onInterpreted, recorder, restoreAudioMode]);

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
    if (state.status === "recording" && state.stopRequested) void finishRecording();
  }, [finishRecording, state.status, state.stopRequested]);

  useEffect(() => () => {
    if (recorder.getStatus().isRecording) void recorder.stop();
    const uri = temporaryUri.current;
    if (uri) {
      try { new File(uri).delete(); } catch { /* best effort */ }
    }
    void restoreAudioMode();
  }, [recorder, restoreAudioMode]);

  const recording = state.status === "recording" || recorderState.isRecording;
  return (
    <Card accessibilityLabel="Assign by voice">
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text variant="subtitle" weight="semibold">
            {recording ? `Recording · ${state.secondsLeft}s left` : state.status === "interpreting" ? "Interpreting…" : "Assign by voice"}
          </Text>
          <Text tone="muted" variant="small">
            {recording
              ? "Say the task, who it is for, and when it is due."
              : `Record up to ${VOICE_NOTE_MAX_SECONDS} seconds. You review everything before assigning.`}
          </Text>
        </View>
        <Button
          busy={state.status === "interpreting"}
          label={recording ? "Stop" : state.transcript ? "Record again" : "Record"}
          onPress={() => recording ? void finishRecording() : void start()}
          variant={recording ? "danger" : "secondary"}
        />
      </View>
      {state.transcript ? <Text style={styles.transcript} tone="muted" variant="small">“{state.transcript}”</Text> : null}
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
    </Card>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
  copy: { flex: 1, minWidth: 0, gap: theme.space.xs },
  transcript: { fontStyle: "italic" },
}));
