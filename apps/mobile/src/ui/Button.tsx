import { ActivityIndicator, Pressable, StyleSheet, View, type ViewStyle } from "react-native";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "medium" | "large";

export type ButtonProps = Readonly<{
  label: string;
  onPress: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  busy?: boolean;
  /** Stretch to the width of the container, as a form's submit control should. */
  full?: boolean;
  accessibilityHint?: string;
  style?: ViewStyle;
  icon?: React.ReactNode;
}>;

export function Button({
  label,
  onPress,
  variant = "primary",
  size = "medium",
  disabled = false,
  busy = false,
  full = false,
  accessibilityHint,
  style,
  icon,
}: ButtonProps) {
  const theme = useAppTheme();
  const styles = useStyles();
  const inactive = disabled || busy;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        size === "large" ? styles.large : styles.medium,
        styles[variant],
        full && styles.full,
        pressed && !inactive && styles.pressed,
        inactive && styles.inactive,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={variant === "primary" ? theme.colors.background : theme.colors.primary} size="small" />
      ) : (
        <View style={styles.content}>
          {icon}
          <Text
            numberOfLines={1}
            tone={variant === "primary" ? "inverse" : variant === "danger" ? "danger" : "primary"}
            variant="body"
            weight="semibold"
          >
            {label}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  // `minHeight` rather than a fixed height: a label that wraps at a large OS
  // font size must grow the control instead of overflowing it.
  base: {
    minHeight: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    borderWidth: 1,
    paddingHorizontal: theme.space.lg,
  },
  medium: { minHeight: theme.touchTarget, paddingVertical: theme.space.sm },
  large: { minHeight: 56, paddingVertical: theme.space.md },
  full: { alignSelf: "stretch" },
  content: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  pressed: { opacity: 0.75 },
  inactive: { opacity: 0.45 },
  primary: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  secondary: { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border },
  ghost: { backgroundColor: "transparent", borderColor: "transparent" },
  danger: { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
}));
