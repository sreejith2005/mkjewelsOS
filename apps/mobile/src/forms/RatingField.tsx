import { StyleSheet, View } from "react-native";
import { Pressable } from "@/ui/Pressable";
import { makeStyles } from "@/theme/makeStyles";
import { Text } from "@/ui/Text";

export type RatingFieldProps = Readonly<{
  label: string;
  value: number | null;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}>;

/**
 * A row of stars. Each star is its own 48dp target rather than a slider,
 * because a slider on a phone makes an exact whole number hard to land on.
 */
export function RatingField({ label, value, max, disabled, onChange }: RatingFieldProps) {
  const styles = useStyles();
  const scale = Array.from({ length: Math.max(1, Math.min(10, max)) }, (_unused, index) => index + 1);
  return (
    <View
      accessibilityLabel={`${label}, ${value ?? "not"} out of ${scale.length}`}
      accessibilityRole="adjustable"
      style={styles.row}
    >
      {scale.map((step) => {
        const filled = value !== null && step <= value;
        return (
          <Pressable
            accessibilityLabel={`${step} of ${scale.length}`}
            accessibilityRole="button"
            disabled={disabled}
            key={step}
            onPress={() => onChange(step)}
            style={({ pressed }) => [styles.star, pressed && styles.pressed, disabled && styles.disabled]}
          >
            <Text tone={filled ? "primary" : "muted"} variant="title">
              {filled ? "★" : "☆"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap" },
  star: { minHeight: theme.touchTarget, minWidth: theme.touchTarget, alignItems: "center", justifyContent: "center" },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },
}));
