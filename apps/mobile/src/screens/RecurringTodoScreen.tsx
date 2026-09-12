import { useCallback, useMemo, useState } from "react";
import { Alert, RefreshControl, StyleSheet, View, type ListRenderItem } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  canManageRecurringWorkspace,
  isRecurringInstanceInTab,
  kolkataDateKey,
  recurringPerformancePercents,
  recurringPerformanceRows,
  recurringTemplateDeletePrompt,
  RECURRING_FREQUENCY_FILTERS,
  RECURRING_PRIORITY_FILTERS,
  RECURRING_STATUS_FILTERS,
  RECURRING_TODO_TABS,
  type Json,
  type RecurringTodoTab,
} from "@jewelos/core";
import {
  deleteRecurringTemplate,
  loadRecurringWorkspace,
  materializeRecurringTemplate,
  runRecurringTemplateNow,
  saveRecurringTemplate,
  setRecurringTemplateActive,
  EMPTY_RECURRING_STATS,
  type RecurringInstance,
  type RecurringTemplate,
} from "@jewelos/data/recurringTodo/api";
import { loadTaskAuthoringReferenceData } from "@jewelos/data/tasks/api";
import { useProfile } from "@/auth/AuthProvider";
import { RecurringScheduleCard } from "@/features/recurringTodo/RecurringScheduleCard";
import { RecurringScheduleForm } from "@/features/recurringTodo/RecurringScheduleForm";
import { RecurringWorkCard } from "@/features/recurringTodo/RecurringWorkCard";
import { titleCase } from "@/lib/format";
import { useAsyncData } from "@/lib/useAsyncData";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import type { RootStackParamList } from "@/navigation/types";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { DateField } from "@/forms/DateField";
import { ListScreen } from "@/ui/ListScreen";
import { OptionPicker } from "@/ui/OptionPicker";
import { SearchField } from "@/ui/SearchField";
import { Screen } from "@/ui/Screen";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Sheet } from "@/ui/Sheet";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";

/** The web page's own opening window: a week back, a month ahead. */
function defaultRange(): [string, string] {
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setDate(to.getDate() + 30);
  return [kolkataDateKey(from), kolkataDateKey(to)];
}

/** `undefined` means the editor is closed; `null` means it is open for a new schedule. */
type Editing = RecurringTemplate | null | undefined;

type PerformanceRow = ReturnType<typeof recurringPerformanceRows>[number];

/** One list entry, whichever bucket produced it. */
type Row =
  | { kind: "work"; key: string; task: RecurringInstance }
  | { kind: "schedule"; key: string; template: RecurringTemplate }
  | { kind: "performance"; key: string; performance: PerformanceRow };

/**
 * Recurring / To-Do — the phone form of `apps/web/src/pages/RecurringTodoPage.tsx`.
 *
 * Every bucket, filter, statistic and action is the web page's, decided by the
 * same `@jewelos/core` functions and written through the same audited RPCs in
 * `@jewelos/data`. The desktop tab strip becomes a scrolling chip row and the
 * two dialogs become sheets; nothing else differs.
 *
 * Two loads, not one. The workspace depends on the filters and is re-fetched
 * when they change; the authoring reference data — branches, departments,
 * users, designations, forms, templates — does not depend on them at all, so it
 * is loaded once on mount. The search term reaches the workspace loader only
 * after it settles, so typing a word is one request rather than one per letter.
 */
export function RecurringTodoScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const profile = useProfile();
  const theme = useAppTheme();
  const styles = useStyles();

  const [[dateFrom, dateTo], setRange] = useState(defaultRange);
  const [tab, setTab] = useState<RecurringTodoTab>("today");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editing, setEditing] = useState<Editing>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canManage = canManageRecurringWorkspace(profile.user_role);
  const appliedSearch = useDebouncedValue(search);

  const referenceState = useAsyncData(loadTaskAuthoringReferenceData, []);
  const references = referenceState.data;

  const loader = useCallback(
    () =>
      loadRecurringWorkspace({
        date_from: dateFrom,
        date_to: dateTo,
        search: appliedSearch,
        status: statusFilter,
        priority: priorityFilter,
        branch_id: branchFilter,
        department_id: departmentFilter,
        schedule_kind: kindFilter,
      }),
    [appliedSearch, branchFilter, dateFrom, dateTo, departmentFilter, kindFilter, priorityFilter, statusFilter],
  );
  const { data: workspace, error, loading, refreshing, refresh, reload } = useAsyncData(loader, [
    appliedSearch,
    branchFilter,
    dateFrom,
    dateTo,
    departmentFilter,
    kindFilter,
    priorityFilter,
    statusFilter,
  ]);

  const stats = workspace?.stats ?? EMPTY_RECURRING_STATS;
  const templates = useMemo(() => workspace?.templates ?? [], [workspace]);
  const instances = useMemo(() => workspace?.instances ?? [], [workspace]);

  const templateById = useMemo(
    () => new Map(templates.map((template) => [template.id, template])),
    [templates],
  );
  const followupEnabled = useCallback(
    (task: RecurringInstance) =>
      Boolean(task.task_template_id && templateById.get(task.task_template_id)?.followup_enabled),
    [templateById],
  );

  const visibleTasks = useMemo(
    () =>
      instances.filter((task) =>
        isRecurringInstanceInTab({
          task,
          tab,
          viewerId: profile.id,
          todayKey: kolkataDateKey(new Date()),
          plannedKey: kolkataDateKey(new Date(task.planned_datetime)),
          followupEnabled: followupEnabled(task),
        }),
      ),
    [followupEnabled, instances, profile.id, tab],
  );
  const performance = useMemo(() => recurringPerformanceRows(instances), [instances]);

  const rows = useMemo<readonly Row[]>(() => {
    if (tab === "schedules") {
      return templates.map((template): Row => ({ kind: "schedule", key: template.id, template }));
    }
    if (tab === "performance") {
      return performance.map((entry): Row => ({ kind: "performance", key: entry.name, performance: entry }));
    }
    return visibleTasks.map((task): Row => ({ kind: "work", key: task.id, task }));
  }, [performance, tab, templates, visibleTasks]);

  const act = useCallback(
    async (key: string, work: () => Promise<void>) => {
      setBusy(key);
      setActionError(null);
      try {
        await work();
        await refresh();
      } catch (caught) {
        setActionError(caught instanceof Error ? caught.message : "Action failed");
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const save = async (id: string | null, payload: Json) => {
    const templateId = await saveRecurringTemplate(id, payload);
    await materializeRecurringTemplate(templateId, payload);
    setEditing(undefined);
    await refresh();
  };

  const remove = useCallback(
    (template: RecurringTemplate) => {
      Alert.alert("Delete schedule", recurringTemplateDeletePrompt(template.title), [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => void act(template.id, async () => void (await deleteRecurringTemplate(template.id))),
        },
      ]);
    },
    [act],
  );

  const openForm = useCallback(
    (target: RecurringInstance) => {
      if (!target.form_template_id) return;
      navigation.navigate("TaskForm", {
        taskId: target.id,
        formTemplateId: target.form_template_id,
        taskType: target.task_type,
      });
    },
    [navigation],
  );

  const renderItem = useCallback<ListRenderItem<Row>>(
    ({ item }) => {
      if (item.kind === "schedule") {
        return (
          <RecurringScheduleCard
            busy={busy === item.template.id}
            canManage={canManage}
            onDelete={() => remove(item.template)}
            onEdit={() => setEditing(item.template)}
            onRunNow={() =>
              void act(item.template.id, () => runRecurringTemplateNow(item.template.id, kolkataDateKey(new Date())))
            }
            onToggleActive={() =>
              void act(item.template.id, () => setRecurringTemplateActive(item.template.id, !item.template.is_active))
            }
            template={item.template}
          />
        );
      }
      if (item.kind === "performance") {
        const percent = recurringPerformancePercents(item.performance);
        return (
          <Card>
            <Text weight="semibold">{item.performance.name}</Text>
            <View style={styles.metrics}>
              {(
                [
                  ["Assigned", item.performance.assigned],
                  ["Completed", item.performance.completed],
                  ["Verified", item.performance.verified],
                  ["On time", item.performance.onTime],
                  ["Delayed", item.performance.delayed],
                  ["On behalf", item.performance.onBehalf],
                  ["Completion", `${percent.completion}%`],
                  ["On time %", `${percent.onTime}%`],
                ] as const
              ).map(([label, value]) => (
                <View key={label} style={styles.metric}>
                  <Text tone="muted" variant="caption">
                    {label}
                  </Text>
                  <Text weight="semibold">{String(value)}</Text>
                </View>
              ))}
            </View>
          </Card>
        );
      }
      return (
        <RecurringWorkCard
          canManage={canManage}
          followupEnabled={followupEnabled(item.task)}
          onChanged={refresh}
          onOpenForm={openForm}
          task={item.task}
        />
      );
    },
    [act, busy, canManage, followupEnabled, openForm, refresh, remove, styles.metric, styles.metrics],
  );

  const departmentOptions = (references?.departments ?? [])
    .filter((department) => !branchFilter || department.branch_id === branchFilter)
    .map((department) => ({ value: department.id, label: department.name }));

  if (loading) return <Screen><LoadingState label="Loading recurring work..." /></Screen>;
  if (error && !workspace) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;

  const emptyForTab =
    tab === "schedules" ? (
      <Card>
        <Text tone="muted">No recurring schedules yet.</Text>
      </Card>
    ) : tab === "performance" ? (
      <Card>
        <Text tone="muted">No performance data in this date range.</Text>
      </Card>
    ) : (
      <EmptyState message="No work matches this view." title="Nothing here" />
    );

  return (
    <>
      <ListScreen
        data={rows}
        empty={emptyForTab}
        header={
          <>
            <View style={styles.heading}>
              <Text tone="primary" variant="heading" weight="semibold">
                Recurring / To-Do List
              </Text>
              <Text tone="muted" variant="small">
                Schedules, daily work, verification, follow-ups, and profile-based coverage.
              </Text>
            </View>

            <View style={styles.headerActions}>
              {canManage ? <Button label="New schedule" onPress={() => setEditing(null)} /> : null}
              <Button label="Refresh" onPress={() => void refresh()} variant="secondary" />
              <Button label="Filters" onPress={() => setFiltersOpen(true)} variant="secondary" />
            </View>

            {error ? <Banner tone="danger">{error}</Banner> : null}
            {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

            <View style={styles.stats}>
              {(
                [
                  ["Total", stats.total],
                  ["Pending", stats.pending],
                  ["In progress", stats.in_progress],
                  ["Completed", stats.completed],
                  ["Overdue", stats.overdue],
                  ["Rejected", stats.rejected],
                  ["On time", stats.on_time],
                  ["Delayed", stats.delayed],
                  ["On behalf", stats.completed_on_behalf],
                  ["Coverage required", stats.coverage_required],
                  ["Manager review", stats.manager_review],
                ] as const
              ).map(([label, value]) => (
                <Card key={label} style={styles.stat}>
                  <Text tone="muted" variant="caption">
                    {label}
                  </Text>
                  <Text variant="title" weight="semibold">
                    {String(value)}
                  </Text>
                </Card>
              ))}
            </View>

            <SegmentedControl
              accessibilityLabel="Recurring workspace"
              onChange={setTab}
              options={RECURRING_TODO_TABS.map(([value, label]) => ({ value, label }))}
              value={tab}
            />

            <SearchField
              accessibilityLabel="Search schedules and tasks"
              onChangeText={setSearch}
              placeholder="Search schedules and tasks"
              value={search}
            />
          </>
        }
        keyExtractor={(item) => item.key}
        refreshControl={
          <RefreshControl colors={[theme.colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} />
        }
        renderItem={renderItem}
      />

      <Sheet onClose={() => setFiltersOpen(false)} tall title="Filters" visible={filtersOpen}>
        <View style={styles.filters}>
          <DateField disabled={false} invalid={false} label="From date" mode="date" onChange={(value) => setRange([value, dateTo])} value={dateFrom} />
          <DateField disabled={false} invalid={false} label="To date" mode="date" onChange={(value) => setRange([dateFrom, value])} value={dateTo} />
          <OptionPicker
            label="Status"
            onChange={(selected) => setStatusFilter(selected[0] ?? "")}
            options={[
              { value: "", label: "All statuses" },
              ...RECURRING_STATUS_FILTERS.map((value) => ({ value, label: titleCase(value) })),
            ]}
            selected={[statusFilter]}
          />
          <OptionPicker
            label="Priority"
            onChange={(selected) => setPriorityFilter(selected[0] ?? "")}
            options={[
              { value: "", label: "All priorities" },
              ...RECURRING_PRIORITY_FILTERS.map((value) => ({ value, label: titleCase(value) })),
            ]}
            selected={[priorityFilter]}
          />
          <OptionPicker
            label="Branch"
            onChange={(selected) => setBranchFilter(selected[0] ?? "")}
            options={[
              { value: "", label: "All branches" },
              ...(references?.branches ?? []).map((branch) => ({ value: branch.id, label: branch.name })),
            ]}
            selected={[branchFilter]}
          />
          <OptionPicker
            label="Frequency"
            onChange={(selected) => setKindFilter(selected[0] ?? "")}
            options={[
              { value: "", label: "All frequencies" },
              ...RECURRING_FREQUENCY_FILTERS.map((value) => ({
                value,
                label: titleCase(value.replace("_", " ")),
              })),
            ]}
            selected={[kindFilter]}
          />
          <OptionPicker
            label="Department"
            onChange={(selected) => setDepartmentFilter(selected[0] ?? "")}
            options={[{ value: "", label: "All departments" }, ...departmentOptions]}
            selected={[departmentFilter]}
          />
          <Button label="Done" onPress={() => setFiltersOpen(false)} />
        </View>
      </Sheet>

      <Sheet
        onClose={() => setEditing(undefined)}
        tall
        title={editing ? "Edit recurring schedule" : "New recurring schedule"}
        visible={editing !== undefined && references !== null}
      >
        {references ? (
          <RecurringScheduleForm
            data={references}
            onCancel={() => setEditing(undefined)}
            onSave={save}
            template={editing ?? null}
          />
        ) : null}
      </Sheet>
    </>
  );
}

const useStyles = makeStyles((theme) =>
  StyleSheet.create({
    heading: { gap: theme.space.xs },
    headerActions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
    stats: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
    stat: { flexGrow: 1, flexBasis: "30%" },
    metrics: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm, marginTop: theme.space.xs },
    metric: { flexGrow: 1, flexBasis: "22%" },
    filters: { gap: theme.space.md },
  }),
);
