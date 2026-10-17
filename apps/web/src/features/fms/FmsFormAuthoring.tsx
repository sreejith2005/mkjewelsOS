import { useEffect, useState } from "react";
import { loadFmsFormAuthoring, type FmsFormAuthoringTarget, type FmsFormAuthoringAction } from "@jewelos/data/fms/formAuthoring";
import { Button, Notice } from "@/components/ui";
import { FormBuilder } from "@/features/forms/FormBuilder";
import { FormRenderer } from "@/features/forms/FormRenderer";

export function FmsFormActions({ linked, canManage, disabled, onOpen }: { linked: boolean; canManage: boolean; disabled: boolean; onOpen: (action: FmsFormAuthoringAction) => void }) {
  return <section className="space-y-2 border-b border-gold/15 pb-3"><p className="text-xs text-soft-grey">The workflow draft is saved before opening Forms. Returning keeps this step and its pinned version.</p><div className="flex flex-wrap gap-2">
    {canManage ? <Button disabled={disabled} variant="secondary" onClick={() => onOpen("create")}>Create New Form</Button> : null}
    <Button disabled={disabled || !linked} variant="secondary" onClick={() => onOpen("preview")}>Preview Form</Button>
    {canManage ? <Button disabled={disabled || !linked} variant="secondary" onClick={() => onOpen("edit")}>Open Form Builder</Button> : null}
    <Button disabled={disabled || !linked} variant="ghost" onClick={() => onOpen("published")}>View Published Version</Button>
  </div></section>;
}

export function FmsFormAuthoring({ target, onClose, onSaved }: { target: FmsFormAuthoringTarget; onClose: () => void; onSaved: () => Promise<void> }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof loadFmsFormAuthoring>>>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; void loadFmsFormAuthoring(target).then(value => { if (active) setData(value); }).catch((error: unknown) => { if (active) setError(error instanceof Error ? error.message : "Could not open Forms"); }); return () => { active = false; }; }, [target]);
  if (error) return <div className="space-y-3"><Notice tone="danger">{error}</Notice><Button onClick={onClose}>Return to workflow step</Button></div>;
  if (!data) return <Notice>Loading linked Form…</Notice>;
  const close = () => { onClose(); void onSaved(); };
  if (target.action === "create" || target.action === "edit") return <FormBuilder bundle={data.bundle} dynamicOptions={data.dynamicOptions} onClose={close} onSaved={onSaved} />;
  if (!data.bundle) return <Notice>Form unavailable.</Notice>;
  return <section className="mx-auto max-w-3xl space-y-4"><Button onClick={close}>Return to workflow step</Button><Notice>{data.bundle.name} · v{data.bundle.version}. The workflow still uses its selected version.</Notice><FormRenderer definition={{ name: data.bundle.name, description: data.bundle.description ?? undefined, sections: data.bundle.sections, fields: data.bundle.fields }} dynamicOptions={data.dynamicOptions} preview /></section>;
}
