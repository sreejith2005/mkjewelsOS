import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { AlertTriangle } from "lucide-react-native";
import {
  PURGE_MODULE_KEYS,
  fetchDemoDataPurgeCounts,
  purgeDemoData,
  type PurgeCounts,
  type PurgeModuleKey,
} from "@jewelos/data/settings/api";
import { refreshSessionForSensitiveAction } from "@jewelos/data/users/api";
import { ToggleField } from "@/forms/ToggleField";
import { errorText } from "@/lib/log";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

function CountRows({ counts }: { counts: Record<string, number> }) {
  const styles = useStyles();
  return (
    <>
      {Object.entries(counts).filter(([, count]) => count > 0).map(([name, count]) => (
        <View key={name} style={styles.countRow}>
          <Text tone="muted" variant="caption">{name.replaceAll("_", " ")}</Text>
          <Text variant="caption">{count.toLocaleString("en-IN")}</Text>
        </View>
      ))}
    </>
  );
}

/** The web Super Admin "Clear data" card, on the same audited Edge Function. */
export function DataPurgeCard() {
  const theme = useAppTheme();
  const styles = useStyles();
  const [counts, setCounts] = useState<PurgeCounts | null>(null);
  const [selected, setSelected] = useState<PurgeModuleKey[]>([]);
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      await refreshSessionForSensitiveAction();
      setCounts(await fetchDemoDataPurgeCounts());
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const toggle = (key: PurgeModuleKey) =>
    setSelected((current) => (current.includes(key) ? current.filter((entry) => entry !== key) : [...current, key]));
  const allSelected = selected.length === PURGE_MODULE_KEYS.length;
  const selectedTotal = counts ? selected.reduce((sum, key) => sum + (counts.modules[key]?.total ?? 0), 0) : 0;
  const canPurge = selected.length > 0 && confirmation === "DELETE" && !busy;

  const purge = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await refreshSessionForSensitiveAction();
      setCounts(await purgeDemoData(selected));
      setDone(`Deleted ${selected.length} section${selected.length === 1 ? "" : "s"}. Counts below are live.`);
      setSelected([]);
      setConfirmation("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <View style={styles.heading}>
        <Text variant="title" weight="semibold">Clear data</Text>
        <Text tone="muted" variant="small">
          Delete operational records section by section, as often as you need. Users, branches, departments, Availability, dropdowns, settings, CRM and audit history are never touched.
        </Text>
      </View>
      <Card>
        <View style={styles.warning}>
          <AlertTriangle color={theme.colors.warning} size={16} />
          <Text style={styles.flex} tone="muted" variant="small">
            Deletion is immediate and cannot be undone from inside the app. Nothing here removes any screen or setting — only records.
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.flex} tone="muted" variant="label">Choose what to delete</Text>
          <Button disabled={busy} label={allSelected ? "Clear selection" : "Select everything"} onPress={() => setSelected(allSelected ? [] : [...PURGE_MODULE_KEYS])} variant="secondary" />
        </View>
        {PURGE_MODULE_KEYS.map((key) => {
          const module = counts?.modules[key];
          return (
            <ToggleField
              disabled={busy}
              helperText={module ? `${module.total.toLocaleString("en-IN")} records` : "…"}
              key={key}
              label={module?.label ?? key.replaceAll("_", " ")}
              onChange={() => toggle(key)}
              required={false}
              value={selected.includes(key)}
            />
          );
        })}
        {counts ? (
          <View style={styles.detail}>
            <Text tone="muted" variant="caption" weight="semibold">Always cleared with any deletion (logs, delivery records and realtime events)</Text>
            <CountRows counts={counts.always_swept} />
          </View>
        ) : null}
        <TextField
          autoCapitalize="characters"
          editable={!busy && selected.length > 0}
          label={`Type DELETE to confirm${selected.length > 0 ? ` — ${selectedTotal.toLocaleString("en-IN")} records selected` : ""}`}
          onChangeText={setConfirmation}
          value={confirmation}
        />
        <Button busy={busy} disabled={!canPurge} full label="Delete selected" onPress={() => void purge()} variant="danger" />
        <Button disabled={busy} full label="Refresh counts" onPress={() => void load()} variant="secondary" />
        {counts ? (
          <View style={styles.detail}>
            <Text tone="muted" variant="caption" weight="semibold">Retained — never deleted here</Text>
            <CountRows counts={counts.retained} />
          </View>
        ) : null}
        {done ? <Text tone="success" variant="small">{done}</Text> : null}
        {error ? <Text tone="danger" variant="small">{error}</Text> : null}
      </Card>
    </>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  heading: { gap: 2, marginTop: theme.space.sm },
  warning: { flexDirection: "row", gap: theme.space.sm, borderWidth: 1, borderColor: theme.colors.warning, borderRadius: theme.radius.md, padding: theme.space.sm },
  row: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  flex: { flex: 1, minWidth: 0 },
  detail: { gap: 2, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.md, padding: theme.space.sm },
  countRow: { flexDirection: "row", justifyContent: "space-between", gap: theme.space.sm },
}));
