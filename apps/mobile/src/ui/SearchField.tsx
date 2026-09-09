import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

export type SearchFieldProps = Readonly<{
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  onSubmit?: () => void;
}>;

/** A single-line filter with a clear control, sized as a real touch target. */
export function SearchField({ value, onChangeText, placeholder, accessibilityLabel, onSubmit }: SearchFieldProps) {
  const theme = useAppTheme();
  const styles = useStyles();
  return (
    <View style={styles.wrapper}>
      <TextInput
        accessibilityLabel={accessibilityLabel}
        autoCapitalize="none"
        autoCorrect={false}
        clearButtonMode="never"
        maxFontSizeMultiplier={1.4}
        onChangeText={onChangeText}
        {...(onSubmit ? { onSubmitEditing: onSubmit } : {})}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.textMuted}
        returnKeyType="search"
        style={styles.input}
        value={value}
      />
      {value ? (
        <Pressable
          accessibilityLabel="Clear search"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => onChangeText("")}
          style={styles.clear}
        >
          <Text tone="muted" variant="body">
            ✕
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  wrapper: { position: "relative", justifyContent: "center" },
  input: {
    minHeight: theme.touchTarget,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    color: theme.colors.text,
    fontSize: theme.fontSize.body,
    paddingHorizontal: theme.space.md,
    paddingRight: theme.touchTarget,
    paddingVertical: theme.space.sm,
  },
  clear: {
    position: "absolute",
    right: 0,
    minHeight: theme.touchTarget,
    minWidth: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
}));
