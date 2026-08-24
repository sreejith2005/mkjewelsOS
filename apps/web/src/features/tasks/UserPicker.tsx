import { AssigneePicker } from "@/components/assignees/AssigneePicker";
import type { TaskUser } from "./api";

export function UserPicker({ branchNames, departmentNames, disabledIds, label, onChange, selectedIds, users }: {
  branchNames: ReadonlyMap<string, string>;
  departmentNames: ReadonlyMap<string, string>;
  disabledIds: readonly string[];
  label: string;
  onChange: (ids: string[]) => void;
  selectedIds: readonly string[];
  users: readonly TaskUser[];
}) {
  return <AssigneePicker branchNames={branchNames} departmentNames={departmentNames} disabledIds={disabledIds} label={label} multiple onChange={onChange} people={users.flatMap((user) => user.id ? [{ ...user, id: user.id }] : [])} selectedIds={selectedIds}/>;
}
