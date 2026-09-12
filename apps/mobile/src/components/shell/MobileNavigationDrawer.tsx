import { useEffect } from "react";
import { BackHandler, Modal as RNModal, Pressable, ScrollView, Text, View } from "react-native";
import { LogOut, X, type LucideIcon } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

export type MobileNavigationDrawerItem = Readonly<{
  Icon: LucideIcon;
  description: string;
  id: string;
  label: string;
  path: string;
}>;

export function MobileNavigationDrawer({
  branchName,
  currentPath,
  items,
  onClose,
  onLogout,
  onNavigate,
  profileName,
  roleLabel,
  visible,
}: {
  branchName: string;
  currentPath: string;
  items: readonly MobileNavigationDrawerItem[];
  onClose: () => void;
  onLogout: () => Promise<void>;
  onNavigate: (path: string) => void;
  profileName: string;
  roleLabel: string;
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!visible) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose, visible]);

  return (
    <RNModal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <View className="flex-1 flex-row">
        <View accessibilityLabel="Navigation" accessibilityViewIsModal className="h-full w-80 bg-task-bg" style={{ paddingTop: insets.top }}>
          <View className="border-b border-task-border px-4 pb-4">
            <View className="flex-row items-center justify-between gap-3">
              <Text className="flex-1 text-lg font-semibold text-task-text">Navigation</Text>
              <Pressable accessibilityLabel="Close navigation" accessibilityRole="button" className="size-11 items-center justify-center rounded-lg active:bg-task-muted" onPress={onClose}>
                <X className="text-task-text-muted" size={20} />
              </Pressable>
            </View>
            <View className="mt-3 rounded-xl bg-task-muted p-3">
              <Text className="text-sm font-semibold text-task-text" numberOfLines={1}>{profileName}</Text>
              <Text className="mt-1 text-xs text-task-text-muted" numberOfLines={1}>{roleLabel} · {branchName}</Text>
            </View>
          </View>
          <ScrollView accessibilityLabel="Application navigation" className="flex-1" contentContainerClassName="gap-1 p-3" keyboardShouldPersistTaps="handled">
            {items.map(({ Icon, description, id, label, path }) => {
              const selected = currentPath === path;
              return (
                <Pressable
                  accessibilityHint={description}
                  accessibilityLabel={label}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  className={cn("min-h-14 flex-row items-center gap-3 rounded-xl px-3 py-2 active:bg-task-muted", selected ? "bg-task-accent-soft" : "")}
                  key={id}
                  onPress={() => { onNavigate(path); onClose(); }}
                >
                  <View className={cn("size-10 shrink-0 items-center justify-center rounded-xl", selected ? "bg-task-accent" : "bg-task-muted")}>
                    <Icon className={selected ? "text-task-bg" : "text-task-text-muted"} size={20} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className={cn("text-sm font-semibold", selected ? "text-task-accent" : "text-task-text")} numberOfLines={1}>{label}</Text>
                    <Text className="text-xs text-task-text-muted" numberOfLines={1}>{description}</Text>
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <View className="border-t border-task-border p-3" style={{ paddingBottom: Math.max(12, insets.bottom) }}>
            <Button className="w-full border-task-border bg-task-bg active:bg-task-muted" onPress={() => void onLogout()} variant="secondary">
              <LogOut className="text-task-overdue" size={18} />
              <Text className="text-sm font-semibold text-task-overdue">Sign out</Text>
            </Button>
          </View>
        </View>
        <Pressable accessibilityLabel="Close navigation" accessibilityRole="button" className="flex-1 bg-obsidian/70" onPress={onClose} />
      </View>
    </RNModal>
  );
}
