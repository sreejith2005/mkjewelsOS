import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import {
  applyBranch,
  applyPreset,
  RANGE_LABELS,
  RANGE_PRESETS,
  type RangePreset,
  type TaskControlFilters,
} from "@jewelos/data/taskControl/filters";
import type { ReportingOptions } from "@jewelos/data/taskControl/api";
import type { TaskUser } from "@jewelos/data/tasks/api";
import { DateField } from "@/forms/DateField";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { OptionPicker } from "@/ui/OptionPicker";
import { SearchField } from "@/ui/SearchField";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";

export type TaskControlFilterSheetProps = Readonly<{
  visible: boolean;
  onClose: () => void;
  filters: TaskControlFilters;
  onChange: (next: TaskControlFilters) => void;
  onReset: () => void;
  options: ReportingOptions;
  users: readonly TaskUser[];
  canSelectBranch: boolean;
  showSearch: boolean;
}>;

/**
 * The phone form of `apps/web/src/features/taskControl/FilterBar.tsx`.
 *
 * Every control the web bar has, in the same order and wording, decided by the
 * same functions in `@jewelos/data/taskControl/filters`. The bar becomes a
 * sheet because it is seven controls, and a phone cannot show seven controls
 * and the data they filter at the same time. Branch is hidden from roles the
 * server pins to their own branch, so the control never offers a scope the RPC
 * would reject.
 */
export function TaskControlFilterSheet({
  visible,
  onClose,
  filters,
  onChange,
  onReset,
  options,
  users,
  canSelectBranch,
  showSearch,
}: TaskControlFilterSheetProps) {
  const styles = useStyles();

  const departments = useMemo(
    () =>
      options.departments.filter(
        (item) => !filters.branch_id || item.branch_id === null || item.branch_id === filters.branch_id,
      ),
    [options.departments, filters.branch_id],
  );
  const people = useMemo(
    () =>
      users
        .filter(
          (user) =>
            (!filters.branch_id || user.branch_id === filters.branch_id) &&
            (!filters.department_id || user.department_id === filters.department_id),
        )
        .sort((left, right) => left.employee_name.localeCompare(right.employee_name)),
    [users, filters.branch_id, filters.department_id],
  );
  const set = (patch: Partial<TaskControlFilters>) => onChange({ ...filters, ...patch });

  return (
    <Sheet onClose={onClose} tall title="Filters" visible={visible}>
      <View style={styles.body}>
        <SegmentedControl
          accessibilityLabel="Date range"
          onChange={(preset) => onChange(applyPreset(filters, preset as RangePreset))}
          options={RANGE_PRESETS.map((preset) => ({ value: preset, label: RANGE_LABELS[preset] }))}
          value={filters.preset}
        />

        {filters.preset === "custom" ? (
          <>
            <DateField
              disabled={false}
              invalid={false}
              label="From"
              mode="date"
              onChange={(value) => set({ from: value })}
              value={filters.from}
            />
            <DateField
              disabled={false}
              invalid={false}
              label="To"
              mode="date"
              onChange={(value) => set({ to: value })}
              value={filters.to}
            />
          </>
        ) : null}

        {canSelectBranch ? (
          <OptionPicker
            label="Branch"
            onChange={(selected) => onChange(applyBranch(filters, selected[0] ?? ""))}
            options={[
              { value: "", label: "All authorized branches" },
              ...options.branches.map((item) => ({ value: item.id, label: item.name })),
            ]}
            selected={[filters.branch_id]}
          />
        ) : null}

        <OptionPicker
          label="Department"
          onChange={(selected) => set({ department_id: selected[0] ?? "", user_profile_id: "" })}
          options={[
            { value: "", label: "All departments" },
            ...departments.map((item) => ({ value: item.id, label: item.name })),
          ]}
          selected={[filters.department_id]}
        />

        <OptionPicker
          label="User"
          onChange={(selected) => set({ user_profile_id: selected[0] ?? "" })}
          options={[
            { value: "", label: "All users" },
            ...people.map((user) => ({ value: user.id, label: user.employee_name })),
          ]}
          selected={[filters.user_profile_id]}
        />

        {showSearch ? (
          <View style={styles.field}>
            <Text tone="muted" variant="label">
              Search
            </Text>
            <SearchField
              accessibilityLabel="Search tasks"
              onChangeText={(value) => set({ search: value })}
              placeholder="Task, user or department"
              value={filters.search}
            />
          </View>
        ) : null}

        <Text tone="muted" variant="caption">
          {`${filters.from} → ${filters.to}`}
          {filters.branch_id ? " · selected branch" : " · all authorized branches"}
          {filters.department_id ? " · selected department" : ""}
          {filters.user_profile_id ? " · one user" : ""}
          {". Maximum range 366 days; manager scope stays fixed to your own branch."}
        </Text>

        <Button label="Reset" onPress={onReset} variant="secondary" />
        <Button label="Done" onPress={onClose} />
      </View>
    </Sheet>
  );
}

const useStyles = makeStyles((theme) =>
  StyleSheet.create({
    body: { gap: theme.space.md },
    field: { gap: theme.space.xs },
  }),
);
