import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Text } from "@/ui/Text";

export type SheetProps = Readonly<{
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Let the sheet grow to most of the screen, for a long option list. */
  tall?: boolean;
  /**
   * Turn the body's own `ScrollView` off for a sheet that owns a `FlatList`.
   * A virtualised list nested in a scroll view stops virtualising.
   */
  scrollable?: boolean;
}>;

/** Long enough for the slide-out to finish before the sheet leaves the tree. */
const CLOSE_ANIMATION_MS = 300;

/**
 * The touch replacement for a desktop dropdown or dialog. It rises from the
 * bottom, where a thumb already is, rather than opening in the middle of the
 * screen where a phone user has to reach for it.
 *
 * `onRequestClose` is what makes the Android back button dismiss the sheet
 * instead of leaving the screen underneath it.
 *
 * Two things this owes its callers, both learned from the device:
 *
 * The body scrolls. The sheet is capped at 75% of the screen, and a form
 * taller than that — the recurring schedule editor, for one — used to be cut
 * off with no way to reach the rest of it, including its Save button. The
 * grabber and the title stay put while the body scrolls under them, and the
 * keyboard pushes the body rather than covering the focused field.
 *
 * It leaves the tree when it is closed. A closed `Modal` draws nothing, but its
 * children are still built and reconciled on every render of whatever owns it —
 * and a sheet is usually owned by a row. A hundred rows each holding an
 * `OptionPicker` or a `PromptSheet` was a hundred sheets being rebuilt to show
 * none of them. The unmount is delayed by one animation so the slide-out is
 * still seen.
 */
export function Sheet({ visible, title, onClose, children, tall = false, scrollable = true }: SheetProps) {
  const theme = useAppTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [mounted, setMounted] = useState(visible);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (visible) {
      setMounted(true);
      return undefined;
    }
    timer.current = setTimeout(() => setMounted(false), CLOSE_ANIMATION_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [visible]);

  if (!mounted) return null;

  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.fill}
      >
        <Pressable accessibilityLabel="Close" accessibilityRole="button" onPress={onClose} style={styles.scrim} />
        <View style={[styles.sheet, tall && styles.tall, { paddingBottom: theme.space.md + insets.bottom }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text numberOfLines={1} tone="warm" variant="subtitle" weight="semibold">
              {title}
            </Text>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={8}
              onPress={onClose}
              style={styles.close}
            >
              <Text tone="muted" variant="subtitle">
                ✕
              </Text>
            </Pressable>
          </View>
          {scrollable ? (
            <ScrollView
              contentContainerStyle={styles.body}
              // Lets a control inside the sheet be tapped in one go while the
              // keyboard is open, instead of the first tap only dismissing it.
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              {children}
            </ScrollView>
          ) : (
            children
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  fill: { flex: 1 },
  scrim: { flex: 1, backgroundColor: theme.colors.scrim },
  sheet: {
    maxHeight: "75%",
    backgroundColor: theme.colors.surface,
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    borderTopWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.sm,
    gap: theme.space.sm,
  },
  tall: { minHeight: "60%" },
  body: { paddingBottom: theme.space.sm, gap: theme.space.sm },
  grabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.disabled,
    marginBottom: theme.space.xs,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  close: { minHeight: theme.touchTarget, minWidth: theme.touchTarget, alignItems: "center", justifyContent: "center" },
}));
