import { ActivityIndicator, StyleSheet, View } from "react-native";
import { Mic, Square } from "lucide-react-native";
import { transcribeKiaraVoice, type KiaraTranscript } from "@jewelos/data/assistant/api";
import { VOICE_NOTE_MAX_SECONDS } from "@/features/tasks/voiceCaptureModel";
import { useVoiceNoteRecorder, type VoiceNoteRecorder } from "@/features/voice/useVoiceNoteRecorder";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Pressable } from "@/ui/Pressable";
import { Banner } from "@/ui/states";
import { Text } from "@/ui/Text";

const transcriptText = (transcript: KiaraTranscript) => transcript.text;

/**
 * Ask Kiara's voice input on Android (Phase 8), on the same recorder as Tasks
 * voice. The recording becomes text in the input box; it is never sent on its
 * own. Shown only with `assistant.voice`, which the transcribe function and
 * `consume_my_voice_quota` check again.
 */
export function useKiaraVoice(onTranscript: (text: string) => void): VoiceNoteRecorder {
  return useVoiceNoteRecorder({
    fileName: "voice-question.m4a",
    upload: transcribeKiaraVoice,
    transcriptOf: transcriptText,
    onResult: (transcript) => onTranscript(transcript.text),
    failureMessage: "Voice input is unavailable right now. Please type your question.",
  });
}

export function KiaraMicButton({ disabled, voice }: { disabled: boolean; voice: VoiceNoteRecorder }) {
  const styles = useStyles();
  const theme = useAppTheme();
  const busy = voice.state.status === "interpreting";
  return (
    <Pressable
      accessibilityLabel={voice.recording ? "Stop recording" : "Ask by voice"}
      accessibilityRole="button"
      accessibilityState={{ disabled: busy || (disabled && !voice.recording), busy }}
      disabled={busy || (disabled && !voice.recording)}
      onPress={() => voice.recording ? void voice.finish() : void voice.start()}
      style={[styles.button, voice.recording ? styles.recording : null, busy || (disabled && !voice.recording) ? styles.inactive : null]}
    >
      {busy ? <ActivityIndicator color={theme.colors.primary} size="small" />
        : voice.recording ? <Square color={theme.colors.danger} size={20} />
        : <Mic color={theme.colors.text} size={20} />}
    </Pressable>
  );
}

/** Recording state, the time left, and any error, above the input row. Same wording as web. */
export function KiaraVoiceStatus({ voice }: { voice: VoiceNoteRecorder }) {
  const styles = useStyles();
  if (voice.recording) {
    return (
      <View accessibilityLiveRegion="polite" style={styles.status}>
        <Text variant="small" weight="semibold">Recording · {voice.state.secondsLeft}s left</Text>
        <Text tone="muted" variant="caption">Speak in Hindi, Hinglish, or English (up to {VOICE_NOTE_MAX_SECONDS} seconds). Tap stop when done. You can edit the words before sending.</Text>
      </View>
    );
  }
  if (voice.state.status === "interpreting") return <View style={styles.status}><Text variant="small">Writing down what you said…</Text></View>;
  if (voice.state.error) return <Banner tone="danger">{voice.state.error}</Banner>;
  return null;
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  button: {
    width: theme.touchTarget,
    height: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  recording: { borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerSoft },
  inactive: { opacity: 0.45 },
  status: { borderRadius: theme.radius.md, backgroundColor: theme.colors.background, padding: theme.space.sm, gap: theme.space.xs },
}));
