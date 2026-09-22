import { StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Mic } from "lucide-react-native";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Pressable } from "@/ui/Pressable";
import { TASKS_PRIMARY_ACTION } from "@/navigation/shellModel";
import type { RootStackParamList } from "@/navigation/types";

/**
 * The app-wide "assign by voice" control. It opens the same Create Task screen
 * as the Tasks page, whose voice card records the note; offering it here is a
 * usability choice only, as the composer and the voice function authorize the
 * author themselves.
 *
 * `raised` lifts it above the Tasks screen's own Create Task button.
 */
export function GlobalVoiceTaskButton({ raised = false }: { raised?: boolean }) {
  const theme = useAppTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const bottom = theme.space.md + insets.bottom + (raised ? theme.touchTarget + theme.space.sm : 0);
  return (
    <View pointerEvents="box-none" style={[styles.anchor, { bottom }]}>
      <Pressable
        accessibilityHint="Opens Create Task to record a voice note"
        accessibilityLabel="Assign a task by voice"
        accessibilityRole="button"
        onPress={() => navigation.navigate(TASKS_PRIMARY_ACTION.route)}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Mic color={theme.colors.background} size={24} />
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  anchor: { position: "absolute", right: theme.space.md },
  button: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
    elevation: 6,
  },
  pressed: { opacity: 0.85 },
}));
