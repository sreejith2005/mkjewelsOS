import { useState } from "react";
import { ArrowLeft, ClipboardPenLine, UserRoundPlus, UsersRound } from "lucide-react";
import { Button } from "@/components/ui";
import { WalkinForm } from "./WalkinForm";
import type { CrmOptions } from "./types";

type RegistrationKind = "new" | "returning" | null;

export function WalkinWorkspace({ options, onCompleted }: {
  options: CrmOptions;
  onCompleted: (clientId: string, summary: string) => Promise<void> | void;
}) {
  const [kind, setKind] = useState<RegistrationKind>(null);

  if (kind) {
    return <section className="space-y-5" aria-labelledby="walk-in-form-title">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-task-border bg-task-bg p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-task-accent">Front desk</p>
          <h2 className="mt-1 text-2xl font-bold text-task-text" id="walk-in-form-title">
            {kind === "new" ? "New walk-in registration" : "Returning client walk-in"}
          </h2>
          <p className="mt-1 text-sm text-task-text-muted">Phone lookup protects the existing client record before this visit is saved.</p>
        </div>
        <Button onClick={() => setKind(null)} variant="secondary"><ArrowLeft className="size-4"/>Registration type</Button>
      </div>
      <div className="rounded-2xl border border-task-border bg-task-bg p-5 sm:p-6">
        <WalkinForm onCancel={() => setKind(null)} onSaved={onCompleted} options={options}/>
      </div>
    </section>;
  }

  return <section className="space-y-5" aria-labelledby="walk-in-workspace-title">
    <header className="rounded-2xl border border-task-border bg-task-bg p-5 sm:p-6">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-task-accent">MK Jewels CRM · Front desk</p>
      <h2 className="mt-1 text-2xl font-bold text-task-text" id="walk-in-workspace-title">CLIENT WALK-IN FORM</h2>
      <p className="mt-2 max-w-2xl text-sm text-task-text-muted">Register a client visit inside JewelOS. The client search, visit history, follow-up, and access controls all stay in this app.</p>
    </header>
    <div className="grid gap-4 lg:grid-cols-2">
      <button className="rounded-2xl border-2 border-task-accent bg-task-bg p-6 text-left transition hover:bg-task-muted focus-visible:ring-2 focus-visible:ring-task-accent" onClick={() => setKind("new")} type="button">
        <UserRoundPlus className="size-7 text-task-accent"/>
        <span className="mt-4 block text-lg font-bold text-task-text">NEW WALK-IN</span>
        <span className="mt-2 block text-sm text-task-text-muted">Register a first-time visitor, capture their visit details, and create a protected client record when needed.</span>
      </button>
      <button className="rounded-2xl border border-task-border bg-task-bg p-6 text-left transition hover:bg-task-muted focus-visible:ring-2 focus-visible:ring-task-accent" onClick={() => setKind("returning")} type="button">
        <UsersRound className="size-7 text-task-accent"/>
        <span className="mt-4 block text-lg font-bold text-task-text">RETURNING CLIENT</span>
        <span className="mt-2 block text-sm text-task-text-muted">Look up the visitor by phone, keep their history intact, and add this visit to the same client record.</span>
      </button>
    </div>
    <div className="flex items-center gap-3 rounded-xl border border-task-border bg-task-muted/40 p-4 text-sm text-task-text-muted">
      <ClipboardPenLine className="size-5 shrink-0 text-task-accent"/>
      No separate CRM site or second sign-in is used. This is the JewelOS CRM workspace.
    </div>
  </section>;
}
