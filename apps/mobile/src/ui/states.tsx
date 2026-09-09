import { ActivityIndicator, StyleSheet, View } from "react-native";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

/**
 * The three answers every data-backed screen owes the viewer. A screen that
 * renders nothing while it decides is the one outcome none of these allow.
 */

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  const theme = useAppTheme();
  const styles = useStyles();
  return (
    <View accessibilityLabel={label} accessibilityRole="progressbar" style={styles.centre}>
      <ActivityIndicator color={theme.colors.primary} size="large" />
      <Text tone="muted" variant="body">
        {label}
      </Text>
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
  title = "Something went wrong",
}: {
  message: string;
  onRetry?: () => void;
  title?: string;
}) {
  const styles = useStyles();
  return (
    <View accessibilityLiveRegion="polite" style={styles.centre}>
      <Text tone="danger" variant="subtitle" weight="semibold">
        {title}
      </Text>
      <Text style={styles.centred} tone="muted" variant="body">
        {message}
      </Text>
      {onRetry ? <Button label="Try again" onPress={onRetry} variant="secondary" /> : null}
    </View>
  );
}

export function EmptyState({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.centre}>
      <Text tone="warm" variant="subtitle" weight="semibold">
        {title}
      </Text>
      {message ? (
        <Text style={styles.centred} tone="muted" variant="body">
          {message}
        </Text>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="secondary" /> : null}
    </View>
  );
}

/** An inline notice: a rule violation, a warning, or a confirmation. */
export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "danger" | "success" | "warning";
  children: string;
}) {
  const styles = useStyles();
  return (
    <View accessibilityLiveRegion={tone === "danger" ? "assertive" : "polite"} style={[styles.banner, styles[tone]]}>
      <Text
        tone={tone === "danger" ? "danger" : tone === "success" ? "success" : tone === "warning" ? "warning" : "warm"}
        variant="small"
      >
        {children}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  centre: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.space.md,
    padding: theme.space.xl,
  },
  centred: { textAlign: "center" },
  banner: {
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  info: { backgroundColor: theme.colors.primarySoft, borderColor: theme.colors.border },
  danger: { backgroundColor: theme.colors.dangerSoft, borderColor: theme.colors.danger },
  success: { backgroundColor: theme.colors.successSoft, borderColor: theme.colors.success },
  warning: { backgroundColor: theme.colors.warningSoft, borderColor: theme.colors.warning },
}));
