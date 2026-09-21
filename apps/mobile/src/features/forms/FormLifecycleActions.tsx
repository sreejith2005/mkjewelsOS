import { useEffect, useState } from "react";
import { deleteForm, formDeletionImpact, type FormBundle, type FormDeletionImpact } from "@jewelos/data/forms/api";
import { Button } from "@/ui/Button";
import { Card, CardRow } from "@/ui/Card";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { LoadingState } from "@/ui/states";

export function FormLifecycleActions({ form, onClose, onDeleted }: { form: FormBundle | null; onClose: () => void; onDeleted: (impact: FormDeletionImpact) => Promise<void> }) {
  const [impact, setImpact] = useState<FormDeletionImpact | null>(null); const [result, setResult] = useState<FormDeletionImpact | null>(null); const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { if (!form) { setImpact(null); setResult(null); return; } let live = true; setError(null); void formDeletionImpact(form.id).then((next) => { if (live) setImpact(next); }).catch((caught) => { if (live) setError(caught instanceof Error ? caught.message : "Unable to check this form."); }); return () => { live = false; }; }, [form]);
  const remove = async () => { if (!form || !impact) return; setBusy(true); try { const next = await deleteForm(form.id); setResult(next); await onDeleted(next); } catch (caught) { setError(caught instanceof Error ? caught.message : "Delete failed."); } finally { setBusy(false); } };
  const shown = result ?? impact; const taskCount = shown ? shown.tasks + shown.taskTemplates : 0;
  return <Sheet visible={Boolean(form)} title={result ? `${result.form.name} was deleted` : `Delete ${form?.name ?? "form"}?`} onClose={onClose}>{error ? <Text tone="danger">{error}</Text> : null}{!shown && !error ? <LoadingState label="Checking deletion impact…" /> : null}{shown ? <><Text tone={result ? "default" : "danger"}>{result ? "The audited deletion completed." : "This removes the form itself and cannot be undone."}</Text><Card><CardRow label="Readable submissions retained" value={String(shown.submissions)} /><CardRow label="Tasks no longer requiring it" value={String(taskCount)} /><CardRow label="Pending starters withdrawn" value={String(shown.starterAssignments)} /><CardRow label="Affected workflows" value={String(shown.flows.length)} /></Card>{shown.flows.map((flow) => <Card key={flow.id}><Text weight="semibold">{flow.name} · v{flow.version}</Text><Text tone="muted">{flow.action.replaceAll("_", " ")}{flow.activeInstances ? ` · ${flow.activeInstances} active run(s) continue` : ""}</Text>{flow.stages?.length ? <Text tone="muted">Stages: {flow.stages.join(", ")}</Text> : null}</Card>)}</> : null}{result ? <Button full label="Done" onPress={onClose} /> : <><Button full busy={busy} disabled={!impact} label="Delete this form" variant="danger" onPress={() => void remove()} /><Button full label="Keep it" variant="secondary" onPress={onClose} /></>}</Sheet>;
}
