import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";

export type ScreenProps = Readonly<{
  children: ReactNode;
  /** Wrap the content in a ScrollView. Turn it off for a screen that owns a FlatList. */
  scroll?: boolean;
  /** Remove the default padding, for a full-bleed list or header. */
  padded?: boolean;
  /** A pinned action area that stays reachable while the content scrolls. */
  footer?: ReactNode;
  refreshControl?: React.ComponentProps<typeof ScrollView>["refreshControl"];
  contentStyle?: ViewStyle;
}>;

/**
 * The frame every screen sits in.
 *
 * Two things it handles that are easy to get wrong on Android: the bottom inset
 * on a gesture-navigation device, which would otherwise put a submit button
 * under the system bar; and the keyboard, which on a long form must push the
 * content rather than cover it. `android:windowSoftInputMode` is set to
 * `resize` in the manifest, so Android already shrinks the window — the
 * `KeyboardAvoidingView` here only has work to do on iOS.
 */
export function Screen({ children, scroll = false, padded = true, footer, refreshControl, contentStyle }: ScreenProps) {
  const theme = useAppTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const padding = padded ? theme.space.md : 0;
  const body = scroll ? (
    <ScrollView
      contentContainerStyle={[
        styles.scrollContent,
        { padding, paddingBottom: padding + (footer ? 0 : insets.bottom) },
        contentStyle,
      ]}
      keyboardDismissMode="on-drag"
      // Lets a button inside the scroll view be tapped in one go while the
      // keyboard is open, instead of the first tap only dismissing it.
      keyboardShouldPersistTaps="handled"
      {...(refreshControl ? { refreshControl } : {})}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.plain, { padding }, contentStyle]}>{children}</View>
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.screen}
    >
      {body}
      {footer ? (
        <View style={[styles.footer, { paddingBottom: theme.space.md + insets.bottom }]}>{footer}</View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  plain: { flex: 1 },
  scrollContent: { flexGrow: 1, gap: theme.space.md },
  footer: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.md,
    gap: theme.space.sm,
  },
}));
