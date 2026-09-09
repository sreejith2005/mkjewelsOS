import { useCallback, useMemo } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { calculateFmsProgress, deriveFmsTransitionCapability } from "@jewelos/core";
import { loadFmsRuntime } from "@jewelos/data/fms/api";
import { useProfile } from "@/auth/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import { formatDateTime } from "@/lib/format";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Card, StatusBadge } from "@/ui/Card";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { EmptyState, ErrorState, LoadingState } from "@/ui/states";
import type { RootStackParamList } from "@/navigation/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "FmsInstance">;

const ACTIONABLE = new Set(["pending", "in_progress", "in_review", "overdue"]);

/**
 * One workflow, as the vertical timeline the desktop graph becomes on a phone.
 *
 * The graph's value on a desktop is seeing every branch at once; on a phone
 * what matters is which step is live and whether it is mine, so the stages are
 * shown in the order the instance actually reached them.
 */
export function FmsInstanceScreen() {
  const theme = useAppTheme();
  const styles = useStyles();
  const profile = useProfile();
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(loadFmsRuntime, []);

  const instance = useMemo(
    () => data?.instances.find((item) => item.id === params.instanceId) ?? null,
    [data, params.instanceId],
  );

  const stages = useMemo(
    () => (data?.stages ?? []).filter((stage) => stage.fms_instance_id === params.instanceId),
    [data, params.instanceId],
  );

  const definitionFor = useCallback(
    (stageId: string) => data?.definitions.find((item) => item.id === stageId) ?? null,
    [data],
  );

  if (loading) return <Screen><LoadingState label="Loading the workflow…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  if (!instance) {
    return (
      <Screen>
        <EmptyState
          message="It may have been cancelled, or it is outside what you are authorised to see."
          title="Workflow not available"
        />
      </Screen>
    );
  }

  const progress = calculateFmsProgress(
    stages.map((stage) => ({
      required: definitionFor(stage.fms_stage_id)?.is_required ?? true,
      status: stage.status as never,
    })),
  );
  const flow = data?.flows.find((item) => item.id === instance.fms_flow_id);

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
        <Text tone="primary" variant="caption">
          {instance.reference_number}
        </Text>
        <Text variant="title" weight="semibold">
          {instance.title}
        </Text>
        <Text tone="muted" variant="caption">
          {flow?.name ?? "Historical workflow"} · version {instance.flow_version}
        </Text>
        <View
          accessibilityLabel={`${progress.percent} percent complete`}
          accessibilityRole="progressbar"
          style={styles.track}
        >
          <View style={[styles.fill, { width: `${progress.percent}%` }]} />
        </View>
        <Text tone="muted" variant="caption">
          {progress.completed}/{progress.total} required steps · {progress.percent}%
        </Text>
      </View>

      {stages.length === 0 ? (
        <EmptyState message="No steps have been created for this workflow yet." title="No steps" />
      ) : (
        stages.map((stage) => {
          const definition = definitionFor(stage.fms_stage_id);
          if (!definition) return null;
          const capability = deriveFmsTransitionCapability({
            viewerId: profile.id,
            viewerRole: profile.user_role,
            assignedIds: stage.assigned_to ?? [],
            instanceStatus: instance.status,
            stageStatus: stage.status as never,
            stage: {
              type: definition.step_type,
              canReject: definition.can_reject ?? false,
              canRequestRevision: definition.can_request_revision ?? false,
              canMoveBackward: definition.can_move_backward ?? false,
              canEscalate: definition.can_escalate ?? false,
            },
          });
          const live = ACTIONABLE.has(stage.status);
          const mine = (stage.assigned_to ?? []).includes(profile.id);
          const actionable = capability.canComplete || capability.canApprove;

          return (
            <Card
              accent={stage.status === "completed" ? "success" : live && mine ? "primary" : "none"}
              accessibilityHint={actionable ? "Opens the step so you can complete it" : "Opens the step"}
              key={stage.id}
              onPress={() =>
                navigation.navigate("FmsStage", { instanceId: instance.id, instanceStageId: stage.id })
              }
            >
              <View style={styles.stageHead}>
                <Text style={styles.stageName} variant="body" weight="semibold">
                  {definition.name}
                </Text>
                <StatusBadge
                  label={stage.status.replaceAll("_", " ")}
                  tone={
                    stage.status === "completed"
                      ? "success"
                      : stage.status === "overdue"
                        ? "danger"
                        : live
                          ? "primary"
                          : "neutral"
                  }
                />
              </View>
              {definition.method ? (
                <Text tone="muted" variant="caption">
                  {definition.method}
                </Text>
              ) : null}
              <Text tone="muted" variant="caption">
                Assigned to{" "}
                {(stage.assigned_to ?? [])
                  .map((id) => data?.users.find((user) => user.id === id)?.employee_name ?? "a former colleague")
                  .join(", ") || "nobody yet"}
              </Text>
              <Text tone="muted" variant="caption">
                Due {formatDateTime(stage.planned_datetime, "No deadline")}
              </Text>
              <View style={styles.badges}>
                {mine && live ? <StatusBadge label="Waiting on you" tone="primary" /> : null}
                {definition.form_template_id ? (
                  <StatusBadge
                    label={stage.form_submission_id ? "Form submitted" : "Form required"}
                    tone={stage.form_submission_id ? "success" : "warning"}
                  />
                ) : null}
              </View>
            </Card>
          );
        })
      )}
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  header: { gap: theme.space.xs },
  track: {
    height: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.surface,
    overflow: "hidden",
    marginTop: theme.space.sm,
  },
  fill: { height: "100%", backgroundColor: theme.colors.primary },
  stageHead: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.space.sm },
  stageName: { flex: 1, minWidth: 0 },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
}));
