import { useCallback, useMemo, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as WebBrowser from "expo-web-browser";
import { deriveFmsTransitionCapability } from "@jewelos/core";
import {
  claimFmsStage,
  completeFmsStage,
  loadFmsRuntime,
  reviewFmsStage,
  signedFmsEvidenceUrl,
  updateFmsChecklistItem,
  uploadFmsEvidence,
} from "@jewelos/data/fms/api";
import { eligibleFmsUsers } from "@jewelos/data/fms/runtimeView";
import { loadFormDynamicOptions, loadTaskForms } from "@jewelos/data/forms/api";
import { useProfile } from "@/auth/AuthProvider";
import { useAsyncData } from "@/lib/useAsyncData";
import { formatDateTime } from "@/lib/format";
import { errorText, log } from "@/lib/log";
import { pickFile, type PickSource } from "@/lib/pickFile";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";
import { ToggleField } from "@/forms/ToggleField";
import { Banner, ErrorState, LoadingState } from "@/ui/states";
import { runtimeDecisionOptions } from "@/fms/decisions";
import type { RootStackParamList } from "@/navigation/types";

type Navigation = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, "FmsStage">;

/**
 * One workflow step, and everything a person can do to it.
 *
 * The branch that follows is never decided here. Completing a step calls the
 * same audited RPC the web calls, and the server resolves the route and
 * activates the next node inside that transaction — so a phone and a browser
 * cannot send a workflow down different paths.
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
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await action();
      await refresh();
    } catch (caught) {
      log.error("fms", "stage action failed", caught);
      setActionError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Screen><LoadingState label="Loading the step…" /></Screen>;
  if (error && !data) return <Screen><ErrorState message={error} onRetry={() => void reload()} /></Screen>;
  if (!stage || !instance || !definition) {
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
  const linkedForm = data?.forms.find((form) => form.id === definition.form_template_id) ?? null;
  const checklistPayload = Object.fromEntries(checklist.map((item) => [item.item_key, item.is_completed]));
  const canClaim =
    (stage.assigned_to ?? []).includes(profile.id) &&
    ["pending", "in_progress", "in_review", "overdue"].includes(stage.status) &&
    ["active", "overdue"].includes(instance.status);
  const eligible = data ? eligibleFmsUsers(data.runtime.users, instance) : [];

  const attachEvidence = async (source: PickSource) => {
    const picked = await pickFile(source);
    if (!picked.ok) {
      if (!picked.cancelled) setActionError(picked.message);
      return;
    }
    await run(() => uploadFmsEvidence(stage.id, profile.tenant_id, picked.file));
  };

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
        <Text variant="title" weight="semibold">
          {definition.name}
        </Text>
        {definition.method ? (
          <Text tone="muted" variant="small">
            {definition.method}
          </Text>
        ) : null}
        <View style={styles.badges}>
          <StatusBadge
            label={stage.status.replaceAll("_", " ")}
            tone={stage.status === "completed" ? "success" : stage.status === "overdue" ? "danger" : "primary"}
          />
          <StatusBadge label={`Due ${formatDateTime(stage.planned_datetime, "no deadline")}`} />
        </View>
      </View>

      {canClaim ? (
        <Button
          busy={busy}
          label="Claim this step"
          onPress={() => void run(() => claimFmsStage(stage.id))}
          variant="secondary"
        />
      ) : null}

      {checklist.length > 0 ? (
        <Card>
          <Text tone="warm" variant="subtitle" weight="semibold">
            Checklist
          </Text>
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

      {definition.form_template_id ? (
        <Card>
          <Text tone="warm" variant="subtitle" weight="semibold">
            Linked form
          </Text>
          {stage.form_submission_id ? (
            <Banner tone="success">This form has been submitted and is locked.</Banner>
          ) : linkedForm ? (
            <>
              <Text tone="muted" variant="small">
                {linkedForm.name} v{linkedForm.version}
              </Text>
              <Banner>
                Submitting this form completes the step and starts whichever step the answers lead to.
              </Banner>
              <Button
                label={`Fill ${linkedForm.name}`}
                onPress={() =>
                  navigation.navigate("FmsStageForm", {
                    instanceStageId: stage.id,
                    formTemplateId: linkedForm.id,
                  })
                }
              />
            </>
          ) : (
            <Banner tone="warning">
              The exact form version pinned to this step is not visible to you.
            </Banner>
          )}
        </Card>
      ) : null}

      {evidence.length > 0 ? (
        <Card>
          <Text tone="warm" variant="subtitle" weight="semibold">
            Evidence
          </Text>
          {evidence.map((item) => (
            <Button
              key={item.id}
              label={item.original_filename}
              onPress={() =>
                void signedFmsEvidenceUrl(item.storage_path)
                  .then((url) => WebBrowser.openBrowserAsync(url))
                  .catch((caught: unknown) => setActionError(errorText(caught)))
              }
              variant="secondary"
            />
          ))}
        </Card>
      ) : null}

      {definition.requires_upload && !stage.form_submission_id ? (
        <Card>
          <Text tone="warm" variant="subtitle" weight="semibold">
            Attach evidence
          </Text>
          <Text tone="muted" variant="caption">
            JPG, PNG, WebP, or PDF up to 10 MB.
          </Text>
          <View style={styles.actions}>
            <Button busy={busy} label="Camera" onPress={() => void attachEvidence("camera")} variant="secondary" />
            <Button busy={busy} label="Gallery" onPress={() => void attachEvidence("library")} variant="secondary" />
            <Button busy={busy} label="File" onPress={() => void attachEvidence("document")} variant="secondary" />
          </View>
        </Card>
      ) : null}

      {capability.canComplete || capability.canApprove ? (
        <Card>
          <Text tone="warm" variant="subtitle" weight="semibold">
            {decisions.length > 0 ? "Your decision" : "Complete this step"}
          </Text>

          {decisions.length > 0 ? (
            <View style={styles.actions}>
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
            <TextField
              label="Outcome"
              maxLength={500}
              onChangeText={setOutcome}
              placeholder="Optional"
              value={outcome}
            />
          )}

          <TextField
            label="Remark"
            maxLength={4000}
            multiline
            onChangeText={setRemark}
            required={definition.requires_remark === true}
            value={remark}
          />

          {definition.requires_next_doer_handoff ? (
            <View style={styles.group}>
              <Text tone="warm" variant="label" weight="medium">
                Who takes the next step *
              </Text>
              <OptionPicker
                label="Next-step assignee"
                onChange={(next) => setNextAssignee(next[0] ?? "")}
                options={eligible.map((user) => ({ value: user.id, label: user.employee_name }))}
                selected={nextAssignee ? [nextAssignee] : []}
              />
            </View>
          ) : null}

          <View style={styles.actions}>
            {capability.canComplete ? (
              <Button
                busy={busy}
                disabled={
                  (decisions.length > 0 && !outcome) ||
                  (definition.requires_remark === true && !remark.trim()) ||
                  (definition.requires_next_doer_handoff === true && !nextAssignee)
                }
                label={decisions.length > 0 ? "Submit decision" : "Complete step"}
                onPress={() =>
                  void run(() =>
                    completeFmsStage(stage.id, outcome, remark, checklistPayload, nextAssignee || null),
                  )
                }
              />
            ) : null}
            {capability.canApprove ? (
              <Button
                busy={busy}
                label="Approve"
                onPress={() => void run(() => reviewFmsStage(stage.id, "approved", remark, nextAssignee || null))}
              />
            ) : null}
            {capability.canReject ? (
              <Button
                busy={busy}
                label="Reject"
                onPress={() => void run(() => reviewFmsStage(stage.id, "rejected", remark, nextAssignee || null))}
                variant="danger"
              />
            ) : null}
          </View>
        </Card>
      ) : (
        <Banner>{capability.reason ?? "This step is not yours to act on right now."}</Banner>
      )}
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  header: { gap: theme.space.xs },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  group: { gap: theme.space.xs },
}));
