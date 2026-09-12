import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Sheet } from "@/ui/Sheet";
import { TextField } from "@/ui/TextField";

export type PromptSheetProps = Readonly<{
  visible: boolean;
  /** The question, used verbatim as the sheet title and the field label. */
  title: string;
  submitLabel?: string;
  multiline?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}>;

/**
 * The touch replacement for `window.prompt`.
 *
 * `Alert.prompt` exists only on iOS, so an Android port of a page that asks for
 * a completion remark or a rejection reason has to draw its own. Like the
 * browser's prompt, an empty answer is refused rather than submitted: every
 * caller here treats a blank string as a cancellation, and a control that
 * silently did nothing would read as a broken button.
 */
export function PromptSheet({
  visible,
  title,
  submitLabel = "Submit",
  multiline = false,
  busy = false,
  onCancel,
  onSubmit,
}: PromptSheetProps) {
  const styles = useStyles();
  const [value, setValue] = useState("");

  // Each opening asks its own question; a previous answer must not be sitting
  // in the field when the next one opens.
  useEffect(() => {
    if (visible) setValue("");
  }, [visible]);

  return (
    <Sheet onClose={onCancel} title={title} visible={visible}>
      <View style={styles.body}>
        <TextField
          autoFocus
          label={title}
          multiline={multiline}
          onChangeText={setValue}
          onSubmitEditing={() => value.trim() && onSubmit(value.trim())}
          value={value}
        />
        <View style={styles.actions}>
          <Button label="Cancel" onPress={onCancel} variant="secondary" />
          <Button
            busy={busy}
            disabled={!value.trim()}
            label={submitLabel}
            onPress={() => onSubmit(value.trim())}
            style={styles.grow}
          />
        </View>
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((theme) =>
  StyleSheet.create({
    body: { gap: theme.space.md },
    actions: { flexDirection: "row", gap: theme.space.sm },
    grow: { flex: 1 },
  }),
);
