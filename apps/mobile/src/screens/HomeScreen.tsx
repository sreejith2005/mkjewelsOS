import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useFocusEffect, useNavigation, type CompositeNavigationProp } from "@react-navigation/native";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { AlarmClock, ArrowRight, ChevronDown, Gem } from "lucide-react-native";
import { fetchHomeSummary } from "@jewelos/data/analytics/api";
import type { HomeFms, HomeFmsStarter, HomeSummary } from "@jewelos/data/analytics/types";
import { subscribeToInbox } from "@jewelos/data/notifications/api";
import { subscribeToTenantRealtime } from "@jewelos/data/realtime/api";
import { useAuth, useProfile } from "@/auth/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import { formatDateTime, greetingFor, titleCase } from "@/lib/format";
import { makeStyles } from "@/theme/makeStyles";
import { withAlpha } from "@/theme/color";
import { useAppTheme } from "@/theme/ThemeProvider";
// Trap 1: NativeWind drops a function-form `style` on react-native's Pressable.
import { Pressable } from "@/ui/Pressable";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList, TabParamList } from "@/navigation/types";
import { fmsAssignedWorkRoute, navigateFmsAssignedWork } from "@/features/fms/assignedWorkNavigation";

type Navigation = CompositeNavigationProp<
  BottomTabNavigationProp<TabParamList, "Home">,
  NativeStackNavigationProp<RootStackParamList>
>;

/**
 * Past this many open tasks the group stops growing and offers the Tasks list
 * instead. The web box scrolls inside itself; on a phone a nested scroller
 * fights the page, so the page stays one scroll surface.
 */
const HOME_TASK_LIMIT = 25;

function when(value: string | null | undefined, fallback = "Any time"): string {
  return formatDateTime(value, fallback);
}

/**
 * The first thing a member of staff sees — a port of the web `HomeView`. It
 * reads the same `get_home_summary` RPC, so the two can never disagree about
 * what is outstanding, and it keeps the web page's sections, order, and words.
 */
export function HomeScreen() {
  const theme = useAppTheme();
  const styles = useStyles();
  const profile = useProfile();
  const { branch } = useAuth();
  const navigation = useNavigation<Navigation>();
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(fetchHomeSummary, []);

  // The web Home refreshes on inbox events and on the tenant topics that can
  // change what is waiting; returning to the tab refreshes it too.
  useEffect(() => subscribeToInbox(profile.id, () => void refresh()), [profile.id, refresh]);
  useEffect(
    () => subscribeToTenantRealtime(profile.tenant_id, ["tasks", "fms", "crm", "organization", "settings"], () => void refresh()),
    [profile.tenant_id, refresh],
  );
  const firstFocus = useRef(true);
  useFocusEffect(useCallback(() => {
    if (firstFocus.current) { firstFocus.current = false; return; }
    void refresh();
  }, [refresh]));

  const openStage = useCallback((stage: HomeFms) => {
    navigateFmsAssignedWork(navigation, fmsAssignedWorkRoute(
      stage.form_template_id
        ? { kind: "stage_form", instanceId: stage.instance_id, instanceStageId: stage.stage_id, formTemplateId: stage.form_template_id }
        : { kind: "stage", instanceId: stage.instance_id, instanceStageId: stage.stage_id },
    ));
  }, [navigation]);
  const openStarter = useCallback((starter: HomeFmsStarter) => {
    navigateFmsAssignedWork(navigation, fmsAssignedWorkRoute({ kind: "starter_form", starterAssignmentId: starter.id, formTemplateId: starter.form_template_id }));
  }, [navigation]);
  const openTasks = useCallback(() => navigation.navigate("Tasks"), [navigation]);

  if (loading) return <Screen><LoadingState label="Loading your day…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  if (!data) return null;

  const completed = data.tasks.filter((task) => task.status === "completed").length;
  const openTasksList = data.tasks.filter((task) => task.status !== "completed");
  const priority = openTasksList.filter((task) => task.priority === "high").slice(0, 3);
  const percent = data.tasks.length ? Math.round((completed / data.tasks.length) * 100) : 0;
  const starters = data.fms_starters.slice(0, 4);
  const stages = data.fms_stages.slice(0, Math.max(0, 4 - data.fms_starters.length));

  return (
    <Screen
      padded={false}
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
      <View style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroIdentity}>
            <Text style={styles.greeting} variant="small">{`${greetingFor(data.timezone)},`}</Text>
            <Text numberOfLines={1} style={styles.heroName} variant="heading" weight="semibold">
              {profile.employee_name.split(" ")[0] ?? "User"}
            </Text>
            <View style={styles.heroMeta}>
              <View style={styles.roleChip}>
                <Text style={styles.roleText} variant="caption" weight="medium">{titleCase(profile.user_role || data.profile.role)}</Text>
              </View>
              <Text numberOfLines={1} style={styles.branch} variant="caption">
                {data.profile.branch_name ?? branch?.name ?? "Branch unavailable"}
              </Text>
            </View>
          </View>
          <View style={styles.gem}>
            <Gem color={theme.colors.obsidian} size={24} />
          </View>
        </View>
        <View style={styles.progressCard}>
          <View style={styles.progressHead}>
            <Text style={styles.heroStrong} variant="small" weight="medium">Today&apos;s Completion</Text>
            <Text style={styles.percent} variant="title" weight="semibold">{`${percent}%`}</Text>
          </View>
          <View
            accessibilityLabel={`${percent} percent of today's tasks complete`}
            accessibilityRole="progressbar"
            style={styles.track}
          >
            <View style={[styles.fill, { width: `${percent}%` }]} />
          </View>
          <View style={styles.stats}>
            <HeroStat label="Tasks" value={data.tasks.length} />
            <HeroStat label="Done" value={completed} />
            <HeroStat label="FMS" value={data.fms_starters.length + data.fms_stages.length} />
          </View>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.sectionHead}>
          <View style={styles.sectionCopy}>
            <Text variant="subtitle" weight="semibold">Action required</Text>
            <Text tone="muted" variant="small">Your assigned tasks, FMS steps, and CRM follow-ups are shown below.</Text>
          </View>
          <AlarmClock color={theme.colors.primary} size={20} />
        </View>

        <ActionGroup title="My Tasks">
          {openTasksList.length ? (
            <>
              {openTasksList.slice(0, HOME_TASK_LIMIT).map((task) => (
                <ActionItem
                  description={`Due ${when(task.due_at)}`}
                  key={task.id}
                  label={task.overdue ? "Overdue — open now" : "Assigned task"}
                  onOpen={() => navigation.navigate("TaskDetail", { taskId: task.id })}
                  overdue={task.overdue}
                  title={task.title}
                />
              ))}
              {openTasksList.length > HOME_TASK_LIMIT ? (
                <ViewAll label={`All open tasks (${openTasksList.length})`} onPress={openTasks} />
              ) : null}
            </>
          ) : <EmptyMessage>No tasks waiting.</EmptyMessage>}
        </ActionGroup>

        <ActionGroup title="FMS Tasks">
          {data.fms_starters.length || data.fms_stages.length ? (
            <>
              {starters.map((starter) => (
                <ActionItem
                  description={`Assigned ${when(starter.assigned_at)}`}
                  key={starter.id}
                  label={`Starting form — ${starter.form_name}`}
                  onOpen={() => openStarter(starter)}
                  overdue={false}
                  title={starter.flow_name}
                />
              ))}
              {stages.map((stage) => (
                <ActionItem
                  description={`Due ${when(stage.planned_datetime)}`}
                  key={stage.stage_id}
                  label={stage.form_name ? `Complete FMS form — ${stage.form_name}` : stage.sla_breached ? "SLA Breached" : "Pending step"}
                  onOpen={() => openStage(stage)}
                  overdue={stage.sla_breached}
                  title={`${stage.instance_title} - ${stage.stage_name}`}
                />
              ))}
            </>
          ) : <EmptyMessage>No FMS steps waiting.</EmptyMessage>}
        </ActionGroup>

        <ActionGroup title="CRM Tasks">
          {data.crm_followups.length ? data.crm_followups.slice(0, 4).map((followup) => (
            <ActionItem
              description={`Due ${followup.due_date}`}
              key={followup.id}
              label={followup.overdue ? "Overdue — open now" : "Open follow-up"}
              onOpen={() => navigation.navigate("ClientDetail", { clientId: followup.client_id })}
              overdue={followup.overdue}
              title={followup.subject ?? "Follow-up"}
            />
          )) : <EmptyMessage>No CRM follow-ups due.</EmptyMessage>}
        </ActionGroup>

        <View style={styles.sectionGap}>
          <View style={styles.rowBetween}>
            <Text variant="subtitle" weight="semibold">Priority Tasks Today</Text>
            <ViewAll label="View all" onPress={openTasks} />
          </View>
          {priority.length ? priority.map((task) => (
            <Pressable
              accessibilityRole="button"
              key={task.id}
              onPress={() => navigation.navigate("TaskDetail", { taskId: task.id })}
              style={({ pressed }) => [styles.priorityCard, pressed && styles.pressed]}
            >
              <StatusDot tone={task.overdue ? "danger" : "warning"} />
              <View style={styles.flex}>
                <Text weight="semibold">{task.title}</Text>
                <Text tone="muted" variant="small">{`Due ${when(task.due_at)}`}</Text>
                <Text style={styles.overdueText} variant="caption" weight="semibold">{task.overdue ? "Overdue" : "High priority"}</Text>
              </View>
            </Pressable>
          )) : <EmptyMessage>No high-priority work is waiting.</EmptyMessage>}
        </View>

        <Panel description="Visible only within your authorized CRM scope." title="CRM Follow-ups Due">
          {data.crm_followups.length ? data.crm_followups.map((followup) => (
            <View key={followup.id} style={styles.listRow}>
              <StatusDot tone={followup.overdue ? "danger" : "warning"} />
              <View style={styles.flex}>
                <Text variant="small" weight="medium">{followup.subject ?? "Follow-up"}</Text>
                <Text tone="muted" variant="caption">{`Due ${followup.due_date}${followup.overdue ? " · Overdue" : ""}`}</Text>
              </View>
            </View>
          )) : <EmptyMessage>No CRM follow-ups are due.</EmptyMessage>}
        </Panel>

        <Panel description="Bounded and authorized audit activity." title="Recent Activity">
          {data.recent_activity.length ? data.recent_activity.map((activity) => (
            <View key={activity.id} style={styles.activityRow}>
              <View style={styles.flex}>
                <Text variant="small" weight="medium">{titleCase(activity.action)}</Text>
                <Text tone="muted" variant="caption">{titleCase(activity.module)}</Text>
              </View>
              <Text tone="muted" variant="caption">{when(activity.created_at)}</Text>
            </View>
          )) : <EmptyMessage>No recent activity.</EmptyMessage>}
        </Panel>

        {error ? <Text tone="danger" variant="caption">{`Could not refresh: ${error}`}</Text> : null}
      </View>
    </Screen>
  );
}

function HeroStat({ label, value }: { label: string; value: number }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.heroStrong} variant="title" weight="semibold">{String(value)}</Text>
      <Text numberOfLines={1} style={styles.statLabel} variant="caption">{label}</Text>
    </View>
  );
}

/**
 * Collapsible like the web Home action groups: open by default, session-only
 * state, and the body is hidden rather than unmounted so collapsing never
 * throws away what it has loaded.
 */
function ActionGroup({ title, children }: { title: string; children: ReactNode }) {
  const theme = useAppTheme();
  const styles = useStyles();
  const [expanded, setExpanded] = useState(true);
  return (
    <View style={styles.group}>
      <Pressable
        accessibilityLabel={title}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        hitSlop={8}
        onPress={() => setExpanded((open) => !open)}
        style={({ pressed }) => [styles.groupHeader, pressed && styles.pressed]}
      >
        <Text numberOfLines={1} style={styles.groupTitle} tone="muted" variant="small" weight="semibold">{title.toUpperCase()}</Text>
        <ChevronDown color={theme.colors.textMuted} size={16} style={expanded ? styles.chevronOpen : undefined} />
      </Pressable>
      <View style={[styles.groupBody, !expanded && styles.hidden]}>{children}</View>
    </View>
  );
}

function ActionItem({ title, description, label, overdue, onOpen }: { title: string; description: string; label: string; overdue: boolean; onOpen: () => void }) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityLabel={`${title}. ${label}`}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.actionItem, pressed && styles.actionPressed]}
    >
      <StatusDot tone={overdue ? "danger" : "warning"} />
      <View style={styles.flex}>
        <Text style={styles.actionTitle} weight="semibold">{title}</Text>
        <Text tone="muted" variant="small">{description}</Text>
        <Text style={overdue ? styles.overdueText : styles.accentText} variant="caption" weight="semibold">{label}</Text>
      </View>
    </Pressable>
  );
}

function Panel({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <Text variant="subtitle" weight="semibold">{title}</Text>
        <Text tone="muted" variant="caption">{description}</Text>
      </View>
      {children}
    </View>
  );
}

function StatusDot({ tone }: { tone: "danger" | "warning" }) {
  const styles = useStyles();
  return <View style={[styles.dot, tone === "danger" ? styles.dotDanger : styles.dotWarning]} />;
}

function EmptyMessage({ children }: { children: string }) {
  const styles = useStyles();
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText} tone="muted" variant="small">{children}</Text>
    </View>
  );
}

function ViewAll({ label, onPress }: { label: string; onPress: () => void }) {
  const theme = useAppTheme();
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.viewAll, pressed && styles.pressed]}
    >
      <Text style={styles.accentText} variant="small" weight="semibold">{label}</Text>
      <ArrowRight color={theme.colors.primary} size={16} />
    </Pressable>
  );
}

/** Kept for the type-checker: the summary shape the screen relies on. */
export type HomeScreenData = HomeSummary;

const useStyles = makeStyles((theme) => StyleSheet.create({
  hero: {
    backgroundColor: theme.colors.charcoal,
    paddingHorizontal: theme.space.md,
    paddingTop: 20,
    paddingBottom: 32,
    gap: 20,
  },
  heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.space.md },
  heroIdentity: { flex: 1, minWidth: 0 },
  greeting: { color: theme.colors.champagne, opacity: 0.7 },
  heroName: { color: theme.colors.white, marginTop: 2 },
  heroMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: theme.space.sm, marginTop: theme.space.sm },
  roleChip: {
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.gold, 0.3),
    backgroundColor: withAlpha(theme.colors.gold, 0.1),
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  roleText: { color: theme.colors.gold },
  branch: { flexShrink: 1, color: theme.colors.champagne, opacity: 0.65 },
  gem: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.gold,
  },
  progressCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: withAlpha(theme.colors.gold, 0.2),
    backgroundColor: withAlpha(theme.colors.obsidian, 0.45),
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  progressHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.space.sm },
  heroStrong: { color: theme.colors.white },
  percent: { color: theme.colors.gold },
  track: { height: 8, borderRadius: theme.radius.pill, backgroundColor: withAlpha(theme.colors.white, 0.15), overflow: "hidden" },
  fill: { height: "100%", borderRadius: theme.radius.pill, backgroundColor: theme.colors.gold },
  stats: { flexDirection: "row", marginTop: theme.space.sm },
  stat: { flex: 1, minWidth: 0, alignItems: "center" },
  statLabel: { color: theme.colors.champagne, opacity: 0.6 },
  body: {
    marginTop: -16,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: theme.colors.taskMuted,
    paddingHorizontal: theme.space.md,
    paddingTop: 24,
    paddingBottom: 32,
    gap: 20,
  },
  sectionHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.space.sm },
  sectionCopy: { flex: 1, minWidth: 0, gap: 4 },
  sectionGap: { gap: theme.space.sm },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.space.sm },
  group: { gap: theme.space.sm },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.space.sm,
    minHeight: theme.touchTarget,
  },
  groupTitle: { flex: 1, minWidth: 0, letterSpacing: 0.6 },
  chevronOpen: { transform: [{ rotate: "180deg" }] },
  groupBody: { gap: theme.space.sm },
  hidden: { display: "none" },
  actionItem: {
    flexDirection: "row",
    gap: theme.space.sm,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.colors.taskBorder,
    backgroundColor: theme.colors.taskBg,
    padding: theme.space.md,
  },
  actionPressed: { backgroundColor: theme.colors.taskMuted },
  actionTitle: { fontSize: 15, lineHeight: 20 },
  accentText: { color: theme.colors.taskAccent, marginTop: 4 },
  overdueText: { color: theme.colors.taskOverdue, marginTop: 4 },
  flex: { flex: 1, minWidth: 0, gap: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 7 },
  dotDanger: { backgroundColor: theme.colors.danger },
  dotWarning: { backgroundColor: theme.colors.warning },
  priorityCard: {
    flexDirection: "row",
    gap: theme.space.sm,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.taskBorder,
    backgroundColor: theme.colors.taskBg,
    padding: theme.space.md,
  },
  panel: {
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    borderColor: theme.colors.taskBorder,
    backgroundColor: theme.colors.taskBg,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  panelHead: { gap: 2, marginBottom: theme.space.xs },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  activityRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.space.sm },
  empty: {
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.taskBorder,
    padding: theme.space.md,
  },
  emptyText: { textAlign: "center" },
  viewAll: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: theme.touchTarget },
  pressed: { opacity: 0.7 },
}));
