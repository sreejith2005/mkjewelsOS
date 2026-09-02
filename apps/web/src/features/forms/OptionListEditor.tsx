import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, ChevronUp, Pencil, Trash2, X } from "lucide-react";
import { nextOptionValue, type FormOption } from "@jewelos/core";
import { Button, Notice } from "@/components/ui";

/**
 * One option at a time: type, press Enter, the option is committed and a fresh
 * input takes focus. Committed options keep the stable `value` they were given,
 * so renaming a label never breaks a branch or a saved answer.
 */
export function OptionListEditor({ options, onChange }: { options: readonly FormOption[]; onChange: (options: readonly FormOption[]) => void }) {
  const [draft, setDraft] = useState("");
  const [editingValue, setEditingValue] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState("");
  const [warning, setWarning] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (editingValue) editRef.current?.focus(); }, [editingValue]);

  const commit = () => {
    const label = draft.trim();
    if (!label) { setWarning(null); return; }
    if (options.some((option) => option.label.toLowerCase() === label.toLowerCase())) {
      setWarning(`"${label}" is already an option.`);
      return;
    }
    onChange([...options, { value: nextOptionValue(label, options.map((option) => option.value)), label }]);
    setDraft(""); setWarning(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commit();
  };
  const rename = (value: string) => {
    const label = editingLabel.trim();
    if (!label) { setWarning("An option needs a label."); return; }
    if (options.some((option) => option.value !== value && option.label.toLowerCase() === label.toLowerCase())) {
      setWarning(`"${label}" is already an option.`);
      return;
    }
    onChange(options.map((option) => option.value === value ? { ...option, label } : option));
    setEditingValue(null); setWarning(null);
  };
  const move = (index: number, direction: number) => {
    const target = index + direction;
    if (target < 0 || target >= options.length) return;
    const next = [...options];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onChange(next);
  };

  return <div className="space-y-2">
    {options.length ? <ul className="space-y-1">{options.map((option, index) => <li className="flex items-center gap-2 rounded-lg border border-gold/15 bg-obsidian px-2 py-1.5" key={option.value}>
      <div className="flex flex-col">
        <button aria-label={`Move ${option.label} up`} className="text-soft-grey hover:text-gold disabled:opacity-30" disabled={index === 0} onClick={() => move(index, -1)} type="button"><ChevronUp className="size-3.5" /></button>
        <button aria-label={`Move ${option.label} down`} className="text-soft-grey hover:text-gold disabled:opacity-30" disabled={index === options.length - 1} onClick={() => move(index, 1)} type="button"><ChevronDown className="size-3.5" /></button>
      </div>
      <Check className="size-4 shrink-0 text-success" />
      {editingValue === option.value
        ? <><input aria-label={`Rename ${option.label}`} className="field h-9 flex-1" onChange={(event) => setEditingLabel(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); rename(option.value); } if (event.key === "Escape") setEditingValue(null); }} ref={editRef} value={editingLabel} />
          <Button aria-label="Save option" className="size-11 min-h-11 p-0" onClick={() => rename(option.value)} type="button" variant="secondary"><Check className="size-4" /></Button>
          <Button aria-label="Cancel rename" className="size-11 min-h-11 p-0" onClick={() => setEditingValue(null)} type="button" variant="ghost"><X className="size-4" /></Button></>
        : <><span className="min-w-0 flex-1 truncate text-sm text-champagne">{option.label}</span>
          <span className="hidden font-mono text-[10px] text-soft-grey sm:inline">{option.value}</span>
          <Button aria-label={`Edit ${option.label}`} className="size-11 min-h-11 p-0" onClick={() => { setEditingValue(option.value); setEditingLabel(option.label); }} type="button" variant="ghost"><Pencil className="size-4" /></Button>
          <Button aria-label={`Delete ${option.label}`} className="size-11 min-h-11 p-0" onClick={() => onChange(options.filter((item) => item.value !== option.value))} type="button" variant="danger"><Trash2 className="size-4" /></Button></>}
    </li>)}</ul> : null}
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-soft-grey">Option {options.length + 1}</span>
      <input aria-label={`Option ${options.length + 1}`} className="field h-10 flex-1" onBlur={commit} onChange={(event) => { setDraft(event.target.value); setWarning(null); }} onKeyDown={onKeyDown} placeholder="Enter option and press Enter" ref={inputRef} value={draft} />
    </div>
    {warning ? <Notice tone="danger">{warning}</Notice> : null}
  </div>;
}
