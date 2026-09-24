import { useCallback, useMemo, useState } from "react";
import { Alert, RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as WebBrowser from "expo-web-browser";
import { deriveFmsTransitionCapability } from "@jewelos/core";
import {
  claimFmsStage,
  completeFmsStage,
  escalateFmsStage,
  loadFmsRuntime,
  moveFmsStageBackward,
  reassignFmsStage,
  requestFmsRevision,
  reviewFmsStage,
  signedFmsEvidenceUrl,
  updateFmsChecklistItem,
  uploadFmsEvidence,
} from "@jewelos/data/fms/api";
import { eligibleFmsUsers, isInitialFmsDefinition, priorFmsDefinitions } from "@jewelos/data/fms/runtimeView";
import { loadFormDynamicOptions, loadTaskForms } from "@jewelos/data/forms/api";
import { useProfile } from "@/auth/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import { formatDate } from "@/lib/format";
import { errorText, log } from "@/lib/log";
import { pickFileFromChooser } from "@/lib/pickFile";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { ToggleField } from "@/forms/ToggleField";
import { Banner, ErrorState, LoadingState } from "@/ui/states";
import { runtimeDecisionOptions } from "@/fms/decisions";
import type { RootStackParamList } from "@/navigation/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "FmsStage">;
type ManagedAction = "reassign" | "backward" | "revision" | "escalate";

const MANAGED_TITLES: Record<ManagedAction, string> = {
  reassign: "Reassign",
  backward: "Move backward",
  revision: "Request revision",
  escalate: "Escalate",
};

function confirm(title: string, message: string, action: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: action, style: "destructive", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

/**
 * One workflow step, and everything a person can do to it — the web
 * `FmsStageRunner`.
 *
 * The branch that follows is never decided here. Every action calls the same
 * audited RPC the web calls, and the server resolves the route and activates
 * the next node inside that transaction — so a phone and a browser cannot send
 * a workflow down different paths.
 */
export function FmsStageScreen() {
  const theme = useAppTheme();
  const styles = useStyles();
  const profile = useProfile();
  const navigation = useNavigation<Navigation>();
  const { params } = useRoute<Route>();

  const [remark, setRemark] = useState("");
  const [outcome, setOutcome] = useState("");
  const [nextAssignee, setNextAssignee] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [managedAction, setManagedAction] = useState<ManagedAction | null>(null);
  const [fromUser, setFromUser] = useState("");
  const [targetUser, setTargetUser] = useState("");
  const [targetStage, setTargetStage] = useState("");
  const [actionReason, setActionReason] = useState("");

  const load = useCallback(async () => {
    const [runtime, options] = await Promise.all([loadFmsRuntime(), loadFormDynamicOptions()]);
    // Which form this step links to is only known once the runtime has loaded,
    // so the form is fetched afterwards — one template rather than the whole
    // library, which `loadForms()` would have pulled.
    const linkedId = runtime.definitions.find(
      (item) => item.id === runtime.stages.find((row) => row.id === params.instanceStageId)?.fms_stage_id,
    )?.form_template_id;
    const forms = linkedId ? (await loadTaskForms([linkedId], [])).bundles : [];
    return { runtime, forms, options };
  }, [params.instanceStageId]);
  const { data, error, loading, refreshing, reload, refresh } = useAsyncData(load, [load]);

  const stage = useMemo(
    () => data?.runtime.stages.find((item) => item.id === params.instanceStageId) ?? null,
    [data, params.instanceStageId],
  );
  const instance = useMemo(
    () => data?.runtime.instances.find((item) => item.id === params.instanceId) ?? null,
    [data, params.instanceId],
  );
  const definition = useMemo(
    () => (stage ? data?.runtime.definitions.find((item) => item.id === stage.fms_stage_id) ?? null : null),
    [data, stage],
  );
  const checklist = useMemo(
    () => (data?.runtime.checklist ?? []).filter((item) => item.fms_instance_stage_id === params.instanceStageId),
    [data, params.instanceStageId],
  );
  const evidence = useMemo(
    () => (data?.runtime.evidence ?? []).filter((item) => item.fms_instance_stage_id === params.instanceStageId),
    [data, params.instanceStageId],
  );

  const run = async (action: () => Promise<unknown>) => {
    if (busy) return false;
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (caught) {
      log.error("fms", "stage action failed", caught);
      setActionError(errorText(caught));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Screen><LoadingState label="Loading the step…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  if (!data || !stage || !instance || !definition) {
    return (
      <Screen>
        <ErrorState
          message="This step is no longer available, or it is outside what you are authorised to see."
          onRetry={() => void reload()}
          title="Step not available"
        />
      </Screen>
    );
  }

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

  const plannedRule =
    definition.planned_time_rule && typeof definition.planned_time_rule === "object"
      ? (definition.planned_time_rule as Record<string, unknown>)
      : {};
  const decisions = runtimeDecisionOptions(plannedRule);
  const isDecision = decisions.length > 0;
  const requiresLinkedForm = isInitialFmsDefinition(data.runtime.definitions, definition);
  const linkedForm = data.forms.find((form) => form.id === definition.form_template_id) ?? null;
  const checklistPayload = Object.fromEntries(checklist.map((item) => [item.item_key, item.is_completed]));
  const canClaim =
    (stage.assigned_to ?? []).includes(profile.id) &&
    ["pending", "in_progress", "in_review", "overdue"].includes(stage.status) &&
    ["active", "overdue"].includes(instance.status);
  const eligible = eligibleFmsUsers(data.runtime.users, instance);
  const peopleOptions = eligible.map((user) => ({ value: user.id, label: user.employee_code ? `${user.employee_name} · ${user.employee_code}` : user.employee_name }));
  const nameOf = (id: string) => data.runtime.users.find((user) => user.id === id)?.employee_name ?? "Historical user";
  const instanceStages = data.runtime.stages.filter((item) => item.fms_instance_id === instance.id);
  const priorStages = priorFmsDefinitions(data.runtime.definitions, instanceStages, instance.fms_flow_id, definition);
  const assignedNames = (stage.assigned_to ?? []).map(nameOf).join(", ") || "Automatic";

  const attachEvidence = async () => {
    const picked = await pickFileFromChooser("Upload evidence");
    if (!picked.ok) {
      if (!picked.cancelled) setActionError(picked.message);
      return;
    }
    await run(() => uploadFmsEvidence(stage.id, profile.tenant_id, picked.file));
  };

  const openManagedAction = (action: ManagedAction) => {
    setManagedAction(action);
    setFromUser(stage.assigned_to?.[0] ?? "");
    setTargetUser("");
    setTargetStage(priorStages.at(-1)?.id ?? "");
    setActionReason("");
  };

  const runManagedAction = async () => {
    if (!managedAction || !actionReason.trim()) return;
    let done = false;
    if (managedAction === "reassign" && fromUser && targetUser) done = await run(() => reassignFmsStage(stage.id, fromUser, targetUser, actionReason));
    if (managedAction === "backward" && targetStage) done = await run(() => moveFmsStageBackward(stage.id, targetStage, actionReason, targetUser || null));
    if (managedAction === "revision" && targetStage) done = await run(() => requestFmsRevision(stage.id, targetStage, actionReason, targetUser || null));
    if (managedAction === "escalate") done = await run(() => escalateFmsStage(stage.id, actionReason));
    if (done) setManagedAction(null);
  };

  const reject = async () => {
    if (!(await confirm("Reject this stage?", "The stage is rejected with your remark.", "Reject"))) return;
    await run(() => reviewFmsStage(stage.id, "rejected", remark, nextAssignee || null));
  };

  const confirmDisabled = busy
    || !actionReason.trim()
    || (managedAction === "reassign" && !targetUser)
    || ((managedAction === "backward" || managedAction === "revision") && !targetStage);

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
      {actionError ? <Banner tone="danger">{actionError}</Banner> : null}

      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Text style={styles.flex} variant="title" weight="semibold">{definition.name}</Text>
          <StatusBadge
            label={stage.status.replaceAll("_", " ")}
            tone={stage.status === "completed" ? "success" : stage.status === "overdue" ? "danger" : "primary"}
          />
        </View>
        {definition.method ? <Text tone="muted" variant="small">{definition.method}</Text> : null}
        <Text tone="muted" variant="caption">
          {`Assigned: ${assignedNames} · Due ${stage.planned_datetime ? formatDate(stage.planned_datetime) : "—"}${stage.delay_minutes && stage.delay_minutes > 0 ? " · overdue" : ""}`}
        </Text>
      </View>

      {canClaim ? (
        <Button busy={busy} label="Claim stage" onPress={() => void run(() => claimFmsStage(stage.id))} variant="secondary" />
      ) : null}

      {checklist.length > 0 ? (
        <Card>
          <Text tone="warm" variant="subtitle" weight="semibold">Checklist</Text>
          {checklist.map((item) => (
            <ToggleField
              disabled={(!capability.canComplete && !capability.canApprove) || busy}
              key={item.id}
              label={item.label}
              onChange={(next) => void run(() => updateFmsChecklistItem(item.id, next))}
              required={item.is_required}
              value={item.is_completed}
            />
          ))}
        </Card>
      ) : null}

      {evidence.length > 0 ? (
        <View style={styles.actions}>
          {evidence.map((item) => (
            <Button
              key={item.id}
              label={`View ${item.original_filename}`}
              onPress={() =>
                void signedFmsEvidenceUrl(item.storage_path)
                  .then((url) => WebBrowser.openBrowserAsync(url))
                  .catch((caught: unknown) => setActionError(errorText(caught)))
              }
              variant="secondary"
            />
          ))}
        </View>
      ) : null}

      {definition.requires_upload ? (
        <Card>
          <Text tone="warm" variant="label" weight="medium">Evidence (JPG, PNG, WebP, PDF; max 10 MB)</Text>
          <Button busy={busy} label="Choose a photo or file" onPress={() => void attachEvidence()} variant="secondary" />
        </Card>
      ) : null}

      {definition.form_template_id ? (
        stage.form_submission_id ? (
          <Banner tone="success">Linked form version submitted and locked.</Banner>
        ) : linkedForm ? (
          <Button
            label={`Fill ${requiresLinkedForm ? "required" : "optional"} form · ${linkedForm.name} v${linkedForm.version}`}
            onPress={() =>
              navigation.navigate("FmsStageForm", {
                instanceId: params.instanceId,
                instanceStageId: stage.id,
                formTemplateId: linkedForm.id,
              })
            }
            variant="secondary"
          />
        ) : requiresLinkedForm ? (
          <Banner tone="danger">The exact pinned form version is not visible.</Banner>
        ) : (
          <Banner>Optional linked form is not currently visible. You can still complete this step.</Banner>
        )
      ) : null}

      {capability.canComplete || capability.canApprove ? (
        <Card>
          {isDecision ? (
            <View style={styles.group}>
              <Text tone="warm" variant="label" weight="medium">Decision *</Text>
              {decisions.map((option) => (
                <Button
                  key={option.key}
                  label={option.label}
                  onPress={() => setOutcome(option.key)}
                  variant={outcome === option.key ? "primary" : "secondary"}
                />
              ))}
            </View>
          ) : (
            <TextField label="Outcome" maxLength={500} onChangeText={setOutcome} value={outcome} />
          )}

          <TextField
            label={definition.requires_remark ? "Remark *" : "Remark"}
            maxLength={4000}
            multiline
            onChangeText={setRemark}
            value={remark}
          />

          {definition.requires_next_doer_handoff ? (
            <OptionPicker
              label="Next-stage assignee"
              onChange={(next) => setNextAssignee(next[0] ?? "")}
              options={peopleOptions}
              selected={nextAssignee ? [nextAssignee] : []}
            />
          ) : null}

          <View style={styles.actions}>
            {capability.canComplete ? (
              <Button
                busy={busy}
                disabled={isDecision && !outcome}
                label={isDecision ? "Submit decision" : "Complete stage"}
                onPress={() => void run(() => completeFmsStage(stage.id, outcome, remark, checklistPayload, nextAssignee || null))}
              />
            ) : null}
            {capability.canApprove ? (
              <Button
                busy={busy}
                label="Approve"
                onPress={() => void run(() => reviewFmsStage(stage.id, "approved", remark, nextAssignee || null))}
              />
            ) : null}
            {capability.canReject ? <Button busy={busy} label="Reject" onPress={() => void reject()} variant="danger" /> : null}
            {capability.canRequestRevision && priorStages.length ? (
              <Button disabled={busy} label="Request revision" onPress={() => openManagedAction("revision")} variant="secondary" />
            ) : null}
            {capability.canMoveBackward && priorStages.length ? (
              <Button disabled={busy} label="Move backward" onPress={() => openManagedAction("backward")} variant="secondary" />
            ) : null}
            {capability.canEscalate ? (
              <Button disabled={busy} label="Escalate" onPress={() => openManagedAction("escalate")} variant="secondary" />
            ) : null}
          </View>
        </Card>
      ) : (
        <Text tone="muted" variant="caption">{capability.reason ?? "Stage is not actionable for this user"}</Text>
      )}

      {capability.canReassign && (stage.assigned_to?.length ?? 0) > 0 ? (
        <Button disabled={busy} label="Reassign" onPress={() => openManagedAction("reassign")} variant="secondary" />
      ) : null}

      <Sheet onClose={() => setManagedAction(null)} title={managedAction ? MANAGED_TITLES[managedAction] : ""} visible={managedAction !== null}>
        {managedAction === "reassign" ? (
          <>
            <OptionPicker
              label="Current assignee"
              onChange={(next) => setFromUser(next[0] ?? "")}
              options={(stage.assigned_to ?? []).map((id) => ({ value: id, label: nameOf(id) }))}
              selected={fromUser ? [fromUser] : []}
            />
            <OptionPicker
              label="New eligible assignee"
              onChange={(next) => setTargetUser(next[0] ?? "")}
              options={peopleOptions.filter((option) => !(stage.assigned_to ?? []).includes(option.value))}
              selected={targetUser ? [targetUser] : []}
            />
          </>
        ) : null}
        {managedAction === "backward" || managedAction === "revision" ? (
          <>
            <OptionPicker
              label="Earlier stage"
              onChange={(next) => setTargetStage(next[0] ?? "")}
              options={priorStages.map((item) => ({ value: item.id, label: item.name }))}
              selected={targetStage ? [targetStage] : []}
            />
            <OptionPicker
              label="Optional assignee"
              onChange={(next) => setTargetUser(next[0] ?? "")}
              options={peopleOptions}
              selected={targetUser ? [targetUser] : []}
            />
          </>
        ) : null}
        <TextField label="Reason *" maxLength={1000} multiline onChangeText={setActionReason} value={actionReason} />
        <View style={styles.actions}>
          <Button busy={busy} disabled={confirmDisabled} label="Confirm" onPress={() => void runManagedAction()} />
          <Button label="Cancel" onPress={() => setManagedAction(null)} variant="ghost" />
        </View>
      </Sheet>
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  header: { gap: theme.space.xs },
  titleRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: theme.space.sm },
  flex: { flex: 1, minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  group: { gap: theme.space.xs },
}));
