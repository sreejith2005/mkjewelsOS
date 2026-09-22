import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import * as DocumentPicker from "expo-document-picker";
import * as Crypto from "expo-crypto";
import * as Sharing from "expo-sharing";
import { File, Paths } from "expo-file-system";
import {
  applyIdentityMappings,
  chunkTaskImportRows,
  createCorrectionReportCsv,
  hasPermission,
  isTaskImportDraftSourceFormat,
  kolkataDateKey,
  parseTaskImportFile,
  partitionTaskImportRows,
  taskImportOutcomeMessage,
  taskImportPayloadHashSource,
  type TaskBulkImportIssue,
  type TaskBulkImportPayload,
  type TaskImportDraftRow,
  type TaskImportTimingPresetKey,
  type TaskImportTimingPresets,
} from "@jewelos/core";
import {
  beginCurrentSheetTaskImport,
  commitCurrentSheetTaskImportChunk,
  loadTaskImportBatches,
  loadTaskImportIdentityCandidates,
  reconcileTaskImportAssignments,
  saveTaskImportIdentityAlias,
  submitTaskBulkImport,
  validateTaskBulkImport,
  type TaskImportBatch,
  type TaskImportIdentityCandidate,
  type TaskImportValidation,
} from "@jewelos/data/taskImport/api";
import { runTaskImportChunks } from "@jewelos/data/taskImport/chunkRunner";
import { useAccess } from "@/auth/AuthProvider";
import { DateField } from "@/forms/DateField";
import { errorText } from "@/lib/log";
import type { RootStackParamList } from "@/navigation/types";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Card, CardRow, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Screen } from "@/ui/Screen";
import { Banner, EmptyState, ErrorState } from "@/ui/states";
import { Text } from "@/ui/Text";
import { initialImportSession, reduceImportSession } from "@/features/taskImport/importSession";
import {
  taskImportActionLabel,
  taskImportBlockedReminder,
  taskImportReadinessCounts,
} from "@/features/taskImport/readiness";
import {
  initialTaskImportTimingPresets,
  taskImportTimingWindowsValid,
  updateTaskImportTimingPreset,
} from "@/features/taskImport/timingPresets";

type Navigation = NativeStackNavigationProp<RootStackParamList, "TaskImport">;
type SelectedImportFile = Readonly<{ name: string; uri: string; size: number; type: string }>;

const TIMING_LABELS: Readonly<Record<TaskImportTimingPresetKey, string>> = {
  general: "General", opening: "Opening", morning: "Morning", closing: "Closing", evening: "Evening", manual: "Manual Run Now",
};

async function sha256(source: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, source);
}

export function TaskImportScreen() {
  const styles = useStyles();
  const access = useAccess();
  const navigation = useNavigation<Navigation>();
  const allowed = hasPermission(access, "tasks.view");
  const [session, dispatch] = useReducer(reduceImportSession, initialImportSession);
  const [startDate, setStartDate] = useState(() => kolkataDateKey(new Date()));
  const [selectedFile, setSelectedFile] = useState<SelectedImportFile | null>(null);
  const [timingPresets, setTimingPresets] = useState<TaskImportTimingPresets>(initialTaskImportTimingPresets);
  const [requiredTimingPresets, setRequiredTimingPresets] = useState<readonly TaskImportTimingPresetKey[]>([]);
  const [payload, setPayload] = useState<TaskBulkImportPayload | null>(null);
  const [draftRows, setDraftRows] = useState<readonly TaskImportDraftRow[]>([]);
  const [candidates, setCandidates] = useState<readonly TaskImportIdentityCandidate[]>([]);
  const [issues, setIssues] = useState<readonly TaskBulkImportIssue[]>([]);
  const [validation, setValidation] = useState<TaskImportValidation | null>(null);
  const [history, setHistory] = useState<readonly TaskImportBatch[]>([]);
  const [busy, setBusy] = useState(false);
  const parseRequestId = useRef(0);

  const eligibility = useMemo(() => partitionTaskImportRows(draftRows, issues), [draftRows, issues]);
  const mapped = useMemo(() => applyIdentityMappings(eligibility.readyRows, candidates), [candidates, eligibility.readyRows]);
  const readyRows = mapped.rows;
  const readiness = taskImportReadinessCounts(readyRows, eligibility.blockedRows.length);
  const blockedReminder = taskImportBlockedReminder(readiness.blocked);
  const candidateOptions = useMemo(() => candidates.map((candidate) => ({ value: candidate.id, label: candidate.employee_name })), [candidates]);

  const refreshReference = async () => {
    const [nextCandidates, nextHistory] = await Promise.all([
      loadTaskImportIdentityCandidates(),
      loadTaskImportBatches(),
    ]);
    setCandidates(nextCandidates);
    setHistory(nextHistory);
  };

  useEffect(() => {
    if (!allowed) return;
    void refreshReference().catch((caught) => dispatch({ type: "failed", message: errorText(caught) }));
  // The screen intentionally loads this bounded reference data once; mutations refresh explicitly.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowed]);

  useEffect(() => {
    if (draftRows.length > 0) dispatch({ type: "mapped", unresolved: mapped.unresolvedAssignees.length });
  }, [draftRows.length, mapped.unresolvedAssignees.length]);

  const parseSelectedFile = async (selected: SelectedImportFile, selectedStartDate: string, presets: TaskImportTimingPresets, reset = false) => {
    const requestId = ++parseRequestId.current;
    setBusy(true);
    if (reset) {
      setPayload(null);
      setDraftRows([]);
      setIssues([]);
      setValidation(null);
    }
    try {
      const file = new File(selected.uri);
      const parsed = await parseTaskImportFile({
        name: selected.name,
        size: selected.size || file.size,
        type: selected.type,
        arrayBuffer: () => file.arrayBuffer(),
      }, { defaultStartsOn: selectedStartDate, timingPresets: presets });
      if (requestId !== parseRequestId.current) return;
      setIssues(parsed.issues);
      setRequiredTimingPresets(parsed.requiredTimingPresets);
      if (isTaskImportDraftSourceFormat(parsed.sourceFormat)) {
        setPayload(null);
        setDraftRows(parsed.draftRows);
        dispatch({ type: "parsed", total: parsed.draftRows.length, unresolved: 0, issues: parsed.issues.length });
      } else if (parsed.payload) {
        setDraftRows([]);
        setPayload(parsed.payload);
        dispatch({ type: "parsed", total: parsed.payload.tasks.length, unresolved: 0, issues: parsed.issues.length });
      } else {
        setDraftRows([]);
        setPayload(null);
        dispatch({ type: "failed", message: parsed.errors.join(" ") || "The file could not be read." });
      }
    } catch (caught) {
      if (requestId === parseRequestId.current) dispatch({ type: "failed", message: errorText(caught) });
    } finally {
      // The selected URI is only a picker-cache handle retained while this screen is mounted.
      if (requestId === parseRequestId.current) setBusy(false);
    }
  };

  const selectFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: false,
      type: ["text/csv", "application/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    const selected = { name: asset.name, uri: asset.uri, size: asset.size ?? 0, type: asset.mimeType ?? "" };
    const presets = initialTaskImportTimingPresets();
    setSelectedFile(selected);
    setTimingPresets(presets);
    setRequiredTimingPresets([]);
    dispatch({ type: "selected", fileLabel: asset.name.replace(/[^A-Za-z0-9._ -]/g, "_") });
    await parseSelectedFile(selected, startDate, presets, true);
  };

  const changeStartDate = (next: string) => {
    setStartDate(next);
    if (selectedFile && next) void parseSelectedFile(selectedFile, next, timingPresets);
  };

  const changeTiming = (key: TaskImportTimingPresetKey, field: "startTime" | "dueTime", nextValue: string) => {
    const next = updateTaskImportTimingPreset(timingPresets, key, field, nextValue);
    setTimingPresets(next);
    if (selectedFile) void parseSelectedFile(selectedFile, startDate, next);
  };

  const confirmIdentity = async (label: string, userId: string) => {
    setBusy(true);
    try {
      await saveTaskImportIdentityAlias(label, userId);
      setCandidates(await loadTaskImportIdentityCandidates());
    } catch (caught) {
      dispatch({ type: "failed", message: errorText(caught) });
    } finally {
      setBusy(false);
    }
  };

  const validateCanonical = async () => {
    if (!payload) return;
    setBusy(true);
    try {
      const next = await validateTaskBulkImport(payload, await sha256(taskImportPayloadHashSource(payload)));
      setValidation(next);
      if (!next.valid) dispatch({ type: "failed", message: "The workbook still has server validation errors." });
    } catch (caught) {
      dispatch({ type: "failed", message: errorText(caught) });
    } finally {
      setBusy(false);
    }
  };

  const importCanonical = async () => {
    if (!payload || !validation?.valid) return;
    setBusy(true);
    dispatch({ type: "run" });
    try {
      const outcome = await submitTaskBulkImport(payload, validation.canonical_hash, session.fileLabel || "task-import.xlsx");
      dispatch({ type: "complete", message: outcome.replayed ? "This file was already imported. No duplicate tasks were created." : `${outcome.created_count.toLocaleString("en-IN")} tasks imported.` });
      setHistory(await loadTaskImportBatches());
    } catch (caught) {
      dispatch({ type: "failed", message: errorText(caught) });
    } finally {
      setBusy(false);
    }
  };

  const importCurrentSheet = async () => {
    if (!readyRows.length) return;
    setBusy(true);
    dispatch({ type: "run" });
    try {
      for (const chunk of chunkTaskImportRows(readyRows)) await reconcileTaskImportAssignments(chunk);
      const hash = await sha256(JSON.stringify(readyRows));
      const started = await beginCurrentSheetTaskImport(hash, session.fileLabel || "task-import.csv", readyRows.length);
      dispatch({ type: "progress", processed: session.processed, batchId: started.batch_id });
      if (started.replayed && started.outcome !== "in_progress" && started.outcome !== "partial") {
        dispatch({ type: "complete", message: `This file was already imported. No duplicate tasks were created.${blockedReminder}` });
      } else {
        const remaining = readyRows.slice(session.processed);
        const outcome = await runTaskImportChunks(
          started.batch_id,
          remaining,
          (batchId, rows) => commitCurrentSheetTaskImportChunk(batchId, rows as typeof readyRows),
          (processed) => dispatch({ type: "progress", processed: session.processed + processed, batchId: started.batch_id }),
        );
        dispatch({ type: "complete", message: `${taskImportOutcomeMessage(outcome).text}${blockedReminder}` });
      }
      setHistory(await loadTaskImportBatches());
    } catch (caught) {
      dispatch({ type: "failed", message: errorText(caught) });
    } finally {
      setBusy(false);
    }
  };

  const shareCorrections = async () => {
    const file = new File(Paths.cache, "task-import-corrections.csv");
    try {
      file.write(createCorrectionReportCsv(issues));
      await Sharing.shareAsync(file.uri, { mimeType: "text/csv", dialogTitle: "Share task import corrections" });
    } catch (caught) {
      dispatch({ type: "failed", message: errorText(caught) });
    } finally {
      try { file.delete(); } catch { /* cache cleanup is best effort */ }
    }
  };

  if (!allowed) return <Screen><ErrorState title="Access denied" message="Task import requires access to Tasks. The server rechecks every import mutation." /></Screen>;

  return (
    <Screen scroll>
      <View style={styles.heading}>
        <Text tone="primary" variant="heading" weight="semibold">Task Bulk Import</Text>
        <Text tone="muted" variant="small">Upload once. Exact employee matches are assigned automatically; unclear names can be confirmed now or imported safely to Assigning Left.</Text>
      </View>
      <Banner tone="info">Accepts the one-sheet 20-column format, six-column work list, earlier 18-column CSV, and existing canonical workbook, up to 2 MiB and 2,500 records.</Banner>
      {session.error ? <Banner tone="danger">{session.error}</Banner> : null}
      {session.result ? <Banner tone="success">{session.result}</Banner> : null}
      <Card>
        <View style={styles.actions}>
          <Button busy={busy && session.stage === "validate"} label={session.fileLabel || "Choose CSV or workbook"} onPress={() => void selectFile()} variant="secondary" />
          <Button label="Assigning Left" onPress={() => navigation.navigate("AssigningLeft")} variant="secondary" />
        </View>
        <View style={styles.field}>
          <Text tone="muted" variant="label">Start blank schedules from</Text>
          <DateField disabled={busy} invalid={false} label="Start schedules from" mode="date" onChange={changeStartDate} value={startDate} />
        </View>
      </Card>

      {requiredTimingPresets.map((key) => {
        const window = timingPresets[key] ?? { startTime: "", dueTime: "" };
        const invalid = !taskImportTimingWindowsValid([key], timingPresets);
        return (
          <Card key={key} accent="warning">
            <Text variant="title" weight="semibold">{TIMING_LABELS[key]} timing for blank cells</Text>
            <Text tone="muted" variant="small">Choose a same-day window. Due time must be later than start time.</Text>
            <View style={styles.field}>
              <DateField disabled={busy} invalid={invalid} label={`${TIMING_LABELS[key]} start time`} mode="time" onChange={(next) => changeTiming(key, "startTime", next)} value={window.startTime} />
              <DateField disabled={busy} invalid={invalid} label={`${TIMING_LABELS[key]} due time`} mode="time" onChange={(next) => changeTiming(key, "dueTime", next)} value={window.dueTime} />
            </View>
          </Card>
        );
      })}

      {session.total > 0 ? (
        <Card>
          <Text variant="title" weight="semibold">Review</Text>
          {draftRows.length > 0 ? <>
            <CardRow label="Source records" value={draftRows.length.toLocaleString("en-IN")} />
            <CardRow label="Ready to import" value={readiness.ready.toLocaleString("en-IN")} />
            <CardRow label="Blocked rows" value={readiness.blocked.toLocaleString("en-IN")} />
            <CardRow label="Assigned automatically" value={readiness.assigned.toLocaleString("en-IN")} />
            <CardRow label="Assigning Left" value={readiness.assigningLeft.toLocaleString("en-IN")} />
            {session.stage === "run" ? <CardRow label="Progress" value={`${session.processed}/${readiness.ready}`} /> : null}
          </> : <>
            <CardRow label="Records" value={session.total.toLocaleString("en-IN")} />
            <CardRow label="Issues" value={issues.length.toLocaleString("en-IN")} />
          </>}
          {issues.length > 0 ? <Button label="Share correction report" onPress={() => void shareCorrections()} variant="secondary" /> : null}
          {payload ? (
            <View style={styles.actions}>
              <Button busy={busy} label="Check workbook" onPress={() => void validateCanonical()} variant="secondary" />
              <Button busy={busy} disabled={!validation?.valid} label="Import workbook" onPress={() => void importCanonical()} />
            </View>
          ) : null}
          {draftRows.length > 0 ? (
            <Button busy={busy} disabled={!readyRows.length || eligibility.globalIssues.length > 0} label={taskImportActionLabel(draftRows.length, readyRows.length)} onPress={() => void importCurrentSheet()} />
          ) : null}
        </Card>
      ) : null}

      {mapped.unresolvedAssignees.map((item) => (
        <Card key={item.label} accent="warning">
          <Text weight="semibold">Confirm “{item.label}”</Text>
          <Text tone="muted" variant="small">Rows {item.source_rows.slice(0, 8).join(", ")}{item.source_rows.length > 8 ? "…" : ""}. No identity will be guessed.</Text>
          <OptionPicker disabled={busy} label={`Employee for ${item.label}`} onChange={(selected) => {
            const id = selected[0];
            if (id) void confirmIdentity(item.label, id);
          }} options={candidateOptions} selected={[]} />
        </Card>
      ))}

      {issues.slice(0, 20).map((issue, index) => (
        <Card key={`${issue.sheet}:${issue.row}:${issue.field}:${index}`} accent="danger">
          <Text weight="semibold">{issue.reason}</Text>
          <Text tone="muted" variant="small">{issue.sheet} row {issue.row} · {issue.field}</Text>
          <Text variant="small">{issue.guidance}</Text>
        </Card>
      ))}

      <View style={styles.sectionHeading}>
        <Text variant="title" weight="semibold">Recent imports</Text>
        <StatusBadge label={`${history.length} shown`} />
      </View>
      {history.length === 0 ? <EmptyState title="No recent imports" message="Imports visible to this account will appear here." /> : history.map((batch) => (
        <Card key={batch.id}>
          <Text weight="semibold">{batch.safe_file_label ?? "Task import"}</Text>
          <CardRow label="When" value={new Date(batch.created_at).toLocaleString("en-IN")} />
          <CardRow label="Outcome" value={batch.outcome} />
          <CardRow label="Counts" value={`${batch.requested_count} requested · ${batch.valid_count} created · ${batch.error_count} rejected`} />
        </Card>
      ))}
    </Screen>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  heading: { gap: theme.space.xs },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: theme.space.sm },
  field: { gap: theme.space.xs },
  sectionHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: theme.space.sm },
}));
