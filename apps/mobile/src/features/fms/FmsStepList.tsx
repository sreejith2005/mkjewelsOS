import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { ArrowRight, CheckSquare, ChevronRight, Copy, FileText, Flag, GitBranch, Layers, Merge, Plus, ShieldCheck, Trash2, Zap } from "lucide-react-native";
import { fmsStagesInFlowOrder, reachableFmsStageKeys, type FmsFlowDefinition, type FmsFormFieldRef, type FmsStageDefinition } from "@jewelos/core";
import { fmsGraphEdges, fmsStageSummary, fmsTimingSummary } from "@jewelos/data/fms/graph";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Pressable } from "@/ui/Pressable";
import { Text } from "@/ui/Text";

type Tone = "brand" | "success" | "danger" | "warm";
const appearance: Record<FmsStageDefinition["type"], { Icon: typeof CheckSquare; label: string; tone: Tone }> = {
  task: { Icon: CheckSquare, label: "Step", tone: "brand" },
  form: { Icon: FileText, label: "Form", tone: "success" },
  approval: { Icon: ShieldCheck, label: "Approval", tone: "brand" },
  branch: { Icon: GitBranch, label: "Decision", tone: "danger" },
  parallel_start: { Icon: Layers, label: "Split", tone: "warm" },
  parallel_join: { Icon: Merge, label: "Join", tone: "warm" },
  notification: { Icon: Zap, label: "Notify", tone: "brand" },
  end: { Icon: Flag, label: "End", tone: "success" },
};

/**
 * The web `FmsStepList`: every step as a finger-sized card in the order the
 * flow runs, with its connections written out. Nothing here needs a drag — a
 * step's next step and routes are set in its editor ("Continue to").
 */
export function FmsStepList({ definition, formFields, selectedKey, invalidKeys, onSelect, onAddAfter, onDuplicate, onDelete }: Readonly<{
  definition: FmsFlowDefinition;
  formFields: Readonly<Record<string, readonly FmsFormFieldRef[]>>;
  selectedKey: string | null;
  invalidKeys: ReadonlySet<string>;
  onSelect: (key: string) => void;
  onAddAfter: (key: string) => void;
  onDuplicate: (key: string) => void;
  onDelete: (key: string) => void;
}>) {
  const theme = useAppTheme();
  const styles = useStyles();
  const ordered = useMemo(() => fmsStagesInFlowOrder(definition.stages), [definition.stages]);
  const reachable = useMemo(() => reachableFmsStageKeys(definition), [definition]);
  const edges = useMemo(() => fmsGraphEdges(definition.stages, formFields), [definition.stages, formFields]);
  const names = useMemo(() => new Map(definition.stages.map((stage) => [stage.key, stage.name || "Untitled stage"])), [definition.stages]);
  const firstKey = definition.stages[0]?.key;
  const toneColor = (tone: Tone) => tone === "success" ? theme.colors.success : tone === "danger" ? theme.colors.danger : tone === "warm" ? theme.colors.textWarm : theme.colors.brand;

  return (
    <View accessibilityLabel="Workflow steps" accessibilityRole="list" style={styles.list}>
      {ordered.map((stage, index) => {
        const item = appearance[stage.type];
        const tone = toneColor(item.tone);
        const outgoing = edges.filter((edge) => edge.from === stage.key);
        const invalid = invalidKeys.has(stage.key);
        const isFirst = stage.key === firstKey;
        const canAppend = !["end", "branch", "parallel_start"].includes(stage.type);
        const orphan = !isFirst && !reachable.has(stage.key);
        const borderColor = invalid ? theme.colors.danger : stage.key === selectedKey ? theme.colors.brand : theme.colors.border;
        return (
          <View key={stage.key} style={styles.item}>
            <View style={[styles.card, { borderColor, borderWidth: invalid || stage.key === selectedKey ? 2 : 1 }]}>
              <Pressable accessibilityLabel={`Edit ${stage.name || "Untitled stage"}`} accessibilityRole="button" onPress={() => onSelect(stage.key)} style={({ pressed }) => [styles.body, pressed && styles.pressed]}>
                <View style={styles.number}><Text tone="primary" variant="small" weight="semibold">{String(index + 1)}</Text></View>
                <View style={styles.flex}>
                  <View style={styles.badges}>
                    <View style={[styles.typeBadge, { borderColor: tone }]}>
                      <item.Icon color={tone} size={11} />
                      <Text style={{ color: tone }} variant="caption" weight="semibold">{(stage.sla.decisionMode === "yes_no" || stage.sla.decisionMode === "decision" ? "Decision" : item.label).toUpperCase()}</Text>
                    </View>
                    {isFirst ? <View style={styles.startBadge}><Text tone="primary" variant="caption" weight="semibold">Starts here</Text></View> : null}
                  </View>
                  <Text weight="semibold">{stage.name || "Untitled stage"}</Text>
                  <Text tone="muted" variant="caption">{`${fmsStageSummary(stage)} · ${fmsTimingSummary(stage)}`}</Text>
                  {invalid ? <Text tone="danger" variant="caption" weight="medium">Needs attention</Text> : null}
                  {orphan ? <Text tone="danger" variant="caption">{"Not connected yet — choose it in an earlier step’s “Continue to”"}</Text> : null}
                  <View style={styles.connections}>
                    {outgoing.length ? outgoing.map((edge) => (
                      <View key={`${edge.to}:${edge.ruleId ?? "default"}`} style={styles.connection}>
                        <ArrowRight color={edge.kind === "branch" ? theme.colors.danger : theme.colors.brand} size={14} />
                        <Text style={styles.flex} tone="warm" variant="caption">{`${edge.label ? `${edge.label}: ` : ""}${names.get(edge.to) ?? edge.to}`}</Text>
                      </View>
                    )) : stage.type !== "end" ? (
                      <View style={styles.connection}><Flag color={theme.colors.success} size={14} /><Text tone="success" variant="caption" weight="medium">Completes here</Text></View>
                    ) : null}
                  </View>
                </View>
                <ChevronRight color={theme.colors.textMuted} size={20} />
              </Pressable>
              {isFirst ? null : (
                <View style={styles.actions}>
                  <Pressable accessibilityLabel={`Duplicate ${stage.name}`} accessibilityRole="button" onPress={() => onDuplicate(stage.key)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Copy color={theme.colors.textMuted} size={18} /></Pressable>
                  <Pressable accessibilityLabel={`Delete ${stage.name}`} accessibilityRole="button" onPress={() => onDelete(stage.key)} style={({ pressed }) => [styles.action, pressed && styles.pressed]}><Trash2 color={theme.colors.textMuted} size={18} /></Pressable>
                </View>
              )}
            </View>
            {canAppend ? (
              <Pressable accessibilityLabel={`Add next step after ${stage.name}`} accessibilityRole="button" onPress={() => onAddAfter(stage.key)} style={({ pressed }) => [styles.add, pressed && styles.pressed]}>
                <Plus color={theme.colors.brand} size={16} />
                <Text tone="primary" variant="caption" weight="semibold">Add step here</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  list: { gap: theme.space.sm },
  item: { gap: theme.space.sm },
  flex: { flex: 1, minWidth: 0 },
  card: { borderRadius: theme.radius.xl, backgroundColor: theme.colors.surface, overflow: "hidden" },
  body: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm, padding: theme.space.md },
  number: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: theme.colors.borderStrong, alignItems: "center", justifyContent: "center" },
  badges: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 4 },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderRadius: theme.radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  startBadge: { borderWidth: 1, borderColor: theme.colors.borderStrong, borderRadius: theme.radius.pill, paddingHorizontal: 6, paddingVertical: 1 },
  connections: { gap: 4, marginTop: theme.space.xs },
  connection: { flexDirection: "row", alignItems: "flex-start", gap: 6 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: theme.space.xs, borderTopWidth: 1, borderTopColor: theme.colors.border, paddingHorizontal: theme.space.xs },
  action: { width: theme.touchTarget, height: theme.touchTarget, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.md },
  add: { alignSelf: "center", flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: theme.space.md, borderWidth: 1, borderStyle: "dashed", borderColor: theme.colors.borderStrong, borderRadius: theme.radius.pill },
  pressed: { opacity: 0.75 },
}));
