import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CheckCircle2, Home, Menu, PanelsTopLeft } from "lucide-react-native";
import { cn } from "@/lib/utils";
import { isTaskPath } from "@/navigation/shellModel";

/**
 * A verbatim port of `apps/web/src/components/shell/MobileBottomNav.tsx`.
 *
 * The class strings are the web component's, unchanged — that is the point of
 * this file, and the reason NativeWind is used at all. Read the two side by
 * side before changing either.
 *
 * Only three things differ, each forced by the platform:
 *   - `fixed inset-x-0 bottom-0 z-40` becomes ordinary layout, because the
 *     navigator already positions this bar;
 *   - `pb-[env(safe-area-inset-bottom)]` becomes the real inset, since there is
 *     no CSS environment variable to read;
 *   - `backdrop-blur` and `bg-task-bg/95` become an opaque `bg-task-bg`, as
 *     React Native has no backdrop filter.
 */
type MobileBottomNavProps = {
  onNavigate: (path: string) => void;
  onOpenApps: () => void;
  onOpenMore: () => void;
  path: string;
};

export function MobileBottomNav({ onNavigate, onOpenApps, onOpenMore, path }: MobileBottomNavProps) {
  const insets = useSafeAreaInsets();

  const destinations = [
    // "/" is where every signed-in employee lands, so it is the tab that has to
    // read as selected on arrival.
    { icon: Home, label: "Home", onSelect: () => onNavigate("/"), selected: path === "/" },
    { icon: CheckCircle2, label: "Tasks", onSelect: () => onNavigate("/tasks"), selected: isTaskPath(path) },
    { icon: PanelsTopLeft, label: "My Apps", onSelect: onOpenApps, selected: false },
    { icon: Menu, label: "More", onSelect: onOpenMore, selected: false },
  ] as const;

  return (
    <View
      accessibilityLabel="Mobile navigation"
      accessibilityRole="tablist"
      className="border-t border-task-border bg-task-bg"
      style={{ paddingBottom: insets.bottom }}
    >
      <View className="mx-auto w-full max-w-lg flex-row gap-1 px-2 py-1.5">
        {destinations.map(({ icon: Icon, label, onSelect, selected }) => (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            className={cn(
              "min-h-14 flex-1 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 active:bg-task-muted",
              selected ? "bg-task-accent-soft" : "",
            )}
            key={label}
            onPress={onSelect}
          >
            <Icon
              className={selected ? "text-task-accent" : "text-task-text-muted"}
              size={22}
              strokeWidth={selected ? 2.4 : 1.9}
            />
            <Text
              className={cn(
                "text-[11px] font-semibold leading-none",
                selected ? "text-task-accent" : "text-task-text-muted",
              )}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
