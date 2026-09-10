import { useEffect, useMemo, useState } from "react";
import { RefreshControl, StyleSheet, View, useWindowDimensions } from "react-native";
import { BarChart3, RefreshCw } from "lucide-react-native";
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from "react-native-svg";
import {
  DASHBOARD_RANGE_OPTIONS,
  METRIC_CATALOG,
  dashboardHeadingForRole,
  formatMetric,
  type DashboardRange,
} from "@jewelos/core";
import {
  fetchDashboardMetrics,
  fetchReportingOptions,
  type ReportingOptions,
} from "@jewelos/data/analytics/api";
import type { DashboardPayload } from "@jewelos/data/analytics/types";
import { useAuth, useProfile } from "@/auth/AuthProvider";
import { DateField } from "@/forms/DateField";
import { titleCase } from "@/lib/format";
import { useAsyncData } from "@/lib/useAsyncData";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";

const today = () => new Date().toISOString().slice(0, 10);
const elevatedRoles = new Set(["super_admin", "admin", "manager", "hr"]);
const branchRoles = new Set(["super_admin", "admin"]);

function Trend({ data }: { data: DashboardPayload }) {
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const chartWidth = Math.max(280, width - 64);
  const height = 150;
  const pad = 24;
  const points = data.task_completion_trend;
  const max = Math.max(1, ...points.map((point) => point.completed));
  const coordinates = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? chartWidth / 2 : pad + (index * (chartWidth - pad * 2)) / (points.length - 1),
    y: height - pad - (point.completed / max) * (height - pad * 2),
  }));

  if (coordinates.length === 0) return <Text tone="muted">No completed tasks in this range.</Text>;
  return (
    <Svg accessibilityLabel="Task completion trend with directly labelled daily values" height={height} width={chartWidth}>
      <Line stroke={theme.colors.border} x1={pad} x2={chartWidth - pad} y1={height - pad} y2={height - pad} />
      <Polyline
        fill="none"
        points={coordinates.map(({ x, y }) => `${x},${y}`).join(" ")}
        stroke={theme.colors.primary}
        strokeWidth={3}
      />
      {coordinates.map((point) => (
        <G key={point.local_date}>
          <Circle cx={point.x} cy={point.y} fill={theme.colors.surface} r={4} stroke={theme.colors.primary} strokeWidth={2} />
          <SvgText fill={theme.colors.text} fontSize={10} textAnchor="middle" x={point.x} y={point.y - 9}>{point.completed}</SvgText>
          <SvgText fill={theme.colors.textMuted} fontSize={9} textAnchor="middle" x={point.x} y={height - 7}>{point.local_date.slice(5)}</SvgText>
        </G>
      ))}
    </Svg>
  );
}

export function DashboardScreen() {
  const { branch, preferences } = useAuth();
  const profile = useProfile();
  const theme = useAppTheme();
  const styles = useStyles();
  const [range, setRange] = useState<DashboardRange>(preferences.dashboard_range);
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [branchId, setBranchId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [options, setOptions] = useState<ReportingOptions>({ branches: [], departments: [] });
  const elevated = elevatedRoles.has(profile.user_role);
  const canSelectBranch = branchRoles.has(profile.user_role);

  useEffect(() => {
    if (elevated) void fetchReportingOptions().then(setOptions);
  }, [elevated]);

  const context = useMemo(() => ({
    preset: range,
    ...(range === "custom" ? { from: customFrom, to: customTo } : {}),
    ...(branchId ? { branch_id: branchId } : {}),
    ...(departmentId ? { department_id: departmentId } : {}),
  }), [branchId, customFrom, customTo, departmentId, range]);
  const { data, error, loading, refreshing, refresh, reload } = useAsyncData(
    () => fetchDashboardMetrics(context),
    [branchId, customFrom, customTo, departmentId, range],
  );
  const definitions = useMemo(() => METRIC_CATALOG.filter((item) =>
    item.roles.includes(profile.user_role) && data && Object.hasOwn(data.metrics, item.key)), [data, profile.user_role]);
  const departments = options.departments.filter((item) => !branchId || item.branch_id === null || item.branch_id === branchId);

  if (loading) return <LoadingState label="Loading dashboard…" />;
  if (error) return <ErrorState message={error} onRetry={() => void reload()} title="Could not load dashboard" />;
  if (!data) return <ErrorState message="No dashboard data is available." onRetry={() => void reload()} />;

  const totalStatuses = Object.values(data.task_status_distribution).reduce((sum, count) => sum + count, 0);
  return (
    <Screen
      refreshControl={<RefreshControl colors={[theme.colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} tintColor={theme.colors.primary} />}
      scroll
    >
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <View style={styles.titleRow}>
            <BarChart3 color={theme.colors.brand} size={22} />
            <Text variant="heading" weight="semibold">{dashboardHeadingForRole(profile.user_role)}</Text>
          </View>
          <Text tone="muted" variant="caption">{profile.employee_name} · {titleCase(profile.user_role)} · {branch?.name ?? "Branch unavailable"}</Text>
          <Text tone="muted" variant="caption">{data.context.local_start.slice(0, 10)} → {data.context.local_end_exclusive.slice(0, 10)}</Text>
        </View>
        <Button icon={<RefreshCw color={theme.colors.primary} size={18} />} label="Refresh" onPress={() => void refresh()} variant="ghost" />
      </View>

      <SegmentedControl accessibilityLabel="Dashboard date range" onChange={setRange} options={DASHBOARD_RANGE_OPTIONS} value={range} />
      {range === "custom" ? (
        <View style={styles.filters}>
          <View style={styles.field}><Text tone="muted" variant="label">From</Text><DateField disabled={false} invalid={false} label="From" mode="date" onChange={setCustomFrom} value={customFrom} /></View>
          <View style={styles.field}><Text tone="muted" variant="label">To</Text><DateField disabled={false} invalid={false} label="To" mode="date" onChange={setCustomTo} value={customTo} /></View>
        </View>
      ) : null}
      {canSelectBranch ? <OptionPicker label="Branch context" onChange={(selected) => { setBranchId(selected[0] ?? ""); setDepartmentId(""); }} options={[{ value: "", label: "All authorized branches" }, ...options.branches.map((item) => ({ value: item.id, label: item.name }))]} selected={[branchId]} /> : null}
      {elevated ? <OptionPicker label="Department context" onChange={(selected) => setDepartmentId(selected[0] ?? "")} options={[{ value: "", label: "All authorized departments" }, ...departments.map((item) => ({ value: item.id, label: item.name }))]} selected={[departmentId]} /> : null}

      <View style={styles.metricGrid}>
        {definitions.map((definition) => {
          const value = data.metrics[definition.key] ?? null;
          const previous = data.previous[definition.key];
          const comparable = definition.comparable && value !== null && previous !== null && previous !== undefined;
          const delta = comparable ? value - previous : null;
          return (
            <Card key={definition.key} style={styles.metricCard}>
              <Text tone="muted" variant="caption" weight="medium">{definition.displayName}</Text>
              <Text variant="heading" weight="semibold">{formatMetric({ key: definition.key, value }, definition)}</Text>
              <Text tone={delta === null ? "muted" : delta > 0 ? "success" : delta < 0 ? "danger" : "muted"} variant="caption">
                {delta === null ? (definition.comparable ? "Previous period unavailable" : "Current state") : `${delta > 0 ? "+" : ""}${definition.format === "percentage" ? `${delta.toFixed(1)} pp` : Math.round(delta).toLocaleString("en-IN")} vs previous period`}
              </Text>
              <Text tone="muted" variant="caption">{definition.definition}</Text>
            </Card>
          );
        })}
      </View>

      <Card><Text variant="subtitle" weight="semibold">Task Performance Trend</Text><Text tone="muted" variant="caption">Daily completed tasks with values shown directly.</Text><Trend data={data} /></Card>
      <Card>
        <Text variant="subtitle" weight="semibold">Task Status Distribution</Text>
        <Text tone="muted" variant="caption">Current filtered operational state.</Text>
        {Object.entries(data.task_status_distribution).length === 0 ? <Text tone="muted">No task data in this range.</Text> : Object.entries(data.task_status_distribution).map(([status, count]) => (
          <View key={status} style={styles.statusBlock}>
            <View style={styles.statusLabels}><Text variant="small">{titleCase(status)}</Text><Text variant="small" weight="semibold">{count}</Text></View>
            <View style={styles.track}><View style={[styles.fill, { width: `${totalStatuses ? count / totalStatuses * 100 : 0}%` }, status === "completed" ? styles.success : status === "overdue" ? styles.danger : styles.warning]} /></View>
          </View>
        ))}
      </Card>
      <Text style={styles.footer} tone="muted" variant="caption">Live · generated {new Date(data.generated_at).toLocaleString("en-IN")} · filters are read-only and server-scoped.</Text>
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  headingRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.space.sm },
  headingCopy: { flex: 1, minWidth: 0, gap: 3 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  filters: { gap: theme.space.sm },
  field: { gap: 4 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  metricCard: { width: "48%", flexGrow: 1, minWidth: 145 },
  statusBlock: { gap: 4 },
  statusLabels: { flexDirection: "row", justifyContent: "space-between" },
  track: { height: 8, overflow: "hidden", borderRadius: theme.radius.pill, backgroundColor: theme.colors.background },
  fill: { height: "100%", borderRadius: theme.radius.pill },
  success: { backgroundColor: theme.colors.success },
  danger: { backgroundColor: theme.colors.danger },
  warning: { backgroundColor: theme.colors.warning },
  footer: { textAlign: "center", paddingBottom: theme.space.md },
}));
