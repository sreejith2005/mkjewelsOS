import { forwardRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from "react-native";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

export type TextFieldProps = Omit<TextInputProps, "style"> &
  Readonly<{
    label: string;
    helperText?: string;
    errorText?: string;
    required?: boolean;
    /** Renders a show/hide control instead of a permanently masked field. */
    secure?: boolean;
  }>;

/**
 * A labelled text input. The label is a real `<Text>` tied to the input by
 * `accessibilityLabel` rather than a placeholder, because a placeholder
 * disappears the moment someone starts typing and takes the question with it.
 */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, helperText, errorText, required = false, secure = false, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const theme = useAppTheme();
  const styles = useStyles();
  const [revealed, setRevealed] = useState(false);

  return (
    <View style={styles.group}>
      <Text tone="warm" variant="label" weight="medium">
        {label}
        {required ? " *" : ""}
      </Text>
      {helperText ? (
        <Text tone="muted" variant="caption">
          {helperText}
        </Text>
      ) : null}

      <View style={styles.row}>
        <TextInput
          accessibilityLabel={required ? `${label}, required` : label}
          maxFontSizeMultiplier={1.4}
          placeholderTextColor={theme.colors.textMuted}
          ref={ref}
          secureTextEntry={secure && !revealed}
          {...rest}
          onBlur={(event) => {
            setFocused(false);
            rest.onBlur?.(event);
          }}
          onFocus={(event) => {
            setFocused(true);
            rest.onFocus?.(event);
          }}
          style={[
            styles.input,
            focused && styles.inputFocused,
            errorText ? styles.inputError : null,
            rest.multiline ? styles.multiline : null,
            secure ? styles.inputWithAction : null,
          ]}
        />
        {secure ? (
          <Pressable
            accessibilityLabel={revealed ? "Hide password" : "Show password"}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setRevealed((current) => !current)}
            style={styles.action}
          >
            <Text tone="primary" variant="small" weight="semibold">
              {revealed ? "Hide" : "Show"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {errorText ? (
        <Text accessibilityLiveRegion="polite" tone="danger" variant="caption">
          {errorText}
        </Text>
      ) : null}
    </View>
  );
});

const useStyles = makeStyles((theme) => StyleSheet.create({
  group: { gap: theme.space.xs },
  row: { position: "relative", justifyContent: "center" },
  input: {
    minHeight: theme.touchTarget,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    fontSize: theme.fontSize.body,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  inputFocused: { borderColor: theme.colors.borderStrong },
  inputError: { borderColor: theme.colors.danger },
  inputWithAction: { paddingRight: 68 },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  action: {
    position: "absolute",
    right: theme.space.sm,
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
}));
