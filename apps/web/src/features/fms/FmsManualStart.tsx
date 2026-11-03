import { useState } from "react";
import { Play } from "lucide-react";
import { fmsAssignedWorkPath } from "@jewelos/core";
import { Button, Modal, Notice } from "@/components/ui";
import type { FmsFlowRow } from "./api";
import { startFmsWithoutForm } from "./triggerApi";

/**
 * Mode C (0374): start a manual workflow without an intake form. The server checks scope and
 * permission, applies the first step's own assignment, and replays a retried tap (one start key
 * per open dialog), so a double tap never starts two runs.
 */
export function FmsManualStart({ flow, onClose, onStarted }: { flow: FmsFlowRow; onClose: () => void; onStarted: () => void }) {
  const [title, setTitle] = useState(flow.name);
  const [note, setNote] = useState("");
  const [clientCode, setClientCode] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true); setError(null);
    try {
      const started = await startFmsWithoutForm({ flowId: flow.id, title, note, clientCode, firstAssigneeId: null, key });
      onStarted();
      window.location.assign(fmsAssignedWorkPath({ kind: "stage", instanceId: started.instanceId, instanceStageId: null }));
    } catch (caught) { setError(caught instanceof Error ? caught.message : "The workflow could not start"); } finally { setBusy(false); }
  };
  return <Modal mobileFullscreen onClose={onClose} title={`Start ${flow.name}`}>
    <div className="space-y-4" data-testid="fms-manual-start">
      <p className="text-sm text-soft-grey">No starting form: the first step goes to its assigned person straight away.</p>
      <label className="block"><span className="label">Title *</span><input className="field" maxLength={200} onChange={(event) => setTitle(event.target.value)} value={title} /></label>
      <label className="block"><span className="label">Note</span><textarea className="field min-h-24" maxLength={1000} onChange={(event) => setNote(event.target.value)} value={note} /></label>
      <label className="block"><span className="label">CRM client code (optional)</span><input className="field" maxLength={40} onChange={(event) => setClientCode(event.target.value)} placeholder="MKC-..." value={clientCode} /></label>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="flex justify-end gap-2"><Button onClick={onClose} variant="ghost">Cancel</Button><Button disabled={busy || !title.trim()} onClick={() => void start()}><Play className="size-4" />{busy ? "Starting..." : "Start workflow"}</Button></div>
    </div>
  </Modal>;
}
