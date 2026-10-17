import { useState } from "react";
import { loadFmsFormAuthoring, type FmsFormAuthoringAction, type FmsFormAuthoringTarget } from "@jewelos/data/fms/formAuthoring";
import { useAsyncData } from "@/lib/useAsyncData";
import { FormBuilderWorkspace } from "@/screens/FormBuilderScreen";
import { FormRenderer } from "@/forms/FormRenderer";
import { Button } from "@/ui/Button";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";
import { Banner, ErrorState, LoadingState } from "@/ui/states";

export function FmsFormActions({ linked, canManage, disabled, onOpen }: { linked: boolean; canManage: boolean; disabled: boolean; onOpen: (action: FmsFormAuthoringAction) => void }) {
  return <>
    <Text tone="muted">The workflow draft is saved before opening Forms. Returning keeps this step and its pinned version.</Text>
    {canManage ? <Button disabled={disabled} label="Create New Form" variant="secondary" onPress={() => onOpen("create")} /> : null}
    <Button disabled={disabled || !linked} label="Preview Form" variant="secondary" onPress={() => onOpen("preview")} />
    {canManage ? <Button disabled={disabled || !linked} label="Open Form Builder" variant="secondary" onPress={() => onOpen("edit")} /> : null}
    <Button disabled={disabled || !linked} label="View Published Version" variant="ghost" onPress={() => onOpen("published")} />
  </>;
}
export function FmsFormAuthoring({ target, onClose, onSaved }: { target: FmsFormAuthoringTarget; onClose: () => void; onSaved: () => Promise<void> }) {
  const state = useAsyncData(() => loadFmsFormAuthoring(target), [target]);
  const [previewDone, setPreviewDone] = useState(false);
  if (state.error) return <Screen><ErrorState message={state.error} onRetry={() => void state.reload()} /><Button label="Return to workflow step" onPress={onClose} /></Screen>;
  if (!state.data) return <Screen><LoadingState label="Loading linked Form…" /></Screen>;
  const { bundle, dynamicOptions } = state.data;
  if (target.action === "create" || target.action === "edit") return <FormBuilderWorkspace bundle={bundle} dynamicOptions={dynamicOptions} onClose={onClose} onRefresh={async () => { await state.refresh(); await onSaved(); }} />;
  if (!bundle) return <Screen><Banner>Form unavailable.</Banner><Button label="Return to workflow step" onPress={onClose} /></Screen>;
  return <Screen scroll><Button label="Return to workflow step" onPress={onClose} /><Text>{`${bundle.name} · v${bundle.version}`}</Text><Banner>Preview only. Nothing is saved, and the workflow keeps its selected version.</Banner><FormRenderer definition={{ name: bundle.name, description: bundle.description ?? undefined, sections: bundle.sections, fields: bundle.fields }} dynamicOptions={dynamicOptions} onSubmit={async () => { setPreviewDone(true); }} submitLabel="Complete preview" />{previewDone ? <Banner>Preview completed. Nothing was submitted.</Banner> : null}</Screen>;
}
