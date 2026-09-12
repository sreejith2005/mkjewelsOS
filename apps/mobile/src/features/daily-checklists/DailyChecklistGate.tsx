import { useEffect, useMemo, useState } from "react";
import { BackHandler, Modal, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check } from "lucide-react-native";
import { calculateDailyChecklistProgress, type DailyChecklistStatus } from "@jewelos/core";
import { acknowledgeDailyChecklist, loadMyDailyChecklistStatus } from "@jewelos/data/dailyChecklists/api";
import { errorText } from "@/lib/log";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Text } from "@/ui/Text";

/**
 * The signed-in employee's daily routine checklist, matching the web gate.
 *
 * It is deliberately not a `Sheet`: the web dialog swallows Escape and offers
 * no close control, so the phone equivalent must also swallow the Android back
 * button. Dismissing it would let someone reach the app without the
 * acknowledgement the audit trail expects.
 *
 * The same 1.5s delay as the web keeps it from covering the first paint.
 */
export function DailyChecklistGate({ profileId }: { profileId: string }) {
  const theme = useAppTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<DailyChecklistStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [checkedIds, setCheckedIds] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState(false);
  /** Bumped by Retry, so a failed load re-runs the effect below. */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setStatus(null);
    setCheckedIds(new Set());
    setError(null);
    setVisible(false);
    void (async () => {
      try {
        const next = await loadMyDailyChecklistStatus();
        if (!active) return;
        setStatus(next);
        if (next.required) timer = setTimeout(() => setVisible(true), 1500);
      } catch (caught) {
        if (!active) return;
        setError(errorText(caught));
        setVisible(true);
      }
    })();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [profileId, reloadToken]);

  const checklist = status?.checklist ?? null;
  const progress = useMemo(
    () => (checklist ? calculateDailyChecklistProgress(checklist.items, checkedIds) : null),
    [checklist, checkedIds],
  );

  // Hold the hardware back button while the gate is up, exactly as the web
  // dialog holds Escape.
  useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => subscription.remove();
  }, [visible]);

  if (!visible || (!checklist && !error)) return null;

  const acknowledge = async () => {
    if (!checklist || !progress?.canAcknowledge) return;
    setSaving(true);
    setError(null);
    try {
      await acknowledgeDailyChecklist(checklist.id, checklist.revision, [...checkedIds]);
      setStatus({ required: false, date: status?.date ?? "", checklist: null });
      setVisible(false);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (id: string) =>
    setCheckedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <Modal animationType="fade" onRequestClose={() => undefined} statusBarTranslucent transparent visible>
      <View style={[styles.scrim, { paddingTop: insets.top + theme.space.md, paddingBottom: insets.bottom + theme.space.md }]}>
        <View style={styles.dialog}>
          <Text tone="warm" variant="subtitle" weight="semibold">
            {checklist?.title ?? "Daily checklist"}
          </Text>
          {checklist?.instruction ? <Text tone="muted">{checklist.instruction}</Text> : null}
          {checklist ? (
            <>
              <Text tone="muted" variant="caption">
                Complete all {progress?.totalItems ?? 0} points before confirming.
              </Text>
              <ScrollView contentContainerStyle={styles.items} keyboardShouldPersistTaps="handled">
                {checklist.items.map((item) => {
                  const checked = checkedIds.has(item.id);
                  return (
                    <Pressable
                      accessibilityLabel={item.text}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      key={item.id}
                      onPress={() => toggle(item.id)}
                      style={[styles.item, checked && styles.itemChecked]}
                    >
                      <View style={[styles.box, checked && styles.boxChecked]}>
                        {checked ? <Check color={theme.colors.onPrimary} size={14} strokeWidth={3} /> : null}
                      </View>
                      <Text style={styles.itemText}>{item.text}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <Text tone="muted" variant="caption">
                {progress?.completedItems ?? 0} of {progress?.totalItems ?? 0} completed
              </Text>
            </>
          ) : null}
          {error ? <Text tone="danger">{error}</Text> : null}
          {error && !checklist ? (
            <Button full label="Retry" onPress={() => setReloadToken((value) => value + 1)} variant="secondary" />
          ) : null}
          {checklist ? (
            <Button
              busy={saving}
              disabled={!progress?.canAcknowledge}
              full
              label={checklist.confirmationText}
              onPress={() => void acknowledge()}
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: theme.colors.scrim,
    justifyContent: "center",
    paddingHorizontal: theme.space.md,
  },
  dialog: {
    maxHeight: "100%",
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.xl,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.space.md,
    gap: theme.space.sm,
  },
  items: { gap: theme.space.sm, paddingVertical: theme.space.xs },
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.space.sm,
    minHeight: theme.touchTarget,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    padding: theme.space.sm,
  },
  itemChecked: { borderColor: theme.colors.primary },
  box: {
    width: 22,
    height: 22,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  itemText: { flex: 1, minWidth: 0 },
}));
