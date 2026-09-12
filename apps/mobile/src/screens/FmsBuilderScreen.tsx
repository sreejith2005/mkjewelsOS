import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, ScrollView, StyleSheet, View } from "react-native";
import { useNavigation, useRoute, type RouteProp } from "@react-navigation/native";
import { CheckCircle2, FileText, Redo2, Save, Send, TestTube2, Undo2, UserRoundPlus } from "lucide-react-native";
import { normalizeFmsDefinition, validateFmsDefinition, type FmsFlowDefinition, type FmsStageDefinition } from "@jewelos/core";
import { loadFmsBuilderData, publishFmsFlow, saveFmsContextAssigneeDefault, saveFmsDraft, type FmsData, type FmsFlowRow } from "@jewelos/data/fms/api";
import { flowToDefinition, newFmsStage, removeFmsStage } from "@jewelos/data/fms/definition";
import { fmsDepartmentLabel } from "@jewelos/data/fms/departments";
import { newRequestKey } from "@jewelos/data/runtime";
import { FmsGraphCanvas } from "@/features/fms/FmsGraphCanvas";
import { FmsStageEditor } from "@/features/fms/FmsStageEditor";
import { errorText } from "@/lib/log";
import { useAsyncData } from "@/lib/useAsyncData";
import type { RootStackParamList } from "@/navigation/types";
import { makeStyles } from "@/theme/makeStyles";
import { useAppTheme } from "@/theme/ThemeProvider";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Pressable } from "@/ui/Pressable";
import { Screen } from "@/ui/Screen";
import { SearchField } from "@/ui/SearchField";
import { Sheet } from "@/ui/Sheet";
import { Banner, ErrorState, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

type Route = RouteProp<RootStackParamList, "FmsBuilder">;

const confirm = (title: string, message: string, action: string) =>
  new Promise<boolean>((resolve) =>
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: action, style: "destructive", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) }),
  );

/** Loads the builder data, then opens the flow named in the route (or a new one). */
export function FmsBuilderScreen() {
  const { params } = useRoute<Route>();
  const navigation = useNavigation();
  const state = useAsyncData(loadFmsBuilderData, []);
  if (state.loading) return <Screen><LoadingState label="Loading workflow…" /></Screen>;
  if (state.error || !state.data) return <Screen><ErrorState message={state.error ?? "Workflow could not be loaded."} onRetry={() => void state.reload()} /></Screen>;
  const flow = params.flowId ? state.data.flows.find((item) => item.id === params.flowId) ?? null : null;
  if (params.flowId && !flow) return <Screen><ErrorState message="This workflow version is no longer available." title="Not found" /></Screen>;
  return (
    <FmsFlowBuilder
      data={state.data}
      duplicate={params.duplicate ?? false}
      flow={flow}
      onClose={() => navigation.goBack()}
      onSaved={async () => { await state.refresh(); }}
    />
  );
}

/** The web `FmsFlowBuilder`: the same editing model, validation, and audited saves. */
function FmsFlowBuilder({ flow, data, duplicate, onClose, onSaved }: { flow: FmsFlowRow | null; data: FmsData; duplicate: boolean; onClose: () => void; onSaved: () => Promise<void> }) {
  const theme = useAppTheme();
  const styles = useStyles();
  const navigation = useNavigation();
  const initial = useMemo(() => { const value = flowToDefinition(flow, data); return duplicate ? { ...value, id: undefined, familyId: undefined, version: 1, lifecycle: "draft" as const, name: `${value.name} (Copy)` } : value; }, [data, duplicate, flow]);
  const [definition, setDefinition] = useState<FmsFlowDefinition>(initial);
  const [past, setPast] = useState<FmsFlowDefinition[]>([]);
  const [future, setFuture] = useState<FmsFlowDefinition[]>([]);
  const [screen, setScreen] = useState<"details" | "canvas">(flow ? "canvas" : "details");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [persistedId, setPersistedId] = useState(flow?.id ?? null);
  const [savedSnapshot, setSavedSnapshot] = useState(() => JSON.stringify(normalizeFmsDefinition(initial)));
  const [busy, setBusy] = useState<"save" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);

  const normalized = useMemo(() => normalizeFmsDefinition(definition), [definition]);
  const issues = useMemo(() => validateFmsDefinition(normalized, { formFields: data.formFields, availableFormIds: data.forms.map((form) => form.id) }), [data.formFields, data.forms, normalized]);
  const invalidKeys = useMemo(() => new Set(issues.flatMap((issue) => issue.stageKey ? [issue.stageKey] : [])), [issues]);
  const selected = normalized.stages.find((stage) => stage.key === selectedKey) ?? null;
  const dirty = JSON.stringify(normalized) !== savedSnapshot;
  const assignableStages = normalized.stages.filter((stage) => ["form", "task", "approval"].includes(stage.type));
  const assignedStages = assignableStages.filter((stage) => stage.assigneeRules.some((rule) => rule.type === "specific_user" && rule.userProfileId));
  /** Scope and workflow context are no longer asked for; existing values are preserved untouched. */
  const scopeSummary = normalized.scope === "branch" ? data.branches.find((branch) => branch.id === normalized.branchId)?.name ?? "one branch"
    : normalized.scope === "department" ? fmsDepartmentLabel(data.departments.find((department) => department.id === normalized.departmentId) ?? { id: "", branch_id: null, name: "one department" }, data.branches)
      : null;
  const contextDefaultAssigneeId = normalized.moduleContext ? data.contextDefaults?.find((item) => item.module_context === normalized.moduleContext)?.user_profile_id : undefined;

  // The phone's equivalent of the web `beforeunload` warning. A save that has
  // just finished may close the screen before `dirty` re-renders, hence the ref.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const leavingRef = useRef(false);
  useEffect(() => navigation.addListener("beforeRemove", (event) => {
    if (!dirtyRef.current || leavingRef.current) return;
    event.preventDefault();
    Alert.alert("Discard changes?", "This workflow has unsaved changes.", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(event.data.action) },
    ]);
  }), [navigation]);

  const commit = (next: FmsFlowDefinition | ((current: FmsFlowDefinition) => FmsFlowDefinition)) => {
    setDefinition((current) => { const value = typeof next === "function" ? next(current) : next; setPast((items) => [...items.slice(-49), current]); setFuture([]); return value; });
    setSuccess(null);
  };
  const undo = () => { const previous = past.at(-1); if (!previous) return; setFuture((items) => [definition, ...items]); setPast((items) => items.slice(0, -1)); setDefinition(previous); };
  const redo = () => { const next = future[0]; if (!next) return; setPast((items) => [...items, definition]); setFuture((items) => items.slice(1)); setDefinition(next); };
  const nextKey = () => { let index = normalized.stages.length + 1; while (normalized.stages.some((stage) => stage.key === `stage_${index}`)) index += 1; return `stage_${index}`; };
  const add = (type: FmsStageDefinition["type"], after?: string) => {
    if (!normalized.stages.length && type !== "form") { setError("Every workflow starts with a Form. Add the Form trigger first."); return; }
    const stage = {
      ...newFmsStage(type, normalized.stages.length),
      key: nextKey(),
      name: type === "form" && normalized.stages.length === 0 ? "Start form" : type === "task" ? "Step" : newFmsStage(type, 0).name,
      assigneeRules: ["form", "task", "approval"].includes(type) && contextDefaultAssigneeId ? [{ type: "specific_user" as const, userProfileId: contextDefaultAssigneeId }] : [],
    };
    const sourceKey = after ?? (selected && !["branch", "parallel_start", "end"].includes(selected.type) ? selected.key : undefined);
    commit((current) => {
      const currentStages = normalizeFmsDefinition(current).stages;
      const sourceIndex = sourceKey ? currentStages.findIndex((item) => item.key === sourceKey) : -1;
      const source = sourceIndex >= 0 ? currentStages[sourceIndex] : undefined;
      const next = source?.defaultNextStageKey;
      const prepared = next ? { ...stage, defaultNextStageKey: next } : stage;
      const stages = [...currentStages];
      if (sourceIndex >= 0) { stages[sourceIndex] = { ...source!, defaultNextStageKey: stage.key }; stages.splice(sourceIndex + 1, 0, prepared); }
      else stages.push(prepared);
      return { ...current, stages };
    });
    setSelectedKey(stage.key); setError(null);
  };
  const replace = (key: string, value: FmsStageDefinition) => commit((current) => ({ ...current, stages: current.stages.map((stage) => stage.key === key ? value : stage) }));
  const remove = async (key: string) => {
    const target = normalized.stages.find((stage) => stage.key === key);
    if (!target) return;
    if (normalized.stages[0]?.key === key) { setError("The first Form is the workflow trigger and cannot be deleted. Change its linked Form instead."); return; }
    if (!(await confirm("Delete step?", `Delete ${target.name || "this step"}? Connections will be repaired where possible.`, "Delete"))) return;
    const stages = removeFmsStage(normalized.stages, key); commit({ ...definition, stages }); setSelectedKey(null);
  };
  const duplicateStage = (key: string) => { const source = normalized.stages.find((stage) => stage.key === key); if (!source || normalized.stages[0]?.key === key) return; const stage = { ...source, key: nextKey(), name: `${source.name} copy`, order: normalized.stages.length, defaultNextStageKey: undefined, branchRules: source.type === "branch" ? [{ id: newRequestKey(), source: "outcome" as const, operator: "default" as const, order: 0 }] : [], parallelTargetStageKeys: [], joinRequiredStageKeys: [] }; commit({ ...definition, stages: [...normalized.stages, stage] }); setSelectedKey(stage.key); };
  /** A first connection becomes the plain next step; each extra one becomes an ordered route. */
  const connect = (from: string, to: string) => {
    if (from === to) return;
    commit((current) => ({ ...current, stages: current.stages.map((stage) => {
      if (stage.key !== from) return stage;
      if (stage.type === "branch") return { ...stage, branchRules: stage.branchRules.map((rule, index) => rule.operator === "default" || index === stage.branchRules.length - 1 ? { ...rule, nextStageKey: to, nextFlowId: undefined } : rule) };
      if (stage.type === "parallel_start") return { ...stage, parallelTargetStageKeys: stage.parallelTargetStageKeys.includes(to) ? stage.parallelTargetStageKeys : [...stage.parallelTargetStageKeys, to] };
      if (!stage.defaultNextStageKey) return { ...stage, defaultNextStageKey: to };
      if (stage.defaultNextStageKey === to || stage.branchRules.some((rule) => rule.nextStageKey === to)) return stage;
      const source = stage.formTemplateId && (data.formFields[stage.formTemplateId]?.length ?? 0) > 0 ? "form_answer" as const : stage.sla.decisionMode === "yes_no" ? "outcome" as const : "context" as const;
      const rule = { id: newRequestKey(), source, ...(source === "form_answer" ? { sourceKey: data.formFields[stage.formTemplateId!]![0]!.key } : {}), operator: "equals" as const, value: source === "outcome" ? stage.sla.decisionOptions?.[0]?.key ?? "" : "", nextStageKey: to, order: stage.branchRules.length };
      return { ...stage, branchRules: [...stage.branchRules, rule] };
    }) }));
    setSelectedKey(from);
  };
  /** Canvas coordinates live on the stage, so a manual arrangement survives a reload. */
  const moveStages = (positions: Readonly<Record<string, { x: number; y: number }>>) =>
    commit((current) => ({ ...current, stages: current.stages.map((stage) => positions[stage.key] ? { ...stage, position: positions[stage.key] } : stage) }));
  /** Moves an existing connection onto a different step in one undoable commit. */
  const reconnect = (from: string, previousTo: string, nextTo: string, ruleId?: string) => {
    if (from === nextTo || previousTo === nextTo) return;
    commit((current) => ({ ...current, stages: current.stages.map((stage) => {
      if (stage.key !== from) return stage;
      if (ruleId) return { ...stage, branchRules: stage.branchRules.map((rule) => rule.id === ruleId ? { ...rule, nextStageKey: nextTo, nextFlowId: undefined } : rule) };
      if (stage.type === "parallel_start") return { ...stage, parallelTargetStageKeys: stage.parallelTargetStageKeys.map((key) => key === previousTo ? nextTo : key) };
      return stage.defaultNextStageKey === previousTo ? { ...stage, defaultNextStageKey: nextTo } : stage;
    }) }));
    setSelectedKey(from);
  };
  const disconnect = (from: string, to: string, ruleId?: string) => commit((current) => ({ ...current, stages: current.stages.map((stage) => {
    if (stage.key !== from) return stage;
    if (ruleId) return { ...stage, branchRules: stage.branchRules.filter((rule) => rule.id !== ruleId).map((rule, order) => ({ ...rule, order })) };
    if (stage.type === "parallel_start") return { ...stage, parallelTargetStageKeys: stage.parallelTargetStageKeys.filter((key) => key !== to) };
    return stage.defaultNextStageKey === to ? { ...stage, defaultNextStageKey: undefined } : stage;
  }) }));
  const ensureFirstForm = () => { if (normalized.stages.length) return; const first = { ...newFmsStage("form", 0), key: "start_form", name: "Start form", assigneeRules: contextDefaultAssigneeId ? [{ type: "specific_user" as const, userProfileId: contextDefaultAssigneeId }] : [] }; commit({ ...definition, stages: [first] }); setSelectedKey(first.key); };
  const persist = async () => { const id = await saveFmsDraft(persistedId, normalized); setPersistedId(id); setSavedSnapshot(JSON.stringify(normalized)); await onSaved(); return id; };
  const save = async () => { setBusy("save"); setError(null); setSuccess(null); try { await persist(); setSuccess("Draft saved"); } catch (caught) { setError(errorText(caught)); } finally { setBusy(null); } };
  const publish = async () => {
    if (assignedStages.length !== assignableStages.length) { setAssigning(true); setError("Assign an owner to every step before publishing."); return; }
    if (issues.length) { setError("Resolve the publish-readiness issues below before publishing."); return; }
    setBusy("publish"); setError(null);
    try { const id = await persist(); await publishFmsFlow(id); await onSaved(); setSuccess("Workflow published and ready to run"); leavingRef.current = true; onClose(); }
    catch (caught) { setError(errorText(caught)); } finally { setBusy(null); }
  };

  if (screen === "details") {
    return (
      <Screen scroll>
        <Text tone="primary" variant="caption" weight="semibold">WORKFLOW DETAILS</Text>
        <Text variant="heading" weight="semibold">Name this workflow</Text>
        <Text tone="muted" variant="small">The first canvas step will be a Form trigger. No Start or End nodes are needed.</Text>
        <Card>
          <TextField label="Workflow name *" maxLength={150} onChangeText={(name) => commit({ ...definition, name })} value={definition.name} />
          <TextField label="Purpose *" multiline onChangeText={(description) => commit({ ...definition, description })} value={definition.description ?? ""} />
          {scopeSummary ? <Text tone="muted" variant="caption">{`Existing scope kept: ${scopeSummary}. Scope is no longer part of workflow setup and stays exactly as it was saved.`}</Text> : null}
        </Card>
        <Button disabled={!normalized.name || !normalized.description?.trim()} full label="Open builder" onPress={() => { ensureFirstForm(); setScreen("canvas"); }} />
      </Screen>
    );
  }

  return (
    // The canvas owns its own pan and pinch, so this screen must not scroll:
    // a parent ScrollView steals the vertical drag before the canvas sees it.
    // The canvas is pinned above a separately scrolling editor region instead.
    <Screen>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text numberOfLines={1} variant="subtitle" weight="semibold">{normalized.name}</Text>
          <Text tone="muted" variant="caption">{dirty ? "Unsaved changes" : "Draft saved"}</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.toolbar} horizontal showsHorizontalScrollIndicator={false}>
        <Button disabled={!past.length} icon={<Undo2 color={theme.colors.primary} size={16} />} label="Undo" onPress={undo} variant="ghost" />
        <Button disabled={!future.length} icon={<Redo2 color={theme.colors.primary} size={16} />} label="Redo" onPress={redo} variant="ghost" />
        <Button icon={<TestTube2 color={theme.colors.primary} size={16} />} label="Check workflow" onPress={() => { setSuccess(issues.length ? null : "Workflow check passed"); setError(issues.length ? "Workflow check found issues. Review Publish readiness." : null); }} variant="secondary" />
        <Button busy={busy === "save"} disabled={!!busy} icon={<Save color={theme.colors.primary} size={16} />} label={busy === "save" ? "Saving..." : "Save draft"} onPress={() => void save()} variant="secondary" />
        <Button busy={busy === "publish"} disabled={!!busy || issues.length > 0} icon={<Send color={theme.colors.onPrimary} size={16} />} label={busy === "publish" ? "Publishing..." : "Publish"} onPress={() => void publish()} />
      </ScrollView>
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {success ? <Banner tone="success">{success}</Banner> : null}

      <View style={styles.canvasRegion}>
        <FmsGraphCanvas
          definition={normalized}
          formFields={data.formFields}
          invalidKeys={invalidKeys}
          onAddAfter={(key) => add("task", key)}
          onConnect={connect}
          onDelete={(key) => void remove(key)}
          onDisconnect={disconnect}
          onDuplicate={duplicateStage}
          onMove={moveStages}
          onReconnect={reconnect}
          onSelect={setSelectedKey}
          selectedKey={selected?.key ?? null}
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.details}
        keyboardShouldPersistTaps="handled"
        style={styles.flex}
      >
        <Text tone="muted" variant="caption">The initial Form starts the workflow. The final unconnected step completes it.</Text>
        <Text tone="warm" variant="caption" weight="semibold">BUILDING BLOCKS</Text>
      <Pressable accessibilityRole="button" onPress={() => add("task")} style={({ pressed }) => [styles.block, styles.blockPrimary, pressed && styles.pressed]}>
        <UserRoundPlus color={theme.colors.brand} size={18} />
        <View style={styles.flex}><Text weight="semibold" variant="small">Add Step</Text><Text tone="warm" variant="caption">Create the next general workflow step</Text></View>
      </Pressable>
      <View style={styles.blockRow}>
        <Pressable accessibilityRole="button" onPress={() => normalized.stages[0] && setSelectedKey(normalized.stages[0].key)} style={({ pressed }) => [styles.block, styles.half, pressed && styles.pressed]}>
          <FileText color={theme.colors.textWarm} size={16} />
          <View style={styles.flex}>
            <Text numberOfLines={1} variant="small" weight="semibold">{normalized.stages[0]?.formTemplateId ? data.forms.find((form) => form.id === normalized.stages[0]?.formTemplateId)?.name ?? "Form attached" : "None attached"}</Text>
            <Text tone="muted" variant="caption">Process form</Text>
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setAssigning(true)} style={({ pressed }) => [styles.block, styles.half, pressed && styles.pressed]}>
          <UserRoundPlus color={theme.colors.textWarm} size={16} />
          <View style={styles.flex}>
            <Text numberOfLines={1} variant="small" weight="semibold">{assignableStages.length ? `${assignedStages.length}/${assignableStages.length} assigned` : "No steps yet"}</Text>
            <Text tone="muted" variant="caption">Default assignees</Text>
          </View>
        </Pressable>
      </View>


      <Card accent={issues.length ? "danger" : "success"}>
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text weight="semibold">Publish readiness</Text>
            <Text tone="muted" variant="caption">{issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"} to resolve` : "Ready to publish"}</Text>
          </View>
          {issues.length ? null : <CheckCircle2 color={theme.colors.success} size={20} />}
        </View>
        {issues.map((issue, index) => (
          <Pressable accessibilityRole="button" key={`${issue.code}-${issue.stageKey ?? index}`} onPress={() => issue.stageKey && setSelectedKey(issue.stageKey)} style={({ pressed }) => [styles.issue, pressed && styles.pressed]}>
            <Text tone="danger" variant="caption">{issue.message}</Text>
          </Pressable>
        ))}
      </Card>
      </ScrollView>

      {selected ? (
        <Sheet scrollable={false} onClose={() => setSelectedKey(null)} tall title={`${selected.type.replaceAll("_", " ")} · ${selected.name}`} visible>
          <ScrollView keyboardShouldPersistTaps="handled">
            <FmsStageEditor data={data} onChange={(value) => { replace(selected.key, value); setSelectedKey(value.key); }} onDelete={() => void remove(selected.key)} stage={selected} stages={normalized.stages} />
          </ScrollView>
        </Sheet>
      ) : null}
      {assigning ? <DefaultAssigneesSheet data={data} definition={normalized} onChange={(stages) => commit((current) => ({ ...current, stages }))} onClose={() => setAssigning(false)} /> : null}
    </Screen>
  );
}

type Person = FmsData["users"][number];

/** The web `AssigneePicker` for one person: search, then a list of radio rows. */
function AssigneePicker({ label, people, branchNames, departmentNames, selectedId, onChange }: { label: string; people: readonly Person[]; branchNames: ReadonlyMap<string, string>; departmentNames: ReadonlyMap<string, string>; selectedId: string | null; onChange: (id: string) => void }) {
  const styles = useStyles();
  const theme = useAppTheme();
  const [search, setSearch] = useState("");
  const organization = (person: Person) => [person.department_id ? departmentNames.get(person.department_id) : undefined, person.branch_id ? branchNames.get(person.branch_id) : undefined, person.user_role ? person.user_role.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Role not assigned"].filter((value): value is string => Boolean(value)).join(" · ");
  const query = search.trim().toLocaleLowerCase();
  const visible = people.filter((person) => !query || `${person.employee_name ?? ""} ${person.employee_code ?? ""} ${organization(person)}`.toLocaleLowerCase().includes(query));
  return (
    <View style={styles.picker}>
      <Text variant="caption" weight="semibold">{label}</Text>
      <SearchField accessibilityLabel={`Search ${label.toLocaleLowerCase()}`} onChangeText={setSearch} placeholder="Search people" value={search} />
      {visible.slice(0, 40).map((person) => {
        const checked = selectedId === person.id;
        return (
          <Pressable accessibilityLabel={person.employee_name || "Unnamed user"} accessibilityRole="radio" accessibilityState={{ checked }} key={person.id} onPress={() => onChange(checked ? "" : person.id)} style={({ pressed }) => [styles.person, checked && styles.personChecked, pressed && styles.pressed]}>
            <View style={[styles.radio, checked && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primary }]} />
            <View style={styles.flex}>
              <Text numberOfLines={1} variant="small">{person.employee_name || "Unnamed user"}</Text>
              <Text numberOfLines={1} tone="muted" variant="caption">{organization(person) || "Organization details unavailable"}</Text>
            </View>
          </Pressable>
        );
      })}
      {visible.length === 0 ? <Text tone="muted" variant="caption">No matching people.</Text> : null}
    </View>
  );
}

function DefaultAssigneesSheet({ data, definition, onChange, onClose }: { data: FmsData; definition: FmsFlowDefinition; onChange: (stages: readonly FmsStageDefinition[]) => void; onClose: () => void }) {
  const styles = useStyles();
  const steps = definition.stages.filter((stage) => ["form", "task", "approval"].includes(stage.type));
  const [mappingError, setMappingError] = useState<string | null>(null);
  const setAssignee = async (key: string, userProfileId: string) => {
    onChange(definition.stages.map((stage) => stage.key !== key ? stage : { ...stage, assigneeRules: userProfileId ? [{ type: "specific_user", userProfileId }] : [] }));
    if (!definition.moduleContext || !userProfileId) return;
    try {
      await saveFmsContextAssigneeDefault(definition.moduleContext, userProfileId);
      setMappingError(null);
    } catch (caught) {
      setMappingError(errorText(caught));
    }
  };
  const people = data.users.filter((user) => user.working_status === "active" && user.account_status !== "inactive" && user.account_status !== "suspended" && user.is_login_enabled);
  const branchNames = new Map(data.branches.map((branch) => [branch.id, branch.name]));
  const departmentNames = new Map(data.departments.map((department) => [department.id, department.name]));
  return (
    <Sheet scrollable={false} onClose={onClose} tall title="Default assignees" visible>
      <ScrollView contentContainerStyle={styles.sheetBody} keyboardShouldPersistTaps="handled">
        <Text tone="muted" variant="small">{`Pre-assign a named person to each workflow step. Workflow scope remains independent from the selected person.${definition.moduleContext ? " Selecting a person also saves that context's default from the existing Users directory; individual stages remain editable." : ""}`}</Text>
        {mappingError ? <Banner tone="danger">{mappingError}</Banner> : null}
        {steps.map((stage, index) => (
          <Card key={stage.key}>
            <View style={styles.header}>
              <View style={styles.flex}>
                <Text weight="semibold">{stage.name}</Text>
                <Text tone="muted" variant="caption">{stage.type === "form" && index === 0 ? "Process form" : "Workflow step"}</Text>
              </View>
              <Text tone="primary" variant="caption">{`Step ${index + 1}`}</Text>
            </View>
            <AssigneePicker
              branchNames={branchNames}
              departmentNames={departmentNames}
              label={`Assign ${stage.name}`}
              onChange={(id) => void setAssignee(stage.key, id)}
              people={people}
              selectedId={stage.assigneeRules.find((rule) => rule.type === "specific_user")?.userProfileId ?? null}
            />
          </Card>
        ))}
        <Button full label="Done" onPress={onClose} />
      </ScrollView>
    </Sheet>
  );
}

const useStyles = makeStyles((theme) => StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  flex: { flex: 1, minWidth: 0 },
  /** A bounded canvas region: tall enough to build in, never tall enough to push the editor off-screen. */
  canvasRegion: { height: 360, flexShrink: 0 },
  details: { gap: theme.space.md, paddingBottom: theme.space.lg },
  toolbar: { gap: theme.space.xs, paddingRight: theme.space.md },
  block: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, backgroundColor: theme.colors.surface, padding: theme.space.sm },
  blockPrimary: { borderColor: theme.colors.borderStrong, backgroundColor: theme.colors.brandSoft },
  blockRow: { flexDirection: "row", gap: theme.space.sm },
  half: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.75 },
  issue: { borderWidth: 1, borderColor: theme.colors.danger, backgroundColor: theme.colors.dangerSoft, borderRadius: theme.radius.md, padding: theme.space.sm },
  sheetBody: { gap: theme.space.md, paddingBottom: theme.space.md },
  picker: { gap: theme.space.xs, borderWidth: 1, borderColor: theme.colors.border, borderRadius: theme.radius.lg, backgroundColor: theme.colors.background, padding: theme.space.sm },
  person: { flexDirection: "row", alignItems: "center", gap: theme.space.sm, minHeight: 44, borderRadius: theme.radius.md, paddingHorizontal: theme.space.xs },
  personChecked: { backgroundColor: theme.colors.surface },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.colors.border },
}));
