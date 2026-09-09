import { Pressable, StyleSheet, View } from "react-native";
import { makeStyles } from "@/theme/makeStyles";
import { Text } from "@/ui/Text";

export type ToggleFieldProps = Readonly<{
  label: string;
  value: boolean;
  disabled: boolean;
  required: boolean;
  helperText?: string;
  onChange: (value: boolean) => void;
}>;

/**
 * A single yes/no answer. The whole row is the target, and the state is carried
 * by a mark as well as a colour so it reads without relying on hue.
 */
export function ToggleField({ label, value, disabled, required, helperText, onChange }: ToggleFieldProps) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityLabel={required ? `${label}, required` : label}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <View style={[styles.box, value && styles.boxChecked]}>
        {value ? (
          <Text tone="inverse" variant="small" weight="bold">
            ✓
          </Text>
        ) : null}
      </View>
      <View style={styles.labels}>
        <Text variant="body">
          {label}
          {required ? " *" : ""}
        </Text>
        {helperText ? (
          <Text tone="muted" variant="caption">
            {helperText}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  row: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  box: {
    width: 22,
    height: 22,
    borderRadius: theme.radius.sm,
    borderWidth: 1.5,
    borderColor: theme.colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  labels: { flex: 1, minWidth: 0, gap: 2 },
}));
