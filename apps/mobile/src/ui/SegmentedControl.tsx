import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { makeStyles } from "@/theme/makeStyles";
import { Text } from "@/ui/Text";

export type SegmentedControlProps<T extends string> = Readonly<{
  options: readonly Readonly<{ value: T; label: string }>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel: string;
}>;

/**
 * The touch replacement for a row of desktop tabs or a `<select>` with a
 * handful of choices. It scrolls horizontally rather than shrinking its
 * segments, because a segment narrower than a fingertip is not a control.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: SegmentedControlProps<T>) {
  const styles = useStyles();
  return (
    <ScrollView
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tablist"
      contentContainerStyle={styles.row}
      horizontal
      showsHorizontalScrollIndicator={false}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            accessibilityLabel={option.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            key={option.value}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [styles.segment, selected && styles.selected, pressed && styles.pressed]}
          >
            <View>
              <Text
                numberOfLines={1}
                tone={selected ? "inverse" : "warm"}
                variant="small"
                weight="semibold"
              >
                {option.label}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  row: { flexDirection: "row", gap: theme.space.sm, paddingRight: theme.space.md },
  segment: {
    minHeight: 40,
    justifyContent: "center",
    paddingHorizontal: theme.space.md,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  selected: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  pressed: { opacity: 0.8 },
}));
