import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, Check } from "lucide-react";
import { Button, Field, Modal, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import { handOverFmsStep, listFmsHandoverCandidates, type FmsHandoverCandidate } from "./api";

/** One tap fills the reason; most hand-overs are one of these. */
export const FMS_HANDOVER_REASONS = ["I did not attend this client", "I am busy with another client", "I am not in the store today"] as const;

/**
 * Work started from a CRM form goes to the client's CRM. Whoever has it can pass it to another
 * CRM, or to a salesperson of the branch. The server decides who may hand over and to whom
 * (handover_fms_step_with_audit); this renders nothing unless it offers someone.
 */
export function FmsCrmHandover({ instanceStageId, onDone }: { instanceStageId: string; onDone: () => Promise<void> }) {
  const [people, setPeople] = useState<FmsHandoverCandidate[]>([]);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handedTo, setHandedTo] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void listFmsHandoverCandidates(instanceStageId).then((rows) => { if (active) setPeople(rows); }).catch(() => { if (active) setPeople([]); });
    return () => { active = false; };
  }, [instanceStageId]);

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const shown = query ? people.filter((person) => person.employee_name.toLowerCase().includes(query)) : people;
    return [
      { key: "crm", title: "CRM team", people: shown.filter((person) => person.team === "crm") },
      { key: "sales", title: "Salespeople", people: shown.filter((person) => person.team === "sales") },
    ].filter((group) => group.people.length > 0);
  }, [people, search]);

  if (handedTo) return <Notice tone="success">Handed over to {handedTo}. It is now in their task list.</Notice>;
  if (!people.length) return null;

  const chosen = people.find((person) => person.id === target);
  const close = () => { if (!busy) { setOpen(false); setError(null); } };
  const confirm = async () => {
    if (!chosen || !reason.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await handOverFmsStep(instanceStageId, chosen.id, reason.trim());
      setOpen(false);
      setHandedTo(chosen.employee_name);
      await onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The task could not be handed over. Try again.");
    } finally { setBusy(false); }
  };

  return <>
    <Button className="min-h-12" onClick={() => { setOpen(true); setTarget(""); setReason(""); setSearch(""); }} variant="secondary">
      <ArrowRightLeft aria-hidden="true" className="size-4" />Hand over
    </Button>
    {open ? <Modal mobileFullscreen onClose={close} title="Hand over this task">
      <div className="space-y-4">
        <p className="text-sm text-soft-grey">Choose who should do this task instead. It moves to their task list straight away.</p>
        {people.length > 8 ? <Field label="Find a person"><input className="field" onChange={(event) => setSearch(event.target.value)} placeholder="Type a name" value={search} /></Field> : null}
        {groups.length ? groups.map((group) => <fieldset className="space-y-2" key={group.key}>
          <legend className="label">{group.title}</legend>
          {group.people.map((person) => <button aria-pressed={target === person.id} className={cn("flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm",
            target === person.id ? "border-gold bg-gold/10 font-semibold text-champagne" : "border-gold/20 text-soft-grey hover:border-gold/50")} key={person.id} onClick={() => setTarget(person.id)} type="button">
            <span className="min-w-0 break-words">{person.employee_name}</span>{target === person.id ? <Check aria-hidden="true" className="size-4 shrink-0 text-gold-secondary" /> : null}
          </button>)}
        </fieldset>) : <p className="text-sm text-soft-grey">Nobody matches that name.</p>}
        <fieldset className="space-y-2">
          <legend className="label">Why? *</legend>
          <div className="flex flex-wrap gap-2">{FMS_HANDOVER_REASONS.map((item) => <button aria-pressed={reason === item} className={cn("min-h-11 rounded-full border px-3 py-1.5 text-sm",
            reason === item ? "border-gold bg-gold/10 font-semibold text-champagne" : "border-gold/20 text-soft-grey hover:border-gold/50")} key={item} onClick={() => setReason(item)} type="button">{item}</button>)}</div>
          <textarea aria-label="Reason" className="field" maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Or write your own reason" value={reason} />
        </fieldset>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="min-h-12" disabled={busy || !chosen || !reason.trim()} onClick={() => void confirm()}>{busy ? "Handing over..." : chosen ? `Hand over to ${chosen.employee_name}` : "Choose a person"}</Button>
          <Button className="min-h-12" disabled={busy} onClick={close} variant="ghost">Cancel</Button>
        </div>
      </div>
    </Modal> : null}
  </>;
}
