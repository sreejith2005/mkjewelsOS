import type { ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
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
}>;

/**
 * The touch replacement for a desktop dropdown or dialog. It rises from the
 * bottom, where a thumb already is, rather than opening in the middle of the
 * screen where a phone user has to reach for it.
 *
 * `onRequestClose` is what makes the Android back button dismiss the sheet
 * instead of leaving the screen underneath it.
 */
export function Sheet({ visible, title, onClose, children, tall = false }: SheetProps) {
  const theme = useAppTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  return (
    <Modal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
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
        {children}
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
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
