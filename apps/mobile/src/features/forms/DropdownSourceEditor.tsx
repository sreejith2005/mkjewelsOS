import { useState } from "react";
import { dropdownMasterKey, type FormFieldDefinition } from "@jewelos/core";
import { createMasterList } from "@jewelos/data/dropdowns/api";
import { Button } from "@/ui/Button";
import { Banner } from "@/ui/states";
import { TextField } from "@/ui/TextField";

export function DropdownSourceEditor({ field, onPatch, onMasterCreated }: {
  field: FormFieldDefinition;
  onPatch: (patch: Partial<FormFieldDefinition>) => void;
  onMasterCreated: () => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const publish = async () => {
    const key = dropdownMasterKey(name);
    if (!key || !field.options?.length) { setError("Give the list a name and add at least one option first."); return; }
    setBusy(true); setError(null);
    try {
      const masterType = await createMasterList(key, field.options);
      // Keep the durable reference even if refreshing the available lists fails.
      onPatch({ optionSource: { kind: "master", masterType }, options: undefined });
      await onMasterCreated();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to add this list to Dropdown Master."); }
    finally { setBusy(false); }
  };
  return <>
    {!field.optionSource ? <>
      <TextField label="Dropdown Master list name" onChangeText={setName} value={name} />
      <Button busy={busy} disabled={!field.options?.length} label="Add to Dropdown Master" onPress={() => void publish()} variant="secondary" />
    </> : null}
    {error ? <Banner tone="danger">{error}</Banner> : null}
  </>;
}
