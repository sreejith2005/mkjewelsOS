import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { Pressable } from "@/ui/Pressable";
import { makeStyles } from "@/theme/makeStyles";
import { Text } from "@/ui/Text";

type CardAccent = "none" | "primary" | "danger" | "success" | "warning";
type BadgeTone = "neutral" | "primary" | "danger" | "success" | "warning";

export type CardProps = Readonly<{
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** A coloured rail down the left edge, for status at a glance. */
  accent?: CardAccent;
  style?: ViewStyle;
}>;

/**
 * The unit a mobile list is built from, replacing a desktop table row. A whole
 * card is the touch target, so nothing depends on hitting a small icon.
 */
export function Card({ children, onPress, accessibilityLabel, accessibilityHint, accent = "none", style }: CardProps) {
  const styles = useStyles();
  const accentStyles: Record<Exclude<CardAccent, "none">, ViewStyle> = {
    primary: styles.accentPrimary,
    danger: styles.accentDanger,
    success: styles.accentSuccess,
    warning: styles.accentWarning,
  };
  const content = (
    <View style={[styles.card, accent !== "none" && accentStyles[accent], style]}>{children}</View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      accessibilityRole="button"
      {...(accessibilityLabel === undefined ? {} : { accessibilityLabel })}
      {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
      onPress={onPress}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {content}
    </Pressable>
  );
}

/** A short status word. The colour is a second signal, never the only one. */
export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: BadgeTone;
}) {
  const styles = useStyles();
  const badgeTones: Record<BadgeTone, ViewStyle> = {
    neutral: styles.badgeNeutral,
    primary: styles.badgePrimary,
    danger: styles.badgeDanger,
    success: styles.badgeSuccess,
    warning: styles.badgeWarning,
  };
  return (
    <View style={[styles.badge, badgeTones[tone]]}>
      <Text
        numberOfLines={1}
        tone={tone === "neutral" ? "muted" : tone}
        variant="caption"
        weight="semibold"
      >
        {label}
      </Text>
    </View>
  );
}

/** A labelled value inside a card, replacing a table column. */
export function CardRow({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel} tone="muted" variant="caption">
        {label}
      </Text>
      <Text style={styles.rowValue} tone="warm" variant="small">
        {value}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  pressed: { opacity: 0.8 },
  badge: {
    alignSelf: "flex-start",
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    paddingHorizontal: theme.space.sm,
    paddingVertical: 3,
  },
  // `minWidth: 0` on the value keeps a long name wrapping inside the card
  // instead of stretching the row past the screen edge.
  row: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  rowLabel: { width: 104 },
  rowValue: { flex: 1, minWidth: 0 },
  accentPrimary: { borderLeftWidth: 3, borderLeftColor: theme.colors.primary },
  accentDanger: { borderLeftWidth: 3, borderLeftColor: theme.colors.danger },
  accentSuccess: { borderLeftWidth: 3, borderLeftColor: theme.colors.success },
  accentWarning: { borderLeftWidth: 3, borderLeftColor: theme.colors.warning },
  badgeNeutral: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
  badgePrimary: { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border },
  badgeDanger: { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
  badgeSuccess: { backgroundColor: theme.colors.successSoft, borderColor: theme.colors.success },
  badgeWarning: { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warning },
}));
