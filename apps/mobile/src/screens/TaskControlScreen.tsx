import { useCallback, useMemo, useState } from "react";
import { Alert, Linking, RefreshControl, StyleSheet, View, type ListRenderItem } from "react-native";
import {
  canManageTaskTemplates,
  canSelectTaskControlBranch,
  canViewTaskControl,
  taskControlShowsSearch,
  taskControlTabsFor,
  TASK_CONTROL_TAB_DESCRIPTIONS,
  TASK_CONTROL_TAB_LABELS,
  TASK_VIEW_LABELS,
  evidenceFileSize,
  type Json,
} from "@jewelos/core";
import {
  fetchReportingOptions,
  fetchTaskControlSnapshot,
  type ReportingOptions,
  type TaskControlSnapshot,
} from "@jewelos/data/taskControl/api";
import {
  completionRate,
  defaultFilters,
  needsAttention,
  rangeIsValid,
  tenantToday,
  totals,
  type TaskControlFilters,
  type TaskControlTab,
} from "@jewelos/data/taskControl/filters";
import {
  deleteTaskTemplate,
  loadTaskTemplateDirectory,
  setTaskTemplateSchedule,
  templateFrequencyLabel,
  type TaskTemplateDirectoryRow,
} from "@jewelos/data/taskTemplates/api";
import {
  materializeRecurringTemplate,
  saveRecurringTemplate,
  setRecurringTemplateActive,
} from "@jewelos/data/recurringTodo/api";
import { signedTaskEvidenceUrl } from "@jewelos/data/taskEvidence/api";
import type { TaskAttachmentSummary, TaskRow, TaskView } from "@jewelos/data/taskEvidence/types";
import type { EmployeeProgressRow } from "@jewelos/data/analytics/types";
import {
  loadAvailabilityUsers,
  loadTaskAuthoringReferenceData,
  type TaskReferenceData,
  type TaskTemplate,
  type TaskUser,
} from "@jewelos/data/tasks/api";
import { getSupabase } from "@jewelos/api-client/client";
import { useProfile } from "@/auth/AuthProvider";
import { TaskControlFilterSheet } from "@/features/taskControl/TaskControlFilterSheet";
import { ProgressRow, StatTile } from "@/features/taskControl/panels";
import { EvidenceTaskCard, TemplateCard } from "@/features/taskControl/rows";
import { RecurringScheduleForm } from "@/features/recurringTodo/RecurringScheduleForm";
import { errorText } from "@/lib/log";
import { useAsyncData } from "@/lib/useAsyncData";
import { useDebouncedValue } from "@/lib/useDebouncedValue";
import { DateField } from "@/forms/DateField";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { ListScreen } from "@/ui/ListScreen";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Sheet } from "@/ui/Sheet";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";

const ATTENTION_LIMIT = 8;
const EVIDENCE_GAP_LIMIT = 5;
const PAGE_SIZES = [10, 25, 50, 100] as const;

const dateTime = (value: string | null) =>
  value ? new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const count = (value: number) => value.toLocaleString("en-IN");

/** One list entry, whichever tab produced it. */
type Row =
  | { kind: "attention"; key: string; person: EmployeeProgressRow }
  | { kind: "branch"; key: string; title: string; row: ReturnType<typeof totals> }
  | { kind: "department"; key: string; title: string; row: ReturnType<typeof totals> }
  | { kind: "gap"; key: string; title: string; subtitle: string; overdue: boolean }
  | { kind: "person"; key: string; person: EmployeeProgressRow }
  | { kind: "task"; key: string; task: TaskRow }
  | { kind: "template"; key: string; template: TaskTemplateDirectoryRow }
  | { kind: "note"; key: string; text: string };

/**
 * Task Control — the phone form of `apps/web/src/pages/TaskTemplatesPage.tsx`.
 *
 * All four panels run off one filter object, exactly as web does, so a number
 * on one tab can always be trusted against a number on another. The filter bar
 * becomes a sheet, the progress tables become cards carrying the same five
 * numbers, and the twelve-column template table becomes a card with the same
 * twelve values and the same four actions. Every decision — who sees which tab,
 * which chips exist, how a row is toned — comes from `@jewelos/core`, and every
 * read and write goes through the same audited contracts in `@jewelos/data`.
 */
export function TaskControlScreen() {
  const profile = useProfile();
  const role = profile.user_role;
  const theme = useAppTheme();
  const styles = useStyles();

  const authorized = canViewTaskControl(role);
  const canManage = canManageTaskTemplates(role);
  const tabs = useMemo(() => taskControlTabsFor(role), [role]);

  const [tab, setTab] = useState<TaskControlTab>(() => tabs[0] ?? "overview");
  const [filters, setFilters] = useState<TaskControlFilters>(() => defaultFilters());
  const [view, setView] = useState<TaskView>("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TaskTemplate | null | undefined>(undefined);
  const [scheduling, setScheduling] = useState<TaskTemplateDirectoryRow | null>(null);
  const [scheduleDate, setScheduleDate] = useState(() => tenantToday());

  // The search term reaches the two server contracts only once it settles;
  // the sheet still shows every keystroke.
  const appliedSearch = useDebouncedValue(filters.search);
  const validRange = rangeIsValid(filters);

  // None of these depend on the filters, so they load once. Each falls back on
  // its own rather than failing the screen: a missing branch list should narrow
  // the filter sheet, not hide the workspace.
  const referenceState = useAsyncData(async (): Promise<{
    options: ReportingOptions;
    users: TaskUser[];
    references: TaskReferenceData | null;
  }> => {
    const empty: ReportingOptions = { branches: [], departments: [] };
    if (!authorized) return { options: empty, users: [], references: null };
    const [options, users, references] = await Promise.all([
      fetchReportingOptions().catch(() => empty),
      loadAvailabilityUsers().catch((): TaskUser[] => []),
      loadTaskAuthoringReferenceData().catch((): TaskReferenceData | null => null),
    ]);
    return { options, users, references };
  }, [authorized]);
  const options = referenceState.data?.options ?? { branches: [], departments: [] };
  const users = referenceState.data?.users ?? [];
  const references = referenceState.data?.references ?? null;

  const snapshotState = useAsyncData(async () => {
    if (!authorized || !validRange) return null;
    return fetchTaskControlSnapshot({ ...filters, search: appliedSearch }, view, page, pageSize);
  }, [
    appliedSearch,
    authorized,
    filters.branch_id,
    filters.department_id,
    filters.from,
    filters.to,
    filters.user_profile_id,
    page,
    pageSize,
    validRange,
    view,
  ]);

  const templateState = useAsyncData(
    async () => (canManage ? (await loadTaskTemplateDirectory({ search: appliedSearch })).templates : []),
    [appliedSearch, canManage],
  );

  const snapshot: TaskControlSnapshot | null = snapshotState.data ?? null;
  const templates = useMemo(() => templateState.data ?? [], [templateState.data]);

  // The directory already searched server-side; scope is applied here because
  // the row carries the same ids the shared filter selects. Web does the same.
  const visibleTemplates = useMemo(
    () =>
      templates.filter(
        (row) =>
          (!filters.branch_id || row.branch_id === filters.branch_id) &&
          (!filters.department_id || row.department_id === filters.department_id) &&
          (!filters.user_profile_id || row.assignee_user_id === filters.user_profile_id),
      ),
    [templates, filters.branch_id, filters.department_id, filters.user_profile_id],
  );

  const refresh = useCallback(async () => {
    await Promise.all([snapshotState.refresh(), templateState.refresh()]);
  }, [snapshotState, templateState]);

  const changeFilters = useCallback((next: TaskControlFilters) => {
    setFilters(next);
    setPage(1);
  }, []);

  const focusUser = useCallback(
    (userProfileId: string, next: TaskControlTab) => {
      setFilters((current) => ({ ...current, user_profile_id: userProfileId }));
      setPage(1);
      setTab(next);
    },
    [],
  );

  const run = useCallback(
    async (row: TaskTemplateDirectoryRow, action: () => Promise<void>) => {
      setBusyId(row.id);
      setActionError(null);
      try {
        await action();
        await refresh();
      } catch (caught) {
        setActionError(errorText(caught));
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const openEdit = useCallback(async (row: TaskTemplateDirectoryRow) => {
    setBusyId(row.id);
    setActionError(null);
    const { data, error } = await getSupabase().from("task_templates").select("*").eq("id", row.id).maybeSingle();
    setBusyId(null);
    if (error || !data) {
      setActionError(error ? error.message : "This task template is no longer available.");
      return;
    }
    setEditing(data as TaskTemplate);
  }, []);

  const save = async (id: string | null, payload: Json) => {
    const templateId = await saveRecurringTemplate(id, payload);
    await materializeRecurringTemplate(templateId, payload);
    setEditing(undefined);
    await refresh();
  };

  const toggle = useCallback(
    (row: TaskTemplateDirectoryRow) => void run(row, () => setRecurringTemplateActive(row.id, !row.is_active)),
    [run],
  );

  const remove = useCallback(
    (row: TaskTemplateDirectoryRow) => {
      Alert.alert(
        "Delete task template",
        `Delete this task template: ${row.title}?\n\nPending, in-progress and overdue occurrences will also be removed. Completed work and history will be preserved.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () =>
              void run(row, async () => {
                const result = await deleteTaskTemplate(row.id);
                Alert.alert(
                  result.outcome === "deleted" ? "Task deleted" : "Task archived",
                  result.outcome === "deleted"
                    ? `${result.open_instances_removed} open occurrence(s) removed.`
                    : `${result.open_instances_removed} open occurrence(s) removed, ${result.instances_preserved} completed record(s) preserved.`,
                );
              }),
          },
        ],
      );
    },
    [run],
  );

  const openSchedule = useCallback((row: TaskTemplateDirectoryRow) => {
    setScheduleDate(row.starts_on ?? tenantToday());
    setScheduling(row);
  }, []);

  const saveSchedule = async () => {
    if (!scheduling) return;
    const row = scheduling;
    if (!scheduleDate) {
      setActionError("Select a start date.");
      return;
    }
    setScheduling(null);
    await run(row, async () => {
      await setTaskTemplateSchedule(row.id, scheduleDate);
      await materializeRecurringTemplate(row.id);
    });
  };

  // A signed URL is requested at tap time and lives about a minute, so no
  // durable object link is ever put on screen.
  const openFile = useCallback(async (file: TaskAttachmentSummary) => {
    setActionError(null);
    try {
      await Linking.openURL(await signedTaskEvidenceUrl(file.attachment_id));
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "The file could not be opened.");
    }
  }, []);

  const progress = snapshot?.progress;
  const evidence = snapshot?.evidence;
  const behind = useMemo(() => (progress ? needsAttention(progress.employees) : []), [progress]);
  const people = useMemo(() => totals(progress?.employees ?? []), [progress]);

  const rows = useMemo<readonly Row[]>(() => {
    if (tab === "templates") {
      return visibleTemplates.map((template): Row => ({ kind: "template", key: template.id, template }));
    }
    if (tab === "people") {
      if (!progress) return [];
      const behindIds = new Set(behind.map((row) => row.user_profile_id));
      const clear = progress.employees
        .filter((row) => !behindIds.has(row.user_profile_id))
        .sort((left, right) => left.employee_name.localeCompare(right.employee_name));
      return [...behind, ...clear].map((person): Row => ({ kind: "person", key: person.user_profile_id, person }));
    }
    if (tab === "tasks") {
      return (evidence?.tasks ?? []).map((task): Row => ({ kind: "task", key: task.task_id, task }));
    }
    // Overview: the three panels web stacks, in the same order.
    if (!progress || !evidence) return [];
    const out: Row[] = [];
    if (behind.length === 0) {
      out.push({ kind: "note", key: "clear", text: "Everyone in this scope has cleared their assigned work." });
    } else {
      for (const person of behind.slice(0, ATTENTION_LIMIT)) {
        out.push({ kind: "attention", key: `a-${person.user_profile_id}`, person });
      }
      out.push({
        kind: "note",
        key: "attention-total",
        text: `Across everyone in scope: ${people.completed} completed, ${people.remaining} remaining, ${people.overdue} overdue${
          people.assigned > 0 ? ` (${completionRate(people)}% of ${people.assigned} assignments)` : ""
        }. An assignment is one person on one task.`,
      });
    }
    for (const row of progress.branches) {
      out.push({ kind: "branch", key: `b-${row.branch_id}`, title: row.branch_name, row });
    }
    for (const row of progress.departments) {
      out.push({
        kind: "department",
        key: `d-${row.department_id}`,
        title: row.department_name ?? "No department",
        row,
      });
    }
    if (evidence.missing.length === 0) {
      out.push({ kind: "note", key: "no-gaps", text: "Every upload-required task in this range has a file." });
    } else {
      for (const row of evidence.missing.slice(0, EVIDENCE_GAP_LIMIT)) {
        out.push({
          kind: "gap",
          key: `g-${row.task_id}`,
          title: row.task_title,
          subtitle: `${row.assignee_names ?? "Unassigned"} · due ${dateTime(row.due_datetime ?? row.planned_datetime)}`,
          overdue: row.overdue,
        });
      }
    }
    return out;
  }, [behind, evidence, people, progress, tab, visibleTemplates]);

  const renderItem = useCallback<ListRenderItem<Row>>(
    ({ item }) => {
      if (item.kind === "template") {
        return (
          <TemplateCard
            busy={busyId === item.template.id}
            canManage={canManage}
            onDelete={() => remove(item.template)}
            onEdit={() => void openEdit(item.template)}
            onSchedule={() => openSchedule(item.template)}
            onToggle={() => toggle(item.template)}
            row={item.template}
          />
        );
      }
      if (item.kind === "task") return <EvidenceTaskCard onOpenFile={openFile} row={item.task} />;
      if (item.kind === "person" || item.kind === "attention") {
        return (
          <ProgressRow
            onPress={() => focusUser(item.person.user_profile_id, "tasks")}
            row={item.person}
            subtitle={`${item.person.branch_name}${item.person.department_name ? ` · ${item.person.department_name}` : ""}`}
            title={item.person.employee_name}
          />
        );
      }
      if (item.kind === "branch" || item.kind === "department") {
        return <ProgressRow row={item.row} title={item.title} />;
      }
      if (item.kind === "gap") {
        return (
          <Card accent={item.overdue ? "danger" : "warning"}>
            <Text numberOfLines={2} weight="semibold">{item.title}</Text>
            <Text numberOfLines={1} tone="muted" variant="caption">{item.subtitle}</Text>
            <Text tone={item.overdue ? "danger" : "warning"} variant="caption" weight="medium">
              {item.overdue ? "Overdue, no file" : "No file yet"}
            </Text>
          </Card>
        );
      }
      return (
        <Card>
          <Text tone="muted" variant="caption">{item.text}</Text>
        </Card>
      );
    },
    [busyId, canManage, focusUser, openEdit, openFile, openSchedule, remove, toggle],
  );

  if (!authorized) {
    return (
      <Screen>
        <ErrorState message="Task Control is available only to authorized leaders." title="Access denied" />
      </Screen>
    );
  }

  const loading = tab === "templates" ? templateState.loading : snapshotState.loading;
  const loadError = tab === "templates" ? templateState.error : snapshotState.error;
  const refreshing = snapshotState.refreshing || templateState.refreshing;

  if (loading && !snapshot && !templateState.data) {
    return <Screen><LoadingState label="Loading Task Control..." /></Screen>;
  }

  const totalPages = Math.max(1, Math.ceil((evidence?.tasks_total ?? 0) / pageSize));
  const stats = evidence?.stats;
  const rate = !stats || stats.tasks_total === 0 ? 0 : Math.round((stats.completed / stats.tasks_total) * 100);

  return (
    <>
      <ListScreen
        data={rows}
        empty={
          <EmptyState
            message={tab === "templates" ? "No task templates match these filters." : "No tasks match these filters."}
            title="Nothing here"
          />
        }
        keyExtractor={(item) => item.key}
        refreshControl={
          <RefreshControl colors={[theme.colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} />
        }
        renderItem={renderItem}
        header={
          <>
            <View style={styles.heading}>
              <Text tone="primary" variant="heading" weight="semibold">Task Control</Text>
              <Text tone="muted" variant="small">{TASK_CONTROL_TAB_DESCRIPTIONS[tab]}</Text>
            </View>

            <View style={styles.headerActions}>
              {canManage ? <Button label="Add Task" onPress={() => setEditing(null)} /> : null}
              <Button label="Refresh" onPress={() => void refresh()} variant="secondary" />
              <Button label="Filters" onPress={() => setFiltersOpen(true)} variant="secondary" />
            </View>

            <SegmentedControl
              accessibilityLabel="Task Control sections"
              onChange={setTab}
              options={TASK_CONTROL_TAB_LABELS.filter(([value]) => tabs.includes(value)).map(([value, label]) => ({
                value,
                label,
              }))}
              value={tab}
            />

            {!validRange ? (
              <Banner tone="danger">
                Choose a date range that ends on or after it starts and spans at most 366 days.
              </Banner>
            ) : null}
            {loadError ? <Banner tone="danger">{loadError}</Banner> : null}
            {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

            {tab === "overview" && stats ? (
              <View style={styles.tiles}>
                <StatTile hint="Each task counted once" label="Tasks in range" value={count(stats.tasks_total)} />
                <StatTile hint="Marked complete" label="Completed" tone="good" value={count(stats.completed)} />
                <StatTile
                  hint="Completed ÷ tasks in range"
                  label="Completion rate"
                  tone={rate >= 80 ? "good" : rate >= 50 ? "warn" : "bad"}
                  value={`${rate}%`}
                />
                <StatTile
                  hint="Past the effective deadline"
                  label="Overdue"
                  tone={stats.overdue > 0 ? "bad" : "good"}
                  value={count(stats.overdue)}
                />
                <StatTile
                  hint="Upload required, no file yet"
                  label="Awaiting evidence"
                  tone={stats.upload_tasks_awaiting_evidence > 0 ? "warn" : "good"}
                  value={count(stats.upload_tasks_awaiting_evidence)}
                />
              </View>
            ) : null}

            {tab === "overview" && progress ? (
              <Text tone="muted" variant="caption">
                {`${behind.length} of ${progress.employees.length} people in scope still owe work. Ranked by overdue first, then backlog. Select a row to filter everything to that person.`}
              </Text>
            ) : null}

            {tab === "people" && progress ? (
              <Text tone="muted" variant="caption">
                {`${progress.employees.length} employee${progress.employees.length === 1 ? "" : "s"} in scope, ${behind.length} still owing work. One row is one person; a task shared by two people counts for both.`}
              </Text>
            ) : null}

            {tab === "tasks" ? (
              <>
                <SegmentedControl
                  accessibilityLabel="Task view"
                  onChange={(next) => {
                    setView(next as TaskView);
                    setPage(1);
                  }}
                  options={TASK_VIEW_LABELS.map(([value, label]) => ({ value, label }))}
                  value={view}
                />
                <OptionPicker
                  label="Per page"
                  onChange={(selected) => {
                    setPageSize(Number(selected[0] ?? 25));
                    setPage(1);
                  }}
                  options={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
                  selected={[String(pageSize)]}
                />
                {evidence ? (
                  <Text tone="muted" variant="caption">
                    {`${count(evidence.tasks_total)} task${evidence.tasks_total === 1 ? "" : "s"} in this view, of ${count(evidence.stats.tasks_total)} in scope. ${count(evidence.stats.evidence_files)} file${evidence.stats.evidence_files === 1 ? "" : "s"} uploaded, ${evidenceFileSize(evidence.stats.evidence_bytes)} total. Files open through a 60-second signed link.`}
                  </Text>
                ) : null}
              </>
            ) : null}
          </>
        }
        footer={
          tab === "tasks" && evidence && evidence.tasks.length > 0 ? (
            <View style={styles.pager}>
              <Button disabled={page <= 1} label="Previous" onPress={() => setPage(page - 1)} variant="secondary" />
              <Text tone="muted" variant="caption">{`Page ${page} of ${totalPages}`}</Text>
              <Button
                disabled={page >= totalPages}
                label="Next"
                onPress={() => setPage(page + 1)}
                variant="secondary"
              />
            </View>
          ) : null
        }
      />

      <TaskControlFilterSheet
        canSelectBranch={canSelectTaskControlBranch(role)}
        filters={filters}
        onChange={changeFilters}
        onClose={() => setFiltersOpen(false)}
        onReset={() => changeFilters(defaultFilters())}
        options={options}
        showSearch={taskControlShowsSearch(tab)}
        users={users}
        visible={filtersOpen}
      />

      <Sheet
        onClose={() => setEditing(undefined)}
        tall
        title={editing ? "Edit task template" : "Add new task"}
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

      <Sheet onClose={() => setScheduling(null)} title="Task schedule" visible={scheduling !== null}>
        {scheduling ? (
          <View style={styles.scheduleBody}>
            <Text tone="muted" variant="small">
              {[scheduling.assignee_name, scheduling.title, templateFrequencyLabel(scheduling)]
                .filter(Boolean)
                .join(" · ")}
            </Text>
            <DateField
              disabled={false}
              invalid={!scheduleDate}
              label="Task start date"
              mode="date"
              onChange={setScheduleDate}
              value={scheduleDate}
            />
            <Banner tone="info">
              Recurring schedules continue automatically from this date until the template is deactivated.
            </Banner>
            <View style={styles.headerActions}>
              <Button label="Cancel" onPress={() => setScheduling(null)} variant="secondary" />
              <Button label="Save schedule" onPress={() => void saveSchedule()} />
            </View>
          </View>
        ) : null}
      </Sheet>
    </>
  );
}

const useStyles = makeStyles((theme) =>
  StyleSheet.create({
    heading: { gap: theme.space.xs },
    headerActions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
    tiles: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
    pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.space.sm },
    scheduleBody: { gap: theme.space.md },
  }),
);
