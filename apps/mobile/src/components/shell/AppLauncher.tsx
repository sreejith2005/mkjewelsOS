import { Pressable, Text, View } from "react-native";
import { ArrowRight, type LucideIcon } from "lucide-react-native";
import { Modal } from "@/components/ui";

/**
 * A verbatim port of `apps/web/src/components/shell/AppLauncher.tsx`.
 *
 * The class strings are the web component's, unchanged apart from `hover:`,
 * which becomes `active:` on a touch screen.
 */
export type LauncherItem = Readonly<{
  /**
   * A lucide icon. The web types this as
   * `ComponentType<{ className?: string | undefined }>` because
   * `exactOptionalPropertyTypes` rejects a narrower shape; the same applies to
   * `lucide-react-native`, and `size` is accepted alongside the class name.
   */
  Icon: LucideIcon;
  description: string;
  id: string;
  label: string;
  path: string;
}>;

export function AppLauncher({
  items,
  onClose,
  onNavigate,
  visible,
}: {
  items: readonly LauncherItem[];
  onClose: () => void;
  onNavigate: (path: string) => void;
  visible: boolean;
}) {
  return (
    <Modal onClose={onClose} title="My Apps" tone="light" visible={visible}>
      <Text className="mb-4 text-sm text-task-text-muted">Apps available for your role.</Text>
      <View className="flex-col gap-2">
        {items.map(({ Icon, description, id, label, path }) => (
          <Pressable
            accessibilityHint={description}
            accessibilityLabel={label}
            accessibilityRole="button"
            className="min-h-16 flex-row items-center gap-3 rounded-xl border border-task-border bg-task-bg p-3 active:bg-task-muted"
            key={id}
            onPress={() => {
              onNavigate(path);
              onClose();
            }}
          >
            <View className="size-10 shrink-0 items-center justify-center rounded-xl bg-task-accent-soft">
              <Icon className="text-task-accent" size={20} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-sm font-semibold text-task-text">{label}</Text>
              <Text className="text-xs text-task-text-muted">{description}</Text>
            </View>
            <ArrowRight className="shrink-0 text-task-text-muted" size={16} />
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}
