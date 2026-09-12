import { Image, Pressable, Text, View } from "react-native";
import { Bell, Menu } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { initials } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { ThemeToggle } from "./ThemeToggle";

const logoLight = require("../../../assets/logo-light.jpeg") as number;
const logoDark = require("../../../assets/logo-dark.jpeg") as number;

type MobileHeaderProps = Readonly<{
  onNavigate: (path: string) => void;
  onOpenNavigation: () => void;
  profileName: string;
}>;

/** The 56dp phone branch of the approved web ApplicationShell header. */
export function MobileHeader({ onNavigate, onOpenNavigation, profileName }: MobileHeaderProps) {
  const insets = useSafeAreaInsets();
  const { name } = useTheme();

  return (
    <View
      className="border-b border-task-border bg-task-bg px-3"
      style={{ paddingTop: insets.top }}
    >
      <View className="h-14 flex-row items-center">
        <Pressable
          accessibilityLabel="Open navigation"
          accessibilityRole="button"
          className="mr-2 size-10 items-center justify-center rounded-lg active:bg-task-muted"
          hitSlop={4}
          onPress={onOpenNavigation}
        >
          <Menu className="text-task-text-muted" size={20} />
        </Pressable>
        <Image
          accessibilityLabel="MK Jewels"
          className="h-7 w-28"
          resizeMode="contain"
          resizeMethod="resize"
          source={name === "dark" ? logoDark : logoLight}
        />
        <View className="ml-auto flex-row items-center gap-2">
          <ThemeToggle />
          <Pressable
            accessibilityLabel="Open notifications"
            accessibilityRole="button"
            className="size-10 items-center justify-center rounded-lg active:bg-task-muted"
            hitSlop={4}
            onPress={() => onNavigate("/notifications")}
          >
            <Bell className="text-task-text-muted" size={19} />
          </Pressable>
          <View accessibilityLabel={profileName} accessibilityRole="image" className="size-10 items-center justify-center rounded-full bg-task-accent-soft">
            <Text className="text-sm font-bold text-task-text">{initials(profileName)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
