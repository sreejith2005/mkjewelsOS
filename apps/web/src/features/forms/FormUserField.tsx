import { useEffect, useRef, useState } from "react";
import { formUserMatchesFilter, type FormFieldDefinition } from "@jewelos/core";
import { Button, Notice } from "@/components/ui";
import { CrossLocationEmployeePicker } from "@/features/users/CrossLocationEmployeePicker";
import { loadFormUserOptions } from "./api";
import type { DynamicOptions } from "./FormRenderer";

type Person = DynamicOptions["users"][number];
type Props = {
  field: FormFieldDefinition; templateId?: string | undefined; options: readonly Person[];
  departmentNames?: ReadonlyMap<string, string>; disabled: boolean; preview: boolean;
  labelledBy: string; describedBy?: string | undefined; value: string;
  onChange: (id: string) => void; registerRef: (node: HTMLElement | null) => void;
  onPick?: ((person: { id: string; label: string }) => void) | undefined;
};

/** The saved filter is the starting list; broader choices use the same submission contract. */
export function FormUserField({ field, templateId, options, departmentNames, disabled, preview, labelledBy, describedBy, value, onChange, registerRef, onPick }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [otherStore, setOtherStore] = useState(false);
  const [people, setPeople] = useState<readonly Person[]>([]);
  const [known, setKnown] = useState<ReadonlyMap<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const selection = useRef({ value, onPick });
  selection.current = { value, onPick };
  const remote = Boolean(templateId && !preview);
  useEffect(() => {
    if (!templateId || !remote) return;
    let live = true;
    setLoading(true); setError(null); setPeople([]);
    loadFormUserOptions(templateId, field.key, expanded, selection.current.value || undefined).then((rows) => {
      if (!live) return;
      setPeople(rows);
      setKnown((current) => new Map([...current, ...rows.map((person) => [person.id, person.label] as const)]));
      const selected = rows.find((person) => person.id === selection.current.value);
      if (selected) selection.current.onPick?.(selected);
    }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : "Unable to load form users."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [expanded, field.key, remote, retry, templateId]);
  const listed = remote ? people : options.filter((person) => expanded || formUserMatchesFilter(field.validation?.userFilter, person, departmentNames));
  const sorted = [...listed].sort((a, b) => a.label.localeCompare(b.label, "en", { sensitivity: "base" }));
  const selectedName = known.get(value) ?? options.find((person) => person.id === value)?.label ?? "Employee selected";
  return <div className="space-y-2">
    <select aria-describedby={describedBy} aria-labelledby={labelledBy} aria-busy={loading} className="field" disabled={disabled || loading} onChange={(event) => {
      onChange(event.target.value);
      const person = listed.find((row) => row.id === event.target.value);
      if (person) onPick?.(person);
    }} ref={registerRef} value={value}>
      <option value="">{loading ? "Loading people..." : "Choose an answer"}</option>
      {value && !sorted.some((person) => person.id === value) ? <option value={value}>{selectedName}</option> : null}
      {sorted.map((person) => <option key={person.id} value={person.id}>{person.label}</option>)}
    </select>
    {error ? <Notice tone="danger">{error} <Button onClick={() => setRetry((current) => current + 1)} type="button" variant="secondary">Retry</Button></Notice> : null}
    {!disabled && !loading && !error && !sorted.length ? <p className="text-sm text-task-text-muted" role="status">{options.length === 0 && !remote ? "The people list did not load. Close this form and open it again." : "No one you can see matches the configured people. Choose someone outside the department or at another store."}</p> : null}
    {!disabled ? <>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button aria-pressed={expanded} className="min-h-11 min-w-0" onClick={() => setExpanded((current) => !current)} type="button" variant="secondary">{expanded ? "Configured people" : "Someone outside my department"}</Button>
        <Button aria-expanded={otherStore} className="min-h-11 min-w-0" onClick={() => setOtherStore((current) => !current)} type="button" variant="secondary">Someone at another store</Button>
      </div>
      {otherStore ? <CrossLocationEmployeePicker context={templateId && !preview ? { kind: "form", formTemplateId: templateId, fieldKey: field.key } : null} describedBy={describedBy} disabled={disabled} knownNames={[...options, ...[...known].map(([id, label]) => ({ id, label }))]} labelledBy={labelledBy} onChange={(id) => { if (id) onChange(id); }} onPick={(person) => {
        setKnown((current) => new Map(current).set(person.id, person.name));
        onPick?.({ id: person.id, label: person.name });
        setOtherStore(false);
      }} value="" /> : null}
    </> : null}
  </div>;
}
