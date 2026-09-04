import { Panel } from "@/features/analytics/components";
import type { EmployeeProgress, EmployeeProgressRow } from "@/features/analytics/types";
import { ProgressTable } from "./panels";
import { needsAttention } from "./filters";

/**
 * Everyone in scope, worst-first: the people who are behind in ranked order,
 * then everyone who is clear. Selecting a row filters the whole workspace to
 * that person.
 */
export function PeopleTab({ progress, onSelectUser }: { progress: EmployeeProgress; onSelectUser: (row: EmployeeProgressRow) => void }) {
  const behind = needsAttention(progress.employees);
  const behindIds = new Set(behind.map((row) => row.user_profile_id));
  const clear = progress.employees
    .filter((row) => !behindIds.has(row.user_profile_id))
    .sort((left, right) => left.employee_name.localeCompare(right.employee_name));
  const ordered = [...behind, ...clear];

  return (
    <Panel
      description={`${progress.employees.length} employee${progress.employees.length === 1 ? "" : "s"} in scope, ${behind.length} still owing work. One row is one person; a task shared by two people counts for both.`}
      title="Employee task progress"
    >
      <ProgressTable
        columns={["Employee", "Branch", "Department"]}
        empty="No employee task data in this range."
        head={(row) => (
          <>
            <td className="whitespace-nowrap px-2 py-2 font-medium text-task-text">{row.employee_name}</td>
            <td className="whitespace-nowrap px-2 py-2 text-task-text-muted">{row.branch_name}</td>
            <td className="whitespace-nowrap px-2 py-2 text-task-text-muted">{row.department_name ?? "—"}</td>
          </>
        )}
        onSelect={onSelectUser}
        rows={ordered}
      />
    </Panel>
  );
}
