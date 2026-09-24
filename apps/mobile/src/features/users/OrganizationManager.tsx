import { useState } from "react";
import { Alert, View } from "react-native";
import { loadOrganization, saveBranch, saveDepartment, type OrganizationBranch, type OrganizationDepartment } from "@jewelos/data/users/organization";
import { errorText } from "@/lib/log";
import { useAsyncData } from "@/lib/useAsyncData";
import { Button } from "@/ui/Button";
import { Card, CardRow } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { Sheet } from "@/ui/Sheet";
import { Banner, LoadingState } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

type Editor = Readonly<{ kind: "branch" | "department"; id: string | null }>;

export function OrganizationManager({ onClose, onChanged }: { onClose: () => void; onChanged: () => Promise<void> }) {
  const state = useAsyncData(loadOrganization, []);
  const [kind, setKind] = useState<"branch" | "department">("department");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [branchId, setBranchId] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [region, setRegion] = useState("");
  const [pincode, setPincode] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = state.data;
  const open = (nextKind: Editor["kind"], unit?: OrganizationBranch | OrganizationDepartment) => {
    setEditor({ kind: nextKind, id: unit?.id ?? null });
    setName(unit?.name ?? ""); setCode(unit?.code ?? ""); setActive(unit?.is_active ?? true);
    setBranchId(unit && "branch_id" in unit ? unit.branch_id ?? "" : "");
    setLeaderId(unit && "manager_id" in unit ? unit.manager_id ?? "" : unit && "head_id" in unit ? unit.head_id ?? "" : "");
    setAddress(unit && "address" in unit ? unit.address ?? "" : "");
    setCity(unit && "city" in unit ? unit.city ?? "" : "");
    setRegion(unit && "state" in unit ? unit.state ?? "" : "");
    setPincode(unit && "pincode" in unit ? unit.pincode ?? "" : "");
    setError(null);
  };
  const submit = async () => {
    if (!editor) return;
    if (!name.trim() || !/^[A-Za-z0-9_-]{2,32}$/.test(code.trim())) return setError("Enter a name and a code of 2–32 letters, numbers, underscores, or hyphens.");
    setBusy(true); setError(null);
    try {
      if (editor.kind === "branch") await saveBranch(editor.id, { name: name.trim(), code: code.trim(), address, city, state: region, pincode, manager_id: leaderId || null, is_active: active });
      else await saveDepartment(editor.id, { name: name.trim(), code: code.trim(), ...(editor.id ? {} : { branch_id: branchId || null }), head_id: leaderId || null, is_active: active });
      await Promise.all([state.refresh(), onChanged()]);
      setEditor(null);
    } catch (caught) { setError(errorText(caught)); }
    finally { setBusy(false); }
  };
  const save = () => {
    if (!active && editor?.id) Alert.alert("Deactivate unit?", "New assignments will no longer use it. Units with employees cannot be deactivated.", [{ text: "Cancel", style: "cancel" }, { text: "Deactivate", style: "destructive", onPress: () => void submit() }]);
    else void submit();
  };
  const units: readonly (OrganizationBranch | OrganizationDepartment)[] = kind === "branch" ? data?.branches ?? [] : data?.departments ?? [];
  const leaders = data?.people.filter((person) => person.account_status === "active" && (editor?.kind === "branch" ? person.branch_id === editor.id : person.department_id === editor?.id)) ?? [];
  return <Sheet onClose={onClose} title="Organization" visible tall>
    <View style={{ gap: 12, paddingBottom: 20 }}>
      {state.loading ? <LoadingState label="Loading organization..." /> : null}
      {state.error ? <Banner tone="danger">{state.error}</Banner> : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}
      {editor ? <>
        <Text variant="heading" weight="semibold">{editor.id ? "Edit" : "Add"} {editor.kind}</Text>
        <TextField label="Name" onChangeText={setName} value={name} />
        <TextField label="Code" onChangeText={setCode} value={code} />
        {editor.kind === "department" ? <>
          <OptionPicker label="Branch scope" onChange={(values) => setBranchId(values[0] ?? "")} options={[{ value: "", label: "Shared across branches" }, ...(data?.branches.filter((branch) => branch.is_active).map((branch) => ({ value: branch.id, label: branch.name })) ?? [])]} selected={[branchId]} disabled={!!editor.id} />
          {editor.id ? <Text tone="muted" variant="small">Add a department and move its people to change scope.</Text> : null}
        </> : <><TextField label="Address" onChangeText={setAddress} value={address} /><TextField label="City" onChangeText={setCity} value={city} /><TextField label="State" onChangeText={setRegion} value={region} /><TextField label="Pincode" onChangeText={setPincode} value={pincode} /></>}
        {editor.id ? <OptionPicker label={editor.kind === "branch" ? "Branch manager" : "Department head"} onChange={(values) => setLeaderId(values[0] ?? "")} options={[{ value: "", label: "None" }, ...leaders.map((person) => ({ value: person.id, label: person.employee_name }))]} selected={[leaderId]} /> : null}
        <OptionPicker label="Status" onChange={(values) => setActive(values[0] !== "inactive")} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} selected={[active ? "active" : "inactive"]} />
        <Button busy={busy} label="Save" onPress={save} />
        <Button label="Back to organization" onPress={() => setEditor(null)} variant="ghost" />
      </> : <>
        <Text tone="muted" variant="small">Manage branches and departments here. Move people and change roles in each employee's profile.</Text>
        <OptionPicker label="View" onChange={(values) => setKind(values[0] === "branch" ? "branch" : "department")} options={[{ value: "department", label: "Departments" }, { value: "branch", label: "Branches" }]} selected={[kind]} />
        {units.map((unit) => {
          const count = data?.people.filter((person) => person.account_status !== "left" && (kind === "branch" ? person.branch_id === unit.id : person.department_id === unit.id)).length ?? 0;
          const scope = "branch_id" in unit ? (unit.branch_id ? data?.branches.find((branch) => branch.id === unit.branch_id)?.name ?? "Unknown branch" : "Shared across branches") : null;
          return <Card key={unit.id}><CardRow label="Name" value={unit.name} /><CardRow label="Code" value={unit.code} />{scope ? <CardRow label="Scope" value={scope} /> : null}<CardRow label="People" value={String(count)} /><CardRow label="Status" value={unit.is_active ? "Active" : "Inactive"} /><Button label={`Edit ${unit.name}`} onPress={() => open(kind, unit)} variant="secondary" /></Card>;
        })}
        <Button label={`Add ${kind}`} onPress={() => open(kind)} />
        <Button label="Close" onPress={onClose} variant="ghost" />
      </>}
    </View>
  </Sheet>;
}
