import { StyleSheet, View } from "react-native";
import { ClipboardPenLine, UserRoundPlus, UsersRound } from "lucide-react-native";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Pressable } from "@/ui/Pressable";
import { Text } from "@/ui/Text";

export type WalkinRegistrationKind = "new" | "returning";

export const WALKIN_KIND_TITLES: Record<WalkinRegistrationKind, string> = {
  new: "New walk-in registration",
  returning: "Returning client walk-in",
};

/** The web `WalkinWorkspace` chooser: the front desk picks the registration type first. */
export function WalkinRegistrationChooser({ onChoose }: Readonly<{ onChoose: (kind: WalkinRegistrationKind) => void }>) {
  const theme = useAppTheme();
  const styles = useStyles();
  return (
    <View style={styles.stack}>
      <View style={styles.card}>
        <Text style={styles.eyebrow} variant="caption" weight="semibold">MK JEWELS CRM · FRONT DESK</Text>
        <Text variant="heading" weight="bold">CLIENT WALK-IN FORM</Text>
        <Text tone="muted" variant="small">
          Register a client visit inside JewelOS. The client search, visit history, follow-up, and access controls all stay in this app.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => onChoose("new")}
        style={({ pressed }) => [styles.option, styles.optionPrimary, pressed && styles.pressed]}
      >
        <UserRoundPlus color={theme.colors.primary} size={28} />
        <Text variant="subtitle" weight="bold">NEW WALK-IN</Text>
        <Text tone="muted" variant="small">
          Register a first-time visitor, capture their visit details, and create a protected client record when needed.
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={() => onChoose("returning")}
        style={({ pressed }) => [styles.option, pressed && styles.pressed]}
      >
        <UsersRound color={theme.colors.primary} size={28} />
        <Text variant="subtitle" weight="bold">RETURNING CLIENT</Text>
        <Text tone="muted" variant="small">
          Look up the visitor by phone, keep their history intact, and add this visit to the same client record.
        </Text>
      </Pressable>
      <View style={styles.note}>
        <ClipboardPenLine color={theme.colors.primary} size={20} />
        <Text style={styles.noteText} tone="muted" variant="small">
          No separate CRM site or second sign-in is used. This is the JewelOS CRM workspace.
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  stack: { gap: theme.space.md },
  card: {
    gap: theme.space.xs,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: theme.space.md,
  },
  eyebrow: { color: theme.colors.primary, letterSpacing: 1.5 },
  option: {
    gap: theme.space.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
    padding: 20,
  },
  optionPrimary: { borderWidth: 2, borderColor: theme.colors.primary },
  pressed: { opacity: 0.8 },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.space.md,
  },
  noteText: { flex: 1, minWidth: 0 },
}));
