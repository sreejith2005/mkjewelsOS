import { useCallback, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { fetchHomeSummary } from "@jewelos/data/analytics/api";
import type { HomeSummary } from "@jewelos/data/analytics/types";
import { useAuth, useProfile } from "@/auth/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import { formatDateTime, greetingFor, titleCase } from "@/lib/format";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Card, StatusBadge } from "@/ui/Card";
// Trap 1: NativeWind drops a function-form `style` on react-native's Pressable.
import { Pressable } from "@/ui/Pressable";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";
import { fmsAssignedWorkRoute, navigateFmsAssignedWork } from "@/features/fms/assignedWorkNavigation";
import type { HomeFms } from "@jewelos/data/analytics/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;

/**
 * The first thing a member of staff sees: what is waiting for them today, in
 * the order they will act on it. It reads the same `get_home_summary` RPC as
 * the web home, so the two can never disagree about what is outstanding.
 */
export function HomeScreen() {
  const theme = useAppTheme();
  const styles = useStyles();
  const profile = useProfile();
  const { branch } = useAuth();
  const navigation = useNavigation<Navigation>();
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(fetchHomeSummary, []);

  /** Home opens the same exact surface the web Home does, via the shared union. */
  const openAssignedStage = useCallback(
    (stage: HomeFms) => {
      const route = fmsAssignedWorkRoute(
        stage.form_template_id
          ? {
              kind: "stage_form",
              instanceId: stage.instance_id,
              instanceStageId: stage.stage_id,
              formTemplateId: stage.form_template_id,
            }
          : { kind: "stage", instanceId: stage.instance_id, instanceStageId: stage.stage_id },
      );
      navigateFmsAssignedWork(navigation, route);
    },
    [navigation],
  );

  if (loading) return <Screen><LoadingState label="Loading your day…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  if (!data) return null;

  const open = data.tasks.filter((task) => task.status !== "completed");
  const completed = data.tasks.length - open.length;
  const percent = data.tasks.length ? Math.round((completed / data.tasks.length) * 100) : 0;
  const fmsWaiting = data.fms_starters.length + data.fms_stages.length;

  return (
    <Screen
      refreshControl={
        <RefreshControl
          colors={[theme.colors.primary]}
          onRefresh={() => void refresh()}
          refreshing={refreshing}
          tintColor={theme.colors.primary}
        />
      }
      scroll
    >
      <View style={styles.header}>
        <Text tone="muted" variant="small">
          {greetingFor(data.timezone)},
        </Text>
        <Text numberOfLines={1} tone="primary" variant="heading" weight="semibold">
          {profile.employee_name.split(" ")[0] ?? "there"}
        </Text>
        <View style={styles.headerMeta}>
          <StatusBadge label={titleCase(profile.user_role)} tone="primary" />
          <Text numberOfLines={1} style={styles.branch} tone="muted" variant="caption">
            {data.profile.branch_name ?? branch?.name ?? "Branch unavailable"}
          </Text>
        </View>
      </View>

      <Card>
        <View style={styles.progressHead}>
          <Text tone="warm" variant="small" weight="medium">
            Today&apos;s completion
          </Text>
          <Text tone="primary" variant="title" weight="semibold">
            {percent}%
          </Text>
        </View>
        <View
          accessibilityLabel={`${percent} percent of today's tasks complete`}
          accessibilityRole="progressbar"
          style={styles.track}
        >
          <View style={[styles.fill, { width: `${percent}%` }]} />
        </View>
        <View style={styles.stats}>
          <Stat label="Tasks" value={data.tasks.length} />
          <Stat label="Done" value={completed} />
          <Stat label="FMS" value={fmsWaiting} />
        </View>
      </Card>

      <Section title="My tasks">
        {open.length === 0 ? (
          <EmptyState message="Nothing is waiting for you right now." title="No open tasks" />
        ) : (
          open.slice(0, 5).map((task) => (
            <Card
              accent={task.overdue ? "danger" : "warning"}
              accessibilityHint="Opens the task"
              key={task.id}
              onPress={() => navigation.navigate("TaskDetail", { taskId: task.id })}
            >
              <Text variant="body" weight="semibold">
                {task.title}
              </Text>
              <Text tone="muted" variant="caption">
                Due {formatDateTime(task.due_at)}
              </Text>
              <StatusBadge
                label={task.overdue ? "Overdue" : task.priority === "high" ? "High priority" : "Assigned"}
                tone={task.overdue ? "danger" : task.priority === "high" ? "warning" : "neutral"}
              />
            </Card>
          ))
        )}
      </Section>

      <Section title="FMS steps">
        {fmsWaiting === 0 ? (
          <EmptyState message="No workflow steps are assigned to you." title="No FMS steps waiting" />
        ) : (
          <>
            {data.fms_starters.map((starter) => (
              <Card
                accent="primary"
                accessibilityHint="Opens the starting form for this workflow"
                key={starter.id}
                onPress={() =>
                  navigation.navigate("FormFill", {
                    formTemplateId: starter.form_template_id,
                    starterAssignmentId: starter.id,
                  })
                }
              >
                <Text variant="body" weight="semibold">
                  {starter.flow_name}
                </Text>
                <Text tone="muted" variant="caption">
                  Starting form — complete it to begin
                </Text>
              </Card>
            ))}
            {data.fms_stages.map((stage) => (
              <Card
                accent={stage.sla_breached ? "danger" : "warning"}
                accessibilityHint="Opens the workflow"
                key={stage.stage_id}
                onPress={() => openAssignedStage(stage)}
              >
                <Text variant="body" weight="semibold">
                  {stage.instance_title}
                </Text>
                <Text tone="warm" variant="small">
                  {stage.stage_name}
                </Text>
                <Text tone="muted" variant="caption">
                  Due {formatDateTime(stage.planned_datetime)}
                </Text>
                {stage.sla_breached ? <StatusBadge label="SLA breached" tone="danger" /> : null}
              </Card>
            ))}
          </>
        )}
      </Section>

      <Section title="CRM follow-ups">
        {data.crm_followups.length === 0 ? (
          <EmptyState message="Nothing is due today." title="No follow-ups due" />
        ) : (
          data.crm_followups.map((followup) => (
            <Card
              accent={followup.overdue ? "danger" : "none"}
              accessibilityHint="Opens the client"
              key={followup.id}
              onPress={() => navigation.navigate("ClientDetail", { clientId: followup.client_id })}
            >
              <Text variant="body" weight="semibold">
                {followup.subject ?? "Follow-up"}
              </Text>
              <Text tone="muted" variant="caption">
                Due {followup.due_date}
                {followup.overdue ? " · Overdue" : ""}
              </Text>
            </Card>
          ))
        )}
      </Section>

      {error ? (
        <Text tone="danger" variant="caption">
          Could not refresh: {error}
        </Text>
      ) : null}
    </Screen>
  );
}

/**
 * A collapsible block on the home screen.
 *
 * Open by default, and the state lives here rather than in storage, so it
 * lasts for the session and the screen always opens showing the work. The
 * body is hidden, never unmounted: collapsing a section must not throw away
 * what it has already loaded, or expanding it again would cost a fetch.
 *
 * Presentation only — web has no equivalent control — so the titles and
 * everything inside are untouched.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const styles = useStyles();
  const [expanded, setExpanded] = useState(true);
  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={title}
        hitSlop={8}
        onPress={() => setExpanded((open) => !open)}
        style={({ pressed }) => [styles.sectionHeader, pressed && styles.sectionHeaderPressed]}
      >
        <Text style={styles.sectionTitle} tone="warm" variant="subtitle" weight="semibold">
          {title}
        </Text>
        <Text tone="muted" variant="subtitle">
          {expanded ? "⌃" : "⌄"}
        </Text>
      </Pressable>
      <View style={[styles.sectionBody, !expanded && styles.sectionBodyHidden]}>
        {children}
      </View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text variant="title" weight="semibold">
        {value}
      </Text>
      <Text tone="muted" variant="caption">
        {label}
      </Text>
    </View>
  );
}

/** Kept for the type-checker: the summary shape the screen relies on. */
export type HomeScreenData = HomeSummary;

const useStyles = makeStyles((theme) => StyleSheet.create({
  header: { gap: 2 },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, marginTop: theme.space.xs },
  branch: { flex: 1, minWidth: 0 },
  progressHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  track: { height: 8, borderRadius: theme.radius.pill, backgroundColor: theme.colors.surface, overflow: "hidden" },
  fill: { height: "100%", backgroundColor: theme.colors.primary },
  stats: { flexDirection: "row", marginTop: theme.space.xs },
  stat: { flex: 1, alignItems: "center", gap: 2 },
  section: { gap: theme.space.sm, marginTop: theme.space.sm },
  // A full-width row at the minimum comfortable touch target, so the whole
  // header is the control rather than just the words.
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
    minHeight: theme.touchTarget,
  },
  sectionHeaderPressed: { opacity: 0.7 },
  sectionTitle: { flex: 1, minWidth: 0 },
  sectionBody: { gap: theme.space.sm },
  sectionBodyHidden: { display: "none" },
}));
