import { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { makeStyles } from "@/theme/makeStyles";
import { SearchField } from "@/ui/SearchField";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";

export type PickerOption = Readonly<{ value: string; label: string }>;

export type OptionPickerProps = Readonly<{
  label: string;
  options: readonly PickerOption[];
  /** One value for a single choice; several for a multi-select. */
  selected: readonly string[];
  multiple?: boolean;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  onChange: (selected: readonly string[]) => void;
}>;

/** Above this many options, scanning beats scrolling, so a filter appears. */
const SEARCH_THRESHOLD = 8;

/**
 * The touch replacement for `<select>`. A native picker wheel hides the choices
 * until it is open and is awkward to search; a full-height sheet of real rows
 * shows them, filters them, and gives every row a proper touch target.
 */
export function OptionPicker({
  label,
  options,
  selected,
  multiple = false,
  disabled = false,
  invalid = false,
  placeholder = "Select",
  onChange,
}: OptionPickerProps) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return options;
    return options.filter((option) => option.label.toLowerCase().includes(needle));
  }, [options, query]);

  const summary = useMemo(() => {
    const chosen = options.filter((option) => selected.includes(option.value));
    if (chosen.length === 0) return null;
    if (chosen.length === 1) return chosen[0]?.label ?? null;
    return `${chosen.length} selected`;
  }, [options, selected]);

  const toggle = (value: string) => {
    if (!multiple) {
      onChange([value]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  return (
    <>
      <Pressable
        accessibilityHint={multiple ? "Opens the list to choose one or more options" : "Opens the list of options"}
        accessibilityLabel={`${label}${summary ? `, ${summary}` : ", nothing selected"}`}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: open }}
        disabled={disabled}
        onPress={() => {
          setQuery("");
          setOpen(true);
        }}
        style={({ pressed }) => [
          styles.trigger,
          invalid && styles.invalid,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <Text numberOfLines={1} style={styles.triggerLabel} tone={summary ? "default" : "muted"} variant="body">
          {summary ?? placeholder}
        </Text>
        <Text tone="muted" variant="body">
          ⌄
        </Text>
      </Pressable>

      <Sheet onClose={() => setOpen(false)} tall={options.length > SEARCH_THRESHOLD} title={label} visible={open}>
        {options.length > SEARCH_THRESHOLD ? (
          <SearchField
            accessibilityLabel={`Filter ${label}`}
            onChangeText={setQuery}
            placeholder="Type to filter"
            value={query}
          />
        ) : null}

        <FlatList
          data={filtered}
          keyExtractor={(option) => option.value}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text tone="muted" variant="body">
                {options.length === 0 ? "This list has no options yet." : `Nothing matched “${query}”.`}
              </Text>
            </View>
          }
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isSelected = selected.includes(item.value);
            return (
              <Pressable
                accessibilityLabel={item.label}
                accessibilityRole={multiple ? "checkbox" : "radio"}
                accessibilityState={{ checked: isSelected }}
                onPress={() => toggle(item.value)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Text style={styles.rowLabel} tone={isSelected ? "primary" : "default"} variant="body">
                  {item.label}
                </Text>
                {isSelected ? (
                  <Text tone="primary" variant="body" weight="bold">
                    ✓
                  </Text>
                ) : null}
              </Pressable>
            );
          }}
        />

        {multiple ? (
          <Pressable
            accessibilityLabel="Done"
            accessibilityRole="button"
            onPress={() => setOpen(false)}
            style={styles.done}
          >
            <Text tone="inverse" variant="body" weight="semibold">
              Done
            </Text>
          </Pressable>
        ) : null}
      </Sheet>
    </>
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
  triggerLabel: { flex: 1, minWidth: 0 },
  invalid: { borderColor: theme.colors.danger },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.75 },
  row: {
    minHeight: theme.touchTarget,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
    paddingVertical: theme.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  rowLabel: { flex: 1, minWidth: 0 },
  empty: { paddingVertical: theme.space.xl, alignItems: "center" },
  done: {
    minHeight: theme.touchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.primary,
    marginTop: theme.space.sm,
  },
}));
