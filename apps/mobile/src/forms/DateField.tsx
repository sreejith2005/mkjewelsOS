import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Pressable } from "@/ui/Pressable";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { makeStyles } from "@/theme/makeStyles";
import { Text } from "@/ui/Text";

export type DateFieldProps = Readonly<{
  label: string;
  /** `date` stores `YYYY-MM-DD`; `datetime` stores a full ISO instant; `time` stores `HH:MM`. */
  mode: "date" | "datetime" | "time";
  value: string | null;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string) => void;
}>;

/** `YYYY-MM-DD` in the device's own calendar day, not shifted into UTC. */
function localDateKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `HH:MM` on a 24-hour clock, the value a web `<input type="time">` holds. */
function clockKey(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function parse(value: string | null): Date | null {
  if (!value) return null;
  const clock = /^(\d{2}):(\d{2})$/.exec(value);
  if (clock) {
    const date = new Date();
    date.setHours(Number(clock[1]), Number(clock[2]), 0, 0);
    return date;
  }
  // A bare date must be read as local midnight. `new Date("2026-03-01")` parses
  // as UTC, which lands on the previous day in any timezone behind UTC.
  const bare = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (bare) return new Date(Number(bare[1]), Number(bare[2]) - 1, Number(bare[3]));
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Opens Android's own date and time pickers. A typed date field is a common
 * source of wrong entries on a phone, so the answer is only ever produced by
 * the platform picker.
 */
export function DateField({ label, mode, value, disabled, invalid, onChange }: DateFieldProps) {
  const styles = useStyles();
  const current = parse(value);
  const [stage, setStage] = useState<"idle" | "date" | "time">("idle");
  const [draft, setDraft] = useState<Date | null>(null);

  const commit = (date: Date) => onChange(mode === "date" ? localDateKey(date) : mode === "time" ? clockKey(date) : date.toISOString());

  const onPicked = (event: DateTimePickerEvent, picked?: Date) => {
    if (event.type === "dismissed" || !picked) {
      setStage("idle");
      setDraft(null);
      return;
    }
    if (stage === "date" && mode === "datetime") {
      // Android shows date and time as two separate dialogs, so the date is
      // held until the time comes back rather than written twice.
      setDraft(picked);
      setStage("time");
      return;
    }
    if (stage === "time" && draft) {
      const combined = new Date(draft);
      combined.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
      commit(combined);
    } else {
      commit(picked);
    }
    setStage("idle");
    setDraft(null);
  };

  const display = current
    ? mode === "date"
      ? current.toLocaleDateString("en-IN", { dateStyle: "medium" })
      : mode === "time"
        ? clockKey(current)
        : current.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : null;

  return (
    <View>
      <Pressable
        accessibilityHint={mode === "time" ? "Opens the time picker" : "Opens the date picker"}
        accessibilityLabel={`${label}${display ? `, ${display}` : ", not set"}`}
        accessibilityRole="button"
        disabled={disabled}
        onPress={() => setStage(mode === "time" ? "time" : "date")}
        style={({ pressed }) => [
          styles.trigger,
          invalid && styles.invalid,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text numberOfLines={1} style={styles.value} tone={display ? "default" : "muted"} variant="body">
          {display ?? (mode === "date" ? "Choose a date" : mode === "time" ? "Choose a time" : "Choose a date and time")}
        </Text>
        {display && !disabled ? (
          <Pressable accessibilityLabel="Clear" accessibilityRole="button" hitSlop={8} onPress={() => onChange("")}>
            <Text tone="muted" variant="body">
              ✕
            </Text>
          </Pressable>
        ) : null}
      </Pressable>

      {stage !== "idle" ? (
        <DateTimePicker
          display="default"
          is24Hour
          mode={stage === "time" ? "time" : "date"}
          onChange={onPicked}
          value={(stage === "time" ? draft ?? current : current) ?? new Date()}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  trigger: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  value: { flex: 1, minWidth: 0 },
  invalid: { borderColor: theme.colors.danger },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.8 },
}));
