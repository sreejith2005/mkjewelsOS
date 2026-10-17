import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import type { FmsHandoffDecision, FmsTransitionRequest, FmsWorkPreview, FmsWorkResult } from "@jewelos/core";
import { listFmsHandoffRecipients, previewFmsWork, type FmsHandoffRecipient } from "@jewelos/data/fms/work";
import { runFmsHandoff } from "@jewelos/data/fms/confirmation";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { Button } from "@/ui/Button";
import { TextField } from "@/ui/TextField";
import { Card } from "@/ui/Card";
import { Banner } from "@/ui/states";
import { makeStyles } from "@/theme/makeStyles";

type Confirmation = Readonly<{ request: FmsTransitionRequest; preview: FmsWorkPreview }>;
export function useFmsHandoffConfirmation(identity?: string) {
  const [pending, setPending] = useState<Confirmation | null>(null);
  const [result, setResult] = useState<FmsWorkResult | null>(null);
  const resolveChoice = useRef<((choices: FmsHandoffDecision | null) => void) | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; setPending(null); return () => { mounted.current = false; resolveChoice.current?.(null); resolveChoice.current = null; }; }, [identity]);
  const close = (choices: FmsHandoffDecision | null) => { resolveChoice.current?.(choices); resolveChoice.current = null; setPending(null); };
  const confirmWork = async (request: FmsTransitionRequest) => {
    const completed = await runFmsHandoff(request, preview => {
      if (!mounted.current) return Promise.resolve(null);
      setPending({ request, preview });
      return new Promise(resolve => { resolveChoice.current = resolve; });
    });
    if (completed && mounted.current) setResult(completed);
    return completed;
  };
  return { confirmWork, result, confirmation: pending ? <FmsHandoffConfirmation request={pending.request} preview={pending.preview} onConfirm={close} onCancel={() => close(null)} /> : null };
}
export function FmsHandoffConfirmation({ request, preview, onConfirm, onCancel }: Confirmation & {
  onConfirm: (decision: FmsHandoffDecision) => void; onCancel: () => void;
}) {
  const styles = useStyles();
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<readonly FmsHandoffRecipient[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPreview, setCurrentPreview] = useState(preview);
  const [checkedChoices, setCheckedChoices] = useState("[]");
  const [choiceError, setChoiceError] = useState<string | null>(null);
  const handoffs = useMemo(() => preview.destinations.flatMap(d => choices[d.targetStageId] ? [{ targetStageId: d.targetStageId, userProfileId: choices[d.targetStageId]! }] : []), [preview.destinations, choices]);
  const choiceKey = JSON.stringify(handoffs);
  useEffect(() => {
    if (choiceKey === "[]") { setCurrentPreview(preview); setCheckedChoices(choiceKey); setChoiceError(null); return; }
    let active = true; setChoiceError(null);
    void previewFmsWork(request, handoffs).then(value => { if (active) { setCurrentPreview(value); setCheckedChoices(choiceKey); } })
      .catch((error: unknown) => { if (active) setChoiceError(error instanceof Error ? error.message : "Unable to check this handoff"); });
    return () => { active = false; };
  }, [request, preview, choiceKey, handoffs]);
  const generation = useRef(0);
  useEffect(() => {
    if (!picking) return;
    const version = ++generation.current;
    setBusy(true); setPeople([]); setError(null); setCursor(null);
    const timer = setTimeout(() => { void listFmsHandoffRecipients(request, picking, query)
      .then(result => { if (generation.current === version) { setPeople(result.people); setCursor(result.nextCursor); } })
      .catch((caught: unknown) => { if (generation.current === version) setError(caught instanceof Error ? caught.message : "Unable to load eligible employees"); })
      .finally(() => { if (generation.current === version) setBusy(false); }); }, 150);
    return () => { ++generation.current; clearTimeout(timer); };
  }, [request, picking, query]);
  const more = async () => {
    if (!picking || !cursor || busy) return;
    const version = generation.current; setBusy(true);
    try { const result = await listFmsHandoffRecipients(request, picking, query, cursor);
      if (generation.current === version) { setPeople(current => [...current, ...result.people]); setCursor(result.nextCursor); }
    } catch (caught) { if (generation.current === version) setError(caught instanceof Error ? caught.message : "Unable to load employees"); }
    finally { if (generation.current === version) setBusy(false); }
  };
  const missing = currentPreview.destinations.some(d => !choices[d.targetStageId] && (d.issue || !d.effectiveUserId));
  return <Sheet visible title={preview.destinations.length ? "Complete Stage and Assign Next Work" : "Confirm Stage Completion"} onClose={onCancel} tall>
    <View style={styles.body}>
      <Text>Current Stage: {preview.currentStageName}</Text>
      {currentPreview.wouldDefer ? <Banner>{`Your form and handoff will be saved. Next work starts after the remaining requirements are met.${currentPreview.requirements.map(item => `\n• ${item}`).join("")}`}</Banner> : null}
      {currentPreview.destinations.map(d => <Card key={d.targetStageId}><View style={styles.body}>
        <Text weight="semibold">Next Stage: {d.stageName}</Text><Text>Selected Employee: {names[d.targetStageId] ?? d.selectedEmployeeName ?? d.employeeName ?? "Select an employee"}</Text>
        {d.selectedUserId && d.effectiveUserId && d.selectedUserId !== d.effectiveUserId ? <Banner>{`Assigned employee through availability coverage: ${d.employeeName ?? "Configured employee"}`}</Banner> : null}
        {d.locked ? <Banner>Fixed employee — locked by the workflow administrator. The form's employee choice does not replace this owner.</Banner> : null}
        {d.issue ? <Banner tone="danger">{d.issue}</Banner> : null}
        {d.allowHandoff && !d.locked ? <Button label={preview.destinations.length > 1 ? `Assign a Different Employee for ${d.stageName}` : "Assign to a Different Employee"} variant="secondary" onPress={() => { setPicking(d.targetStageId); setQuery(""); }} /> : null}
      </View></Card>)}
      {picking ? <View style={styles.body}>
        <TextField label="Search eligible employees" value={query} onChangeText={setQuery} />
        {busy ? <Text tone="muted">Loading eligible employees...</Text> : null}{error ? <Banner tone="danger">{error}</Banner> : null}
        {people.map(person => <Button key={person.id} label={`${choices[picking] === person.id ? "✓ " : ""}${person.employeeName}\n${[person.designation, person.department, person.branch].filter(Boolean).join(" · ")}`} variant="secondary" onPress={() => {
          setChoices(current => ({ ...current, [picking]: person.id })); setNames(current => ({ ...current, [picking]: person.employeeName }));
        }} />)}
        {!busy && !people.length && !error ? <Text tone="muted">No eligible employees match this search.</Text> : null}
        {cursor ? <Button label="Load more employees" disabled={busy} variant="secondary" onPress={() => void more()} /> : null}
      </View> : null}
      {checkedChoices !== choiceKey && !choiceError ? <Text tone="muted">Checking the selected employee and availability coverage...</Text> : null}
      {choiceError ? <Banner tone="danger">{choiceError}</Banner> : null}
      {!preview.destinations.length ? <Text tone="muted">The workflow finishes after all required work and approvals are complete.</Text> : <Text>How would you like to continue?</Text>}
      <Button label={!preview.destinations.length ? "Confirm Completion" : handoffs.length ? "Confirm Next Work" : "Continue with Selected Employee"} disabled={!!missing || checkedChoices !== choiceKey || !!choiceError} onPress={() => onConfirm({ handoffs, preview: currentPreview })} />
      <Button label="Cancel and Return to Form" variant="ghost" onPress={onCancel} />
    </View>
  </Sheet>;
}
const useStyles = makeStyles(theme => StyleSheet.create({ body: { gap: theme.space.md } }));
