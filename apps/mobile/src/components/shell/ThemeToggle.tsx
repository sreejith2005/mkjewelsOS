import { Pressable } from "react-native";
import { Moon, Sun } from "lucide-react-native";
import { themeToggleLabel } from "@/navigation/shellModel";
import { useTheme } from "@/theme/ThemeProvider";

/** React Native port of the approved web theme control. */
export function ThemeToggle() {
  const { name, toggleTheme } = useTheme();
  const dark = name === "dark";

  return (
    <Pressable
      accessibilityLabel={themeToggleLabel(name)}
      accessibilityRole="switch"
      accessibilityState={{ checked: dark }}
      className="size-10 items-center justify-center rounded-lg border border-gold/25 bg-charcoal active:bg-gold/10"
      hitSlop={4}
      onPress={toggleTheme}
    >
      {dark ? <Sun className="text-gold" size={16} /> : <Moon className="text-gold" size={16} />}
    </Pressable>
  );
}
