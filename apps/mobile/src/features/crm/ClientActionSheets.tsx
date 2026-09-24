import { useState } from "react";
import { validateCrmFollowupDraft } from "@jewelos/core";
import { createFollowup, logInteraction, reassignClient } from "@jewelos/data/crm/api";
import type { CrmClientDetail, CrmOptions } from "@jewelos/data/crm/types";
import { DateField } from "@/forms/DateField";
import { Button } from "@/ui/Button";
import { OptionPicker } from "@/ui/OptionPicker";
import { Sheet } from "@/ui/Sheet";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

type Kind = "interaction" | "followup" | "reassign";
export function ClientActionSheet({ kind, detail, options, defaultAssignee, close, done }: { kind: Kind | null; detail: CrmClientDetail; options: CrmOptions; defaultAssignee: string; close: () => void; done: () => Promise<void> }) {
  const [type, setType] = useState("call"); const [subject, setSubject] = useState(""); const [text, setText] = useState(""); const [due, setDue] = useState(""); const [assigned, setAssigned] = useState(kind === "reassign" ? detail.client.assigned_crm_id ?? "" : defaultAssignee); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const people = options.profiles.filter((item) => ["crm", "manager", "admin", "super_admin"].includes(item.user_role ?? "")).map((item) => ({ value: item.id, label: item.label }));
  const submit = async () => {
    if (!kind) return;
    if (kind === "followup") { const invalid = validateCrmFollowupDraft({ subject, dueDate: due, assignedTo: assigned }); if (invalid) { setError(invalid); return; } }
    if (kind === "interaction" && !subject.trim()) { setError("Interaction subject is required."); return; }
    if (kind === "reassign" && (!assigned || !detail.client.branch_id)) { setError("An assignee and home branch are required."); return; }
    setBusy(true); setError(null);
    try {
      if (kind === "interaction") await logInteraction(detail.client.id, { type, subject, outcome: text, occurred_at: new Date().toISOString(), followup_due_date: due || undefined, followup_subject: subject });
      if (kind === "followup") await createFollowup(detail.client.id, { subject, due_date: due, assigned_to: assigned });
      if (kind === "reassign") await reassignClient(detail.client.id, assigned, detail.client.branch_id!, detail.client.record_version);
      await done();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "CRM action failed."); setBusy(false); }
  };
  return <Sheet visible={kind !== null} title={kind === "interaction" ? "Log interaction" : kind === "followup" ? "Create follow-up" : "Reassign client"} onClose={close}>
    {error ? <Text tone="danger">{error}</Text> : null}
    {kind === "interaction" ? <OptionPicker label="Type" options={[{ value: "call", label: "Call" }, { value: "message", label: "Message" }, { value: "email", label: "Email" }, { value: "note", label: "Note" }]} selected={[type]} onChange={(ids) => setType(ids[0] ?? "call")} /> : null}
    {kind !== "reassign" ? <TextField label="Subject" required value={subject} onChangeText={setSubject} /> : null}
    {kind === "interaction" ? <><TextField label="Outcome / summary" multiline value={text} onChangeText={setText} /><DateField label="Optional follow-up date" mode="date" value={due} disabled={busy} invalid={false} onChange={setDue} /></> : null}
    {kind === "followup" ? <DateField label="Due date" mode="date" value={due} disabled={busy} invalid={!due} onChange={setDue} /> : null}
    {kind === "followup" || kind === "reassign" ? <OptionPicker label="Assigned CRM" options={people} selected={assigned ? [assigned] : []} onChange={(ids) => setAssigned(ids[0] ?? "")} /> : null}
    {kind === "reassign" ? <Text tone="muted" variant="small">The client home branch remains unchanged; choose the CRM owner directly.</Text> : null}
    <Button full busy={busy} label={kind === "interaction" ? "Save interaction" : kind === "followup" ? "Create follow-up" : "Confirm reassignment"} onPress={() => void submit()} />
  </Sheet>;
}
