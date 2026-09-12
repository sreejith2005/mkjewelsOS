import { useMemo, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import {
  assignImportedTask,
  loadAssigningLeftTasks,
  loadTaskImportIdentityCandidates,
  type AssigningLeftRecord,
} from "@jewelos/data/taskImport/api";
import { useProfile } from "@/auth/AuthProvider";
import { errorText } from "@/lib/log";
import { useAsyncData } from "@/lib/useAsyncData";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Card, CardRow, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { Banner, EmptyState, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";

const loadAll = async () => {
  const [records, candidates] = await Promise.all([loadAssigningLeftTasks(), loadTaskImportIdentityCandidates()]);
  return { records, candidates };
};

/**
 * Imported tasks whose employee name was blank or unclear. They wait here
 * safely: assigning is optional and unassigned recurring schedules stay
 * paused, which is the rule the web page states in the same words.
 */
export function AssigningLeftScreen() {
  const profile = useProfile();
  const theme = useAppTheme();
  const styles = useStyles();
  const authorized = profile.user_role === "super_admin" || profile.user_role === "admin";
  const state = useAsyncData(() => (authorized ? loadAll() : Promise.resolve(null)), [authorized]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const candidateOptions = useMemo(
    () => (state.data?.candidates ?? []).map((item) => ({ value: item.id, label: item.employee_name })),
    [state.data],
  );

  if (!authorized) {
    return (
      <Screen>
        <ErrorState message="Assigning Left is available only to administrators." title="Not available" />
      </Screen>
    );
  }
  if (state.loading) return <Screen><LoadingState label="Loading Assigning Left…" /></Screen>;
  if (state.error && !state.data) return <Screen><ErrorState message={state.error} onRetry={() => void state.reload()} /></Screen>;

  const assign = async (record: AssigningLeftRecord, userProfileId: string) => {
    if (!userProfileId) return;
    setBusyId(record.id);
    setActionError(null);
    try {
      await assignImportedTask(record.record_kind, record.id, userProfileId);
      await state.refresh();
    } catch (caught) {
      setActionError(errorText(caught));
    } finally {
      setBusyId(null);
    }
  };

  const records = state.data?.records ?? [];
  return (
    <Screen
      refreshControl={
        <RefreshControl
          colors={[theme.colors.primary]}
          onRefresh={() => void state.refresh()}
          refreshing={state.refreshing}
          tintColor={theme.colors.primary}
        />
      }
      scroll
    >
      <View style={styles.heading}>
        <Text tone="primary" variant="heading" weight="semibold">Assigning Left</Text>
        <Text tone="muted" variant="small">
          Tasks with blank or unclear employee names wait here until you choose someone.
        </Text>
      </View>
      <Banner tone="info">
        You can assign these now or later. Unassigned recurring schedules stay paused.
      </Banner>
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {records.length === 0 ? (
        <EmptyState message="Every imported task has an owner." title="Nothing waiting" />
      ) : null}
      {records.map((record) => (
        <Card key={`${record.record_kind}:${record.id}`}>
          <View style={styles.row}>
            <Text style={styles.flex} weight="semibold">{record.title}</Text>
            <StatusBadge
              label={record.record_kind === "template" ? "Recurring" : "Task"}
              tone={record.record_kind === "template" ? "warning" : "neutral"}
            />
          </View>
          <CardRow label="Destination" value={record.destination} />
          {record.starts_at ? <CardRow label="Starts" value={record.starts_at} /> : null}
          {record.verification_pending ? <CardRow label="Verification" value="Pending" /> : null}
          <OptionPicker
            disabled={busyId === record.id}
            label="Assign to"
            onChange={(values) => void assign(record, values[0] ?? "")}
            options={candidateOptions}
            placeholder={busyId === record.id ? "Assigning…" : "Choose an employee"}
            selected={[]}
          />
        </Card>
      ))}
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  heading: { gap: theme.space.xs },
  row: { flexDirection: "row", gap: theme.space.sm, alignItems: "flex-start" },
  flex: { flex: 1, minWidth: 0 },
}));
