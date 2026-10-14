import { StyleSheet, View } from "react-native";
import { VOICE_TASK_SPEAKING_EXAMPLE, VOICE_TASK_SPEAKING_GUIDE } from "@jewelos/core";
import { interpretTaskVoiceNote, type VoiceTaskInterpretation } from "@jewelos/data/tasks/voice";
import { useVoiceNoteRecorder } from "@/features/voice/useVoiceNoteRecorder";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Banner } from "@/ui/states";
import { Text } from "@/ui/Text";
import { VOICE_NOTE_MAX_SECONDS } from "./voiceCaptureModel";

const interpretationOf = (interpretation: VoiceTaskInterpretation) => interpretation.transcript;

export function VoiceTaskCapture({ onInterpreted }: { onInterpreted: (value: VoiceTaskInterpretation) => void }) {
  const styles = useStyles();
  // The recording lifecycle is shared with Ask Kiara's mic; Tasks keeps its own upload and wording.
  const { state, recording, start, finish: finishRecording } = useVoiceNoteRecorder({
    fileName: "voice-note.m4a",
    upload: interpretTaskVoiceNote,
    transcriptOf: interpretationOf,
    onResult: onInterpreted,
    failureMessage: "Unable to interpret the voice note.",
  });
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
      {recording || (state.status !== "interpreting" && !state.transcript) ? <VoiceSpeakingGuide active={recording} /> : null}
      {state.transcript ? <Text style={styles.transcript} tone="muted" variant="small">“{state.transcript}”</Text> : null}
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
    </Card>
  );
}

/**
 * What to say, in order, so the author does not forget the assignee or the
 * deadline mid-sentence. Same list as the web card; the composer's gap rules
 * still check the interpreted draft.
 */
function VoiceSpeakingGuide({ active }: { active: boolean }) {
  const styles = useStyles();
  return (
    <View accessibilityLabel="What to say" style={styles.guide}>
      <Text variant="caption" weight="semibold">{active ? "Speak in this order" : "What to say"}</Text>
      {VOICE_TASK_SPEAKING_GUIDE.map((step, index) => (
        <View key={step.id} style={styles.step}>
          <View style={[styles.stepNumber, step.required ? styles.stepNumberRequired : null]}>
            <Text variant="caption" weight="semibold">{index + 1}</Text>
          </View>
          <View style={styles.copy}>
            <Text variant="small" weight="semibold">
              {step.label}
              <Text tone={step.required ? "danger" : "muted"} variant="caption">{step.required ? "  Required" : "  Optional"}</Text>
            </Text>
            <Text tone="muted" variant="caption">{step.hint}</Text>
          </View>
        </View>
      ))}
      <Text style={styles.transcript} tone="muted" variant="caption">Example: {VOICE_TASK_SPEAKING_EXAMPLE}</Text>
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: theme.space.md },
  copy: { flex: 1, minWidth: 0, gap: theme.space.xs },
  transcript: { fontStyle: "italic" },
  guide: { gap: theme.space.sm, borderRadius: theme.radius.md, backgroundColor: theme.colors.background, padding: theme.space.sm },
  step: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  stepNumber: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.surface },
  stepNumberRequired: { backgroundColor: theme.colors.primarySoft },
}));
