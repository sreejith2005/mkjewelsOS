import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { completionRate, type ProgressCounts } from "@jewelos/data/taskControl/filters";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Card } from "@/ui/Card";
import { Pressable } from "@/ui/Pressable";
import { Text } from "@/ui/Text";

export type Tone = "neutral" | "good" | "warn" | "bad";

/** The five tiles above the Overview panel, with web's label and hint text. */
export const StatTile = memo(function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string;
  hint: string;
  tone?: Tone;
}) {
  const styles = useStyles();
  return (
    <Card style={styles.tile}>
      <Text tone="muted" variant="caption">
        {label}
      </Text>
      <Text
        tone={tone === "good" ? "success" : tone === "warn" ? "warning" : tone === "bad" ? "danger" : "default"}
        variant="title"
        weight="semibold"
      >
        {value}
      </Text>
      <Text tone="muted" variant="caption">
        {hint}
      </Text>
    </Card>
  );
});

/**
 * The completion share with the overdue share of the same bar called out, as
 * the web `CompletionBar` draws it.
 */
export const CompletionBar = memo(function CompletionBar({ row }: { row: ProgressCounts }) {
  const theme = useAppTheme();
  const styles = useStyles();
  const done = completionRate(row);
  const late = row.assigned === 0 ? 0 : Math.round((row.overdue / row.assigned) * 100);
  return (
    <View style={styles.barRow}>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${done}%`, backgroundColor: theme.colors.success }]} />
        <View
          style={[styles.fill, { width: `${Math.min(late, 100 - done)}%`, backgroundColor: theme.colors.danger }]}
        />
      </View>
      <Text tone="muted" variant="caption">{`${done}%`}</Text>
    </View>
  );
});

/**
 * One row of the web `ProgressTable`. A phone cannot show a seven-column table,
 * so the columns become a heading plus a counts strip — the same five numbers,
 * in the same order: assigned, completed, remaining, overdue, rate.
 */
export const ProgressRow = memo(function ProgressRow({
  title,
  subtitle,
  row,
  onPress,
}: {
  title: string;
  subtitle?: string;
  row: ProgressCounts;
  onPress?: () => void;
}) {
  const styles = useStyles();
  const body = (
    <>
      <Text numberOfLines={1} weight="semibold">
        {title}
      </Text>
      {subtitle ? (
        <Text numberOfLines={1} tone="muted" variant="caption">
          {subtitle}
        </Text>
      ) : null}
      <View style={styles.counts}>
        <Count label="Assigned" value={row.assigned} />
        <Count label="Completed" tone="success" value={row.completed} />
        <Count label="Remaining" value={row.remaining} />
        <Count label="Overdue" tone={row.overdue > 0 ? "danger" : "muted"} value={row.overdue} />
      </View>
      <CompletionBar row={row} />
    </>
  );
  if (!onPress) return <Card>{body}</Card>;
  return (
    <Pressable
      accessibilityHint="Filters the whole workspace to this person"
      accessibilityLabel={title}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      <Card>{body}</Card>
    </Pressable>
  );
});

function Count({ label, value, tone = "muted" }: { label: string; value: number; tone?: "muted" | "success" | "danger" }) {
  const styles = useStyles();
  return (
    <View style={styles.count}>
      <Text tone="muted" variant="caption">
        {label}
      </Text>
      <Text tone={tone === "muted" ? "default" : tone} weight="semibold">
        {String(value)}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((theme) =>
  StyleSheet.create({
    tile: { flexGrow: 1, flexBasis: "30%", gap: 2 },
    barRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, marginTop: theme.space.xs },
    track: {
      flex: 1,
      height: 6,
      borderRadius: theme.radius.pill,
      backgroundColor: theme.colors.taskMuted,
      overflow: "hidden",
      flexDirection: "row",
    },
    fill: { height: "100%" },
    counts: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm, marginTop: theme.space.xs },
    count: { flexGrow: 1, flexBasis: "22%" },
    pressed: { opacity: 0.8 },
  }),
);
