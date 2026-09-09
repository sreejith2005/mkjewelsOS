import { useEffect, type ReactNode } from "react";
import { BackHandler, Modal as RNModal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { cn } from "@/lib/utils";

/**
 * A port of `apps/web/src/components/ui.tsx`.
 *
 * The class strings are the web component's, unchanged. Where a web class has
 * no React Native equivalent it is dropped and the omission is commented, so
 * the two files can be diffed by eye. Read the web version before editing this
 * one.
 */

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

export type ButtonProps = Readonly<{
  children?: ReactNode;
  /** The web takes button text as children; a bare string is the common case. */
  label?: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
  accessibilityLabel?: string;
}>;

// Identical to the web's `variants` map.
const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  // `hover:` has no meaning on a touch screen and is dropped throughout.
  primary: "bg-gold",
  secondary: "border border-gold/30 bg-charcoal",
  danger: "border border-danger/40 bg-danger/10",
  ghost: "",
};

const BUTTON_TEXT: Record<ButtonVariant, string> = {
  primary: "text-obsidian",
  secondary: "text-champagne",
  danger: "text-danger",
  ghost: "text-soft-grey",
};

export function Button({
  children,
  label,
  onPress,
  variant = "primary",
  disabled = false,
  className,
  accessibilityLabel,
}: ButtonProps) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      className={cn(
        // The web uses `min-h-10`; on a phone every control is a 44dp target,
        // which is what `index.css` already enforces there through its
        // mobile-only rules.
        "min-h-11 flex-row items-center justify-center gap-2 rounded-lg px-4 py-2",
        BUTTON_VARIANTS[variant],
        disabled ? "opacity-50" : "active:opacity-80",
        className,
      )}
    >
      {label ? <Text className={cn("text-sm font-semibold", BUTTON_TEXT[variant])}>{label}</Text> : children}
    </Pressable>
  );
}

export function Modal({
  title,
  children,
  onClose,
  tone = "dark",
  visible = true,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  tone?: "dark" | "light";
  visible?: boolean;
}) {
  const insets = useSafeAreaInsets();

  // The web closes on Escape; the phone equivalent is the hardware back button,
  // which `onRequestClose` handles. This listener additionally covers the
  // gesture on Android versions where the modal does not receive it.
  useEffect(() => {
    if (!visible) return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose, visible]);

  return (
    <RNModal animationType="slide" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      {/* `bg-obsidian/70`; `backdrop-blur-sm` has no React Native equivalent. */}
      <Pressable accessibilityLabel="Close dialog" className="flex-1 bg-obsidian/70" onPress={onClose} />
      <View
        accessibilityViewIsModal
        className={cn(
          "max-h-[92%] w-full rounded-t-2xl p-5",
          tone === "light" ? "border border-task-border bg-task-bg" : "border border-task-border bg-charcoal",
        )}
        style={{ paddingBottom: Math.max(20, insets.bottom) }}
      >
        {/* The sheet keeps its title and close button reachable while a long
            form scrolls, which on a phone is the only way back out. */}
        <View
          className={cn(
            "-mx-5 -mt-5 mb-5 flex-row items-center justify-between gap-3 px-5 pb-3 pt-2",
            tone === "light" ? "bg-task-bg" : "bg-charcoal",
          )}
        >
          <View className="absolute inset-x-0 top-2 mx-auto h-1 w-10 rounded-full bg-task-text-muted/40" />
          <Text
            className={cn(
              "min-w-0 flex-1 pt-4 text-lg font-semibold",
              tone === "light" ? "text-task-text" : "text-gold",
            )}
          >
            {title}
          </Text>
          <Button
            accessibilityLabel="Close dialog"
            className={cn("mt-4 size-11 shrink-0 p-0", tone === "light" && "")}
            onPress={onClose}
            variant="ghost"
          >
            <X className={tone === "light" ? "text-task-text-muted" : "text-soft-grey"} size={20} />
          </Button>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
      </View>
    </RNModal>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View>
      {/* The web's `.label` class, expanded — see `@apply` in index.css. */}
      <Text className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-task-text-muted">{label}</Text>
      {children}
    </View>
  );
}

const NOTICE_TONES = {
  neutral: "border-gold/20 bg-gold/5",
  danger: "border-danger/40 bg-danger/10",
  success: "border-success/40 bg-success/10",
  task: "border-task-border bg-task-bg",
} as const;

const NOTICE_TEXT = {
  neutral: "text-champagne",
  danger: "text-danger",
  success: "text-success",
  task: "text-task-text-muted",
} as const;

export function Notice({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof NOTICE_TONES;
}) {
  return (
    <View
      accessibilityLiveRegion={tone === "danger" ? "assertive" : "polite"}
      className={cn("rounded-lg border p-3", NOTICE_TONES[tone])}
    >
      {typeof children === "string" ? (
        <Text className={cn("text-sm", NOTICE_TEXT[tone])}>{children}</Text>
      ) : (
        children
      )}
    </View>
  );
}
