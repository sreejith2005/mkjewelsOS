import { useState, type FormEvent } from "react";
import { saveBranch, saveDepartment, type OrganizationBranch, type OrganizationData, type OrganizationDepartment } from "@jewelos/data/users/organization";
import { Button, Field, Modal, Notice } from "@/components/ui";

type Editor = { kind: "branch" | "department"; id: string | null };

function UnitEditor({ editor, data, onClose, onSaved }: { editor: Editor; data: OrganizationData; onClose: () => void; onSaved: () => Promise<void> }) {
  const branch = editor.kind === "branch" ? data.branches.find((item) => item.id === editor.id) : undefined;
  const department = editor.kind === "department" ? data.departments.find((item) => item.id === editor.id) : undefined;
  const unit = branch ?? department;
  const [name, setName] = useState(unit?.name ?? "");
  const [code, setCode] = useState(unit?.code ?? "");
  const [branchId, setBranchId] = useState(department?.branch_id ?? "");
  const [leaderId, setLeaderId] = useState(branch?.manager_id ?? department?.head_id ?? "");
  const [address, setAddress] = useState(branch?.address ?? "");
  const [city, setCity] = useState(branch?.city ?? "");
  const [region, setRegion] = useState(branch?.state ?? "");
  const [pincode, setPincode] = useState(branch?.pincode ?? "");
  const [active, setActive] = useState(unit?.is_active ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaders = data.people.filter((person) => person.account_status === "active" && (editor.kind === "branch" ? person.branch_id === editor.id : person.department_id === editor.id));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || !/^[A-Za-z0-9_-]{2,32}$/.test(code.trim())) return setError("Enter a name and a code of 2–32 letters, numbers, underscores, or hyphens.");
    if (!active && unit && !window.confirm(`Deactivate ${unit.name}? New assignments will no longer use it.`)) return;
    setSaving(true); setError(null);
    try {
      if (editor.kind === "branch") await saveBranch(editor.id, { name: name.trim(), code: code.trim(), address, city, state: region, pincode, manager_id: leaderId || null, is_active: active });
      else await saveDepartment(editor.id, { name: name.trim(), code: code.trim(), ...(editor.id ? {} : { branch_id: branchId || null }), head_id: leaderId || null, is_active: active });
      await onSaved();
      onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to save organization unit."); }
    finally { setSaving(false); }
  };
  return <Modal onClose={onClose} title={`${editor.id ? "Edit" : "Add"} ${editor.kind}`}>
    <form className="space-y-4" onSubmit={(event) => void submit(event)}>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Name"><input className="field" maxLength={120} onChange={(event) => setName(event.target.value)} required value={name} /></Field><Field label="Code"><input className="field" maxLength={32} onChange={(event) => setCode(event.target.value)} required value={code} /></Field></div>
      {editor.kind === "department" ? <Field label="Branch scope"><select className="field" disabled={!!editor.id} onChange={(event) => setBranchId(event.target.value)} value={branchId}><option value="">Shared across branches</option>{data.branches.filter((item) => item.is_active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>{editor.id ? <span className="text-xs text-soft-grey">To change scope, add a department and move its people using Edit user.</span> : null}</Field> : <div className="grid gap-3 sm:grid-cols-2"><Field label="Address"><input className="field" onChange={(event) => setAddress(event.target.value)} value={address} /></Field><Field label="City"><input className="field" onChange={(event) => setCity(event.target.value)} value={city} /></Field><Field label="State"><input className="field" onChange={(event) => setRegion(event.target.value)} value={region} /></Field><Field label="Pincode"><input className="field" onChange={(event) => setPincode(event.target.value)} value={pincode} /></Field></div>}
      {editor.id ? <Field label={editor.kind === "branch" ? "Branch manager" : "Department head"}><select className="field" onChange={(event) => setLeaderId(event.target.value)} value={leaderId}><option value="">None</option>{leaders.map((person) => <option key={person.id} value={person.id}>{person.employee_name}</option>)}</select></Field> : null}
      <label className="flex items-center gap-2 text-sm text-champagne"><input checked={active} className="accent-gold" onChange={(event) => setActive(event.target.checked)} type="checkbox" />Active</label>
      <div className="flex justify-end gap-2"><Button onClick={onClose} type="button" variant="secondary">Cancel</Button><Button disabled={saving} type="submit">{saving ? "Saving…" : "Save"}</Button></div>
    </form>
  </Modal>;
}

export function OrganizationManager({ data, onChanged }: { data: OrganizationData; onChanged: () => Promise<void> }) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [kind, setKind] = useState<"branch" | "department">("department");
  const units: readonly (OrganizationBranch | OrganizationDepartment)[] = kind === "branch" ? data.branches : data.departments;
  return <section className="glass-card mb-4 rounded-xl p-4" aria-label="Manage organization">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold text-champagne">Organization</h2><p className="text-xs text-soft-grey">Manage branches and departments. Move people with Edit user.</p></div><div className="flex gap-2"><Button onClick={() => setKind("branch")} type="button" variant={kind === "branch" ? "primary" : "secondary"}>Branches</Button><Button onClick={() => setKind("department")} type="button" variant={kind === "department" ? "primary" : "secondary"}>Departments</Button></div></div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{units.map((unit) => {
      const scope = "branch_id" in unit ? (unit.branch_id ? data.branches.find((branch) => branch.id === unit.branch_id)?.name ?? "Unknown branch" : "Shared across branches") : "Branch";
      const people = data.people.filter((person) => person.account_status !== "left" && (kind === "branch" ? person.branch_id === unit.id : person.department_id === unit.id)).length;
      return <article className="rounded-lg border border-gold/15 p-3" key={unit.id}><div className="flex justify-between gap-2"><div><p className="font-medium text-white">{unit.name}</p><p className="text-xs text-soft-grey">{unit.code} · {scope} · {people} people · {unit.is_active ? "Active" : "Inactive"}</p></div><Button aria-label={`Edit ${unit.name}`} className="h-9 min-h-9 px-2" onClick={() => setEditor({ kind, id: unit.id })} type="button" variant="ghost">Edit</Button></div></article>;
    })}</div>
    <Button className="mt-4" onClick={() => setEditor({ kind, id: null })} type="button">Add {kind}</Button>
    {editor ? <UnitEditor data={data} editor={editor} key={`${editor.kind}:${editor.id ?? "new"}`} onClose={() => setEditor(null)} onSaved={onChanged} /> : null}
  </section>;
}
