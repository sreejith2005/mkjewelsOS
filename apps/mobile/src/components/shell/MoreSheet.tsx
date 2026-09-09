import { Pressable, Text, View } from "react-native";
import { LogOut } from "lucide-react-native";
import { Button, Modal } from "@/components/ui";
import type { LauncherItem } from "./AppLauncher";

/**
 * A verbatim port of `apps/web/src/components/shell/MoreSheet.tsx`.
 *
 * The class strings are the web component's, unchanged apart from `hover:`
 * variants, which have no meaning on a touch screen and are replaced by
 * `active:` where a pressed state is wanted.
 */
export function MoreSheet({
  branchName,
  items,
  onClose,
  onLogout,
  onNavigate,
  profileName,
  roleLabel,
  visible,
}: {
  branchName: string;
  items: readonly LauncherItem[];
  onClose: () => void;
  onLogout: () => Promise<void>;
  onNavigate: (path: string) => void;
  profileName: string;
  roleLabel: string;
  visible: boolean;
}) {
  return (
    <Modal onClose={onClose} title="More" tone="light" visible={visible}>
      <View className="mb-5 rounded-xl bg-task-muted p-4">
        <Text className="text-sm font-semibold text-task-text">{profileName}</Text>
        <Text className="mt-1 text-xs text-task-text-muted">
          {roleLabel} · {branchName}
        </Text>
      </View>

      <View accessibilityLabel="More navigation" accessibilityRole="menu" className="flex-col gap-1">
        {items.map(({ Icon, id, label, path }) => (
          <Pressable
            accessibilityLabel={label}
            accessibilityRole="menuitem"
            className="min-h-12 flex-row items-center gap-3 rounded-lg px-3 active:bg-task-muted"
            key={id}
            onPress={() => {
              onNavigate(path);
              onClose();
            }}
          >
            <Icon className="text-task-text-muted" size={20} />
            <Text className="text-sm font-medium text-task-text">{label}</Text>
          </Pressable>
        ))}
      </View>

      <Button
        className="mt-5 w-full border-task-border bg-task-bg active:bg-task-muted"
        onPress={() => void onLogout()}
        variant="secondary"
      >
        <LogOut className="text-task-overdue" size={18} />
        <Text className="text-sm font-semibold text-task-overdue">Sign out</Text>
      </Button>
    </Modal>
  );
}
