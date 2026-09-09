import { StyleSheet, Text as RNText, type TextProps, type TextStyle } from "react-native";
import { makeStyles } from "@/theme/makeStyles";

type Variant = "display" | "heading" | "title" | "subtitle" | "body" | "small" | "caption" | "label";
type Tone = "default" | "muted" | "warm" | "primary" | "danger" | "success" | "warning" | "inverse";

export type AppTextProps = TextProps &
  Readonly<{
    variant?: Variant;
    tone?: Tone;
    weight?: "regular" | "medium" | "semibold" | "bold";
    /** Cap the rendered lines so one long title cannot push a card off screen. */
    numberOfLines?: number;
  }>;

/**
 * Every piece of text in the app goes through here so type size, colour, and
 * weight stay on the shared scale. It also caps how far the OS font-size
 * setting may scale text: past about 1.4x a dense task card stops fitting at
 * all, which helps nobody, while below that the app follows the device.
 */
export function Text({ variant = "body", tone = "default", weight = "regular", style, ...rest }: AppTextProps) {
  const styles = useStyles();
  const toneStyles: Record<Tone, TextStyle> = {
    default: styles.toneDefault,
    muted: styles.toneMuted,
    warm: styles.toneWarm,
    primary: styles.tonePrimary,
    danger: styles.toneDanger,
    success: styles.toneSuccess,
    warning: styles.toneWarning,
    inverse: styles.toneInverse,
  };
  return (
    <RNText
      maxFontSizeMultiplier={1.4}
      style={[styles[variant], toneStyles[tone], weightStyles[weight], style]}
      {...rest}
    />
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  display: { fontSize: theme.fontSize.display, lineHeight: theme.fontSize.display * 1.2, letterSpacing: 0.5 },
  heading: { fontSize: theme.fontSize.heading, lineHeight: theme.fontSize.heading * 1.25 },
  title: { fontSize: theme.fontSize.title, lineHeight: theme.fontSize.title * 1.3 },
  subtitle: { fontSize: theme.fontSize.subtitle, lineHeight: theme.fontSize.subtitle * 1.35 },
  body: { fontSize: theme.fontSize.body, lineHeight: theme.fontSize.body * 1.45 },
  small: { fontSize: theme.fontSize.small, lineHeight: theme.fontSize.small * 1.4 },
  caption: { fontSize: theme.fontSize.caption, lineHeight: theme.fontSize.caption * 1.4 },
  label: { fontSize: theme.fontSize.small, lineHeight: theme.fontSize.small * 1.4, letterSpacing: 0.3 },
  toneDefault: { color: theme.colors.text },
  toneMuted: { color: theme.colors.textMuted },
  toneWarm: { color: theme.colors.textWarm },
  tonePrimary: { color: theme.colors.primary },
  toneDanger: { color: theme.colors.danger },
  toneSuccess: { color: theme.colors.success },
  toneWarning: { color: theme.colors.warning },
  toneInverse: { color: theme.colors.background },
}));

const weightStyles: Record<NonNullable<AppTextProps["weight"]>, TextStyle> = {
  regular: { fontWeight: "400" },
  medium: { fontWeight: "500" },
  semibold: { fontWeight: "600" },
  bold: { fontWeight: "700" },
};
