import { useMemo, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { CalendarCheck, Users } from "lucide-react-native";
import { hasPermission, normalizeAvailabilityRange, type Enums } from "@jewelos/core";
import {
  loadAvailabilityDepartments,
  loadAvailabilityForDate,
  loadAvailabilityUsers,
  recordAvailabilityRange,
  type AvailabilityEntry,
  type TaskUser,
} from "@jewelos/data/tasks/api";
import { useAccess, useProfile } from "@/auth/AuthProvider";
import { DateField } from "@/forms/DateField";
import { initials, titleCase } from "@/lib/format";
import { errorText } from "@/lib/log";
import { useAsyncData } from "@/lib/useAsyncData";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { SearchField } from "@/ui/SearchField";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Banner, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

type Board = Readonly<{
  users: TaskUser[];
  entries: AvailabilityEntry[];
  departments: Array<{ id: string; name: string }>;
}>;
type ViewMode = "all" | "exceptions" | "absent";
type CoverageSummary = Readonly<{ primary_buddy: number; secondary_buddy: number; reporting_manager: number; coverage_required: number; manager_review: number }>;

const STATUS_OPTIONS: ReadonlyArray<{ value: Enums<"availability_status">; label: string }> = [
  { value: "present", label: "Present" },
  { value: "half_day", label: "Half day" },
  { value: "remote", label: "Remote" },
  { value: "absent", label: "Absent" },
];

function kolkataToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function AvailabilityScreen() {
  const profile = useProfile();
  const theme = useAppTheme();
  const styles = useStyles();
  const [startDate, setStartDate] = useState(kolkataToday);
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [mode, setMode] = useState<ViewMode>("all");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [coverage, setCoverage] = useState<CoverageSummary | null>(null);
  const access = useAccess();
  const canLogOthers = hasPermission(access, "availability.manage_others");
  const { data, error, loading, refreshing, refresh, reload } = useAsyncData<Board>(async () => {
    const [allUsers, entries, departments] = await Promise.all([
      loadAvailabilityUsers(), loadAvailabilityForDate(startDate), loadAvailabilityDepartments(),
    ]);
    return { users: canLogOthers ? allUsers : allUsers.filter((user) => user.id === profile.id), entries, departments };
  }, [canLogOthers, profile.id, startDate]);

  const users = data?.users ?? [];
  const entries = data?.entries ?? [];
  const entryByUser = useMemo(() => new Map(entries.map((entry) => [entry.user_profile_id, entry])), [entries]);
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const visibleUsers = useMemo(() => users.filter((user) => {
    const status = entryByUser.get(user.id)?.status ?? "present";
    const needle = search.trim().toLowerCase();
    return (!needle || `${user.employee_name} ${user.employee_code}`.toLowerCase().includes(needle))
      && (!departmentId || user.department_id === departmentId)
      && (mode === "all" || (mode === "exceptions" ? status !== "present" : status === "absent"));
  }), [departmentId, entryByUser, mode, search, users]);
  const absentCount = users.filter((user) => (entryByUser.get(user.id)?.status ?? "present") === "absent").length;

  const setAvailability = async (user: TaskUser, status: Enums<"availability_status">) => {
    setSavingId(user.id);
    setActionError(null);
    try {
      const range = normalizeAvailabilityRange(startDate, endDate);
      const resolvedReason = reason.trim() || entryByUser.get(user.id)?.reason || "";
      setCoverage(await recordAvailabilityRange(user.id, range.startDate, range.endDate, status, resolvedReason));
      await refresh();
    } catch (caught) {
      setActionError(errorText(caught));
    } finally {
      setSavingId(null);
    }
  };

  if (loading) return <LoadingState label="Loading availability..." />;
  if (error) return <ErrorState message={error} onRetry={() => void reload()} title="Could not load availability" />;

  return (
    <Screen
      refreshControl={<RefreshControl colors={[theme.colors.primary]} onRefresh={() => void refresh()} refreshing={refreshing} tintColor={theme.colors.primary} />}
      scroll
    >
      <View style={styles.titleRow}>
        <CalendarCheck color={theme.colors.primary} size={24} />
        <View style={styles.titleCopy}><Text variant="heading" weight="bold">Availability</Text><Text tone="muted" variant="small">An authorized absence immediately checks work due today or tomorrow.</Text></View>
      </View>
      <View style={styles.summary}><StatusBadge label={`${users.length - absentCount} present`} tone="success" /><StatusBadge label={`${absentCount} absent`} tone={absentCount ? "danger" : "neutral"} /></View>
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
      {coverage ? <Banner tone={coverage.coverage_required ? "danger" : coverage.manager_review ? "info" : "success"}>{`Coverage result: ${coverage.primary_buddy} primary, ${coverage.secondary_buddy} secondary, ${coverage.reporting_manager} manager, ${coverage.manager_review} review, ${coverage.coverage_required} unassigned.`}</Banner> : null}
      <SearchField accessibilityLabel="Search team" onChangeText={setSearch} placeholder="Find a team member" value={search} />
      {canLogOthers ? <OptionPicker label="Department" onChange={(selected) => setDepartmentId(selected[0] ?? "")} options={[{ value: "", label: "All departments" }, ...(data?.departments ?? []).map((department) => ({ value: department.id, label: department.name }))]} selected={[departmentId]} /> : null}
      <SegmentedControl accessibilityLabel="Availability filter" onChange={setMode} options={[{ value: "all", label: "All" }, { value: "exceptions", label: "Exceptions" }, { value: "absent", label: "Absent" }]} value={mode} />
      {canLogOthers ? <Card>
        <View style={styles.fields}><View style={styles.field}><Text tone="muted" variant="label">Start date</Text><DateField disabled={false} invalid={false} label="Availability start date" mode="date" onChange={(value) => { setStartDate(value); if (endDate && endDate < value) setEndDate(""); }} value={startDate} /></View><View style={styles.field}><Text tone="muted" variant="label">End date</Text><DateField disabled={false} invalid={false} label="Availability end date" mode="date" onChange={setEndDate} value={endDate} /></View></View>
        <TextField label="Reason" maxLength={500} onChangeText={setReason} placeholder="Optional note" value={reason} />
      </Card> : null}
      <View style={styles.sectionRow}><Users color={theme.colors.primary} size={18} /><Text tone="muted" variant="small">{canLogOthers ? "Mark only people who are away. Each change saves immediately." : "Your current working status for today."}</Text></View>
      {visibleUsers.length === 0 ? <Card><Text style={styles.centered} tone="muted">No team members match the selected view.</Text></Card> : visibleUsers.map((user) => {
        const status = entryByUser.get(user.id)?.status ?? "present";
        const coverageNames = [user.buddy_id, user.secondary_buddy_id, user.reports_to_user_id].map((id) => id ? userById.get(id)?.employee_name : null).filter((name): name is string => Boolean(name));
        return <Card accent={status === "absent" ? "danger" : status === "present" ? "success" : "warning"} key={user.id}>
          <View style={styles.personRow}><View style={styles.avatar}><Text tone="inverse" weight="bold">{initials(user.employee_name)}</Text></View><View style={styles.personCopy}><Text numberOfLines={1} weight="semibold">{user.employee_name}</Text><Text numberOfLines={1} tone="muted" variant="caption">{user.employee_code} · {titleCase(user.user_role)}</Text></View><StatusBadge label={STATUS_OPTIONS.find((item) => item.value === status)?.label ?? titleCase(status)} tone={status === "absent" ? "danger" : status === "present" ? "success" : "warning"} /></View>
          <Text tone={coverageNames.length ? "muted" : "warning"} variant="caption">{coverageNames.length ? `Coverage: ${coverageNames.join(" → ")}` : "No coverage chain configured"}</Text>
          {canLogOthers ? <View style={styles.actions}><Button busy={savingId === user.id} disabled={status === "absent"} label="Mark absent" onPress={() => void setAvailability(user, "absent")} variant="danger" /><View style={styles.statusPicker}><OptionPicker disabled={savingId === user.id} label={`Availability for ${user.employee_name}`} onChange={(selected) => void setAvailability(user, selected[0] as Enums<"availability_status">)} options={STATUS_OPTIONS} selected={[status]} /></View></View> : null}
        </Card>;
      })}
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  titleCopy: { flex: 1, minWidth: 0, gap: 2 },
  summary: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
  fields: { flexDirection: "row", gap: theme.space.sm },
  field: { flex: 1, minWidth: 0, gap: 4 },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  centered: { textAlign: "center" },
  personRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: theme.colors.primary },
  personCopy: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  statusPicker: { flex: 1, minWidth: 0 },
}));
