import { useState } from "react";
import { Search } from "lucide-react";
import type { TaskUser } from "./api";

export function UserPicker({ disabledIds, label, onChange, selectedIds, users }: {
  disabledIds: readonly string[];
  label: string;
  onChange: (ids: string[]) => void;
  selectedIds: readonly string[];
  users: readonly TaskUser[];
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLowerCase();
  const filteredUsers = users.filter((user) => !query || `${user.employee_name ?? ""} ${user.employee_code ?? ""}`.toLowerCase().includes(query));
  return (
    <fieldset className="rounded-xl border border-task-border bg-task-muted p-3">
      <legend className="px-1 text-xs font-semibold text-task-text">{label}</legend>
      <label className="relative mb-2 block">
        <Search className="pointer-events-none absolute left-3 top-3 size-4 text-task-text-muted" />
        <input
          aria-label={`Search ${label.toLowerCase()}`}
          className="task-field pl-9"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search people"
          value={search}
        />
      </label>
      <div className="flex max-h-52 flex-col gap-1 overflow-y-auto">
        {filteredUsers.map((user) => user.id ? (
          <label className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm text-task-text hover:bg-task-bg has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-task-accent" key={user.id}>
            <input
              checked={selectedIds.includes(user.id)}
              className="size-4 accent-task-accent"
              disabled={disabledIds.includes(user.id)}
              onChange={(event) => onChange(event.target.checked ? [...selectedIds, user.id as string] : selectedIds.filter((id) => id !== user.id))}
              type="checkbox"
            />
            <span className="min-w-0 flex-1 truncate">{user.employee_name}</span>
            <span className="text-xs capitalize text-task-text-muted">{user.user_role?.replace("_", " ")}</span>
          </label>
        ) : null)}
      </div>
    </fieldset>
  );
}
