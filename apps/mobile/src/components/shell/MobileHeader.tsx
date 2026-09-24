import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Bell, Menu } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { unreadBadge } from "@jewelos/core";
import { loadInbox, subscribeToInbox } from "@jewelos/data/notifications/api";
import { initials } from "@/lib/format";
import { useTheme } from "@/theme/ThemeProvider";
import { ThemeToggle } from "./ThemeToggle";

const logoLight = require("../../../assets/logo-light.jpeg") as number;
const logoDark = require("../../../assets/logo-dark.jpeg") as number;

type MobileHeaderProps = Readonly<{
  onNavigate: (path: string) => void;
  onOpenNavigation: () => void;
  profileId: string;
  profileName: string;
}>;

/**
 * The unread count the web `NotificationBell` shows: unread items among the
 * five most recent, refreshed on every new notification and whenever this
 * screen regains focus, so reading them elsewhere clears the badge.
 */
function useRecentUnread(profileId: string): number {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(async () => {
    try {
      const recent = (await loadInbox(profileId, 20)).slice(0, 5);
      setUnread(recent.filter((item) => !item.is_read).length);
    } catch {
      // The badge is a courtesy; the Notifications screen reports load failures.
    }
  }, [profileId]);
  useEffect(() => subscribeToInbox(profileId, () => void refresh()), [profileId, refresh]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return unread;
}

/** The 56dp phone branch of the approved web ApplicationShell header. */
export function MobileHeader({ onNavigate, onOpenNavigation, profileId, profileName }: MobileHeaderProps) {
  const insets = useSafeAreaInsets();
  const { name } = useTheme();
  const unread = useRecentUnread(profileId);

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
            accessibilityLabel={unread ? `Notifications, ${unread} unread` : "Notifications, none unread"}
            accessibilityRole="button"
            className="size-10 items-center justify-center rounded-lg active:bg-task-muted"
            hitSlop={4}
            onPress={() => onNavigate("/notifications")}
          >
            <Bell className="text-task-text-muted" size={19} />
            {unread ? (
              <View className="absolute -right-0.5 -top-0.5 min-w-5 items-center rounded-full bg-danger px-1">
                <Text className="text-[10px] font-bold leading-5 text-white">{unreadBadge(unread)}</Text>
              </View>
            ) : null}
          </Pressable>
          <View accessibilityLabel={profileName} accessibilityRole="image" className="size-10 items-center justify-center rounded-full bg-task-accent-soft">
            <Text className="text-sm font-bold text-task-text">{initials(profileName)}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
