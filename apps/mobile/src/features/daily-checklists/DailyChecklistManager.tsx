import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { randomUUID } from "expo-crypto";
import { hasPermission, type DailyChecklistItem } from "@jewelos/core";
import {
  loadDailyChecklistManagement,
  saveDailyChecklist,
  type DailyChecklistRecord,
} from "@jewelos/data/dailyChecklists/api";
import { useAccess } from "@/auth/AuthProvider";
import { errorText } from "@/lib/log";
import { makeStyles } from "@/theme/makeStyles";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Banner } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const DEFAULT_CONFIRMATION = "I have reviewed today's daily routine checklist and am ready to follow it.";
const MAX_ITEMS = 20;

const emptyItems = (): DailyChecklistItem[] => [{ id: randomUUID(), text: "" }];

function parsePastedChecklistLines(value: string): string[] {
  return value.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
}

/**
 * Authoring surface for each designation's daily routine checklist, matching
 * the web `DailyChecklistManager` field for field — including the paste-many-
 * lines shortcut, which is how these checklists actually arrive from an SOP
 * document.
 */
export function DailyChecklistManager() {
  const styles = useStyles();
  const [records, setRecords] = useState<readonly DailyChecklistRecord[]>([]);
  const [designations, setDesignations] = useState<readonly { id: string; label: string }[]>([]);
  const [selected, setSelected] = useState("");
  const [title, setTitle] = useState("");
  const [instruction, setInstruction] = useState("");
  const [confirmationText, setConfirmationText] = useState(DEFAULT_CONFIRMATION);
  const [items, setItems] = useState<DailyChecklistItem[]>(emptyItems);
  const [pastedLines, setPastedLines] = useState("");
  const [active, setActive] = useState(true);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const allowed = hasPermission(useAccess(), "daily_checklists.manage");

  useEffect(() => {
    if (!allowed) return;
    let active_ = true;
    void (async () => {
      try {
        const result = await loadDailyChecklistManagement();
        if (!active_) return;
        setRecords(result.checklists);
        setDesignations(result.designations);
        setError(null);
      } catch (caught) {
        if (active_) setError(errorText(caught));
      } finally {
        if (active_) setLoaded(true);
      }
    })();
    return () => {
      active_ = false;
    };
  }, [allowed]);

  const selectedRecord = useMemo(
    () => records.find((item) => item.designationId === selected) ?? null,
    [records, selected],
  );

  if (!allowed) return null;

  const choose = (designationId: string) => {
    const record = records.find((item) => item.designationId === designationId);
    setSelected(designationId);
    setTitle(record?.title ?? "");
    setInstruction(record?.instruction ?? "");
    setConfirmationText(record?.confirmationText ?? DEFAULT_CONFIRMATION);
    setItems(record ? [...record.items] : emptyItems());
    setPastedLines("");
    setActive(record?.isActive ?? true);
    setRevision(record?.revision ?? 0);
    setError(null);
    setSuccess(null);
  };

  const replaceItemsFromPaste = () => {
    const lines = parsePastedChecklistLines(pastedLines);
    if (lines.length === 0) return setError("Paste at least one checklist line.");
    if (lines.length > MAX_ITEMS) return setError(`A daily checklist can contain at most ${MAX_ITEMS} lines.`);
    setItems(lines.map((text) => ({ id: randomUUID(), text })));
    setPastedLines("");
    setError(null);
  };

  const save = async () => {
    if (!selected) return setError("Select a designation.");
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await saveDailyChecklist({
        id: selectedRecord?.id ?? null,
        designationId: selected,
        title,
        instruction: instruction || null,
        confirmationText,
        items,
        isActive: active,
        revision,
      });
      const designationLabel = designations.find((item) => item.id === selected)?.label ?? "Designation";
      const savedRecord: DailyChecklistRecord = {
        id: saved.id,
        designationId: selected,
        designationLabel,
        title,
        instruction: instruction || null,
        confirmationText,
        items,
        isActive: active,
        revision: saved.revision,
      };
      setRecords((current) => [...current.filter((item) => item.designationId !== selected), savedRecord]);
      setRevision(saved.revision);
      setSuccess("Checklist saved.");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <View style={styles.sectionTitleBlock}>
        <Text variant="title" weight="semibold">Daily checklists</Text>
        <Text tone="muted" variant="small">
          One shared daily routine checklist per designation. Every save is audited.
        </Text>
      </View>
      <Card>
        <OptionPicker
          label="Designation"
          onChange={(values) => choose(values[0] ?? "")}
          options={designations.map((item) => ({ value: item.id, label: item.label }))}
          selected={selected ? [selected] : []}
        />
        {loaded && designations.length === 0 ? (
          <Text tone="muted" variant="small">Add an active designation in Dropdown Master first.</Text>
        ) : null}
        <TextField label="Title" maxLength={120} onChangeText={setTitle} value={title} />
        <TextField
          label="Instruction (optional)"
          maxLength={500}
          multiline
          onChangeText={setInstruction}
          value={instruction}
        />
        <TextField
          label="Paste SOP checklist lines"
          maxLength={10000}
          multiline
          onChangeText={setPastedLines}
          placeholder="Paste one checklist point per line"
          value={pastedLines}
        />
        <Button
          disabled={!pastedLines.trim()}
          label="Replace checklist lines"
          onPress={replaceItemsFromPaste}
          variant="secondary"
        />
        <Text tone="muted" variant="caption">
          Each non-empty line becomes one checklist item (maximum {MAX_ITEMS}).
        </Text>
        {items.map((item, index) => (
          <View key={item.id} style={styles.itemRow}>
            <View style={styles.itemField}>
              <TextField
                label={`Point ${index + 1}`}
                maxLength={500}
                onChangeText={(text) =>
                  setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, text } : entry)))
                }
                value={item.text}
              />
            </View>
            <Button
              disabled={items.length === 1}
              label="Remove"
              onPress={() => setItems((current) => current.filter((entry) => entry.id !== item.id))}
              variant="ghost"
            />
          </View>
        ))}
        <Button
          disabled={items.length >= MAX_ITEMS}
          label="Add checklist line"
          onPress={() => setItems((current) => [...current, { id: randomUUID(), text: "" }])}
          variant="secondary"
        />
        <TextField
          label="Final affirmation"
          maxLength={240}
          onChangeText={setConfirmationText}
          value={confirmationText}
        />
        <OptionPicker
          label="Visibility"
          onChange={(values) => setActive(values[0] === "shown")}
          options={[
            { value: "shown", label: "Show this checklist to employees" },
            { value: "hidden", label: "Hidden" },
          ]}
          selected={[active ? "shown" : "hidden"]}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        {success ? <Banner tone="success">{success}</Banner> : null}
        <Button busy={saving} label="Save checklist" onPress={() => void save()} />
      </Card>
    </>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  sectionTitleBlock: { gap: 2, marginTop: theme.space.sm },
  itemRow: { flexDirection: "row", alignItems: "flex-end", gap: theme.space.sm },
  itemField: { flex: 1, minWidth: 0 },
}));
