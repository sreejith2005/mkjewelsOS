import { useState } from "react";
import { nextOptionValue, type FormOption } from "@jewelos/core";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { Banner } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

/** Renaming and moving choices retain their persisted answer/route identity. */
export function OptionListEditor({ options, onChange }: {
  options: readonly FormOption[]; onChange: (options: readonly FormOption[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  const accept = (raw: string, value?: string) => {
    const name = raw.trim();
    if (!name) { setError("An option needs a label."); return; }
    if (options.some((option) => option.value !== value && option.label.toLowerCase() === name.toLowerCase())) {
      setError(`"${name}" is already an option.`); return;
    }
    onChange(value ? options.map((option) => option.value === value ? { ...option, label: name } : option)
      : [...options, { value: nextOptionValue(name, options.map((option) => option.value)), label: name }]);
    setError(null); setDraft(""); setEditing(null);
  };
  const move = (index: number, direction: number) => {
    const target = index + direction;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };
  return <>
    {options.map((option, index) => <Card key={option.value}>
      {editing === option.value ? <>
        <TextField label={`Rename ${option.label}`} onChangeText={setLabel} value={label} />
        <Button label="Save option" onPress={() => accept(label, option.value)} />
        <Button label="Cancel rename" onPress={() => setEditing(null)} variant="ghost" />
      </> : <>
        <Text>{option.label}</Text>
        <Button label={`Rename ${option.label}`} onPress={() => { setEditing(option.value); setLabel(option.label); }} variant="secondary" />
        <Button disabled={index === 0} label={`Move ${option.label} up`} onPress={() => move(index, -1)} variant="ghost" />
        <Button disabled={index === options.length - 1} label={`Move ${option.label} down`} onPress={() => move(index, 1)} variant="ghost" />
        <Button label={`Remove ${option.label}`} onPress={() => onChange(options.filter((item) => item.value !== option.value))} variant="danger" />
      </>}
    </Card>)}
    <TextField label="New choice" onChangeText={setDraft} value={draft} />
    <Button label="Add choice" onPress={() => accept(draft)} variant="secondary" />
    {error ? <Banner tone="danger">{error}</Banner> : null}
  </>;
}
