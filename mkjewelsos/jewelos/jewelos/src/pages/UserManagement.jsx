import { useState } from "react";
import { ChevronRight, Plus, Check } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { BRANCHES, DEPARTMENTS } from "../data/org.js";
import { ROLE_LABELS } from "../lib/roleConfig.jsx";
import { initials, fmtDateLong } from "../lib/utils.js";
import { Card, Chip, PageShell, Reveal, Sheet, FilterRow } from "../components/ui.jsx";

const STATUS_DOT = { active: "bg-emerald-500", on_leave: "bg-amber-500", resigned: "bg-slate-300" };

export default function UserManagement() {
  const { users, toast, branchOf } = useStore();
  const [status, setStatus] = useState("active");
  const [edit, setEdit] = useState(null);

  const list = users.filter((u) => status === "all" || u.working_status === status);

  return (
    <PageShell title="Team"
      subtitle={`${users.filter((u) => u.working_status === "active").length} active across ${BRANCHES.length} branches`}>
      <FilterRow value={status} onChange={setStatus}
        options={[["active", "Active"], ["on_leave", "On leave"], ["resigned", "Resigned"], ["all", "Everyone"]]} />

      <div className="space-y-2.5 mt-4">
        {list.map((u, i) => {
          const r = ROLE_LABELS[u.role_level];
          return (
            <Reveal key={u.id} delay={i * 35}>
              <Card onClick={() => setEdit(u)} className="p-4">
                <div className="flex items-center gap-3">
                  <span className="relative w-11 h-11 rounded-xl bg-slate-900 text-white text-xs font-semibold flex items-center justify-center shrink-0">
                    {initials(u.name)}
                    <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${STATUS_DOT[u.working_status]}`} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-slate-900 truncate">{u.name}</p>
                      <Chip className={r.chip}>{r.label}</Chip>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{u.designation} &middot; {branchOf(u.branch_id)?.code}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{u.employee_code} &middot; last seen {u.last_login.toLowerCase()}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
                </div>
              </Card>
            </Reveal>
          );
        })}

        <button onClick={() => toast("Invite goes out by email")}
          className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-200 text-slate-500 text-xs font-medium flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-amber-500">
          <Plus className="w-4 h-4" /> Invite someone
        </button>
      </div>

      <Sheet open={!!edit} title={edit?.name} onClose={() => setEdit(null)}>
        {edit && (
          <>
            <div className="space-y-3 mb-5">
              {[
                ["Designation", edit.designation],
                ["Branch", branchOf(edit.branch_id)?.name],
                ["Department", DEPARTMENTS.find((d) => d.id === edit.department_id)?.name],
                ["Reports to", users.find((u) => u.id === edit.reporting_to)?.name || "\u2014"],
                ["Week off", edit.week_off.join(", ")],
                ["Can see branches", edit.accessible_branches.map((b) => branchOf(b)?.code).join(", ")],
                ["Employee code", edit.employee_code],
                ["Status", edit.working_status.replace(/_/g, " ")],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 pb-3 border-b border-slate-100">
                  <span className="text-xs text-slate-500 shrink-0">{k}</span>
                  <span className="text-xs text-slate-900 font-medium text-right capitalize">{v}</span>
                </div>
              ))}
            </div>

            {edit.working_status === "resigned" && (
              <div className="bg-slate-50 rounded-xl p-4 mb-5">
                <p className="text-xs font-semibold text-slate-900 mb-3">Exit checklist</p>
                {[
                  ["Exit interview", edit.exit_interview_done],
                  ["Assets returned", edit.assets_returned],
                  ["Full and final cleared", edit.full_and_final_cleared],
                  ["Eligible for rehire", edit.rehire_eligible],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2 mb-2">
                    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${v ? "bg-emerald-500 border-emerald-500" : "border-slate-300"}`}>
                      {v && <Check className="w-3 h-3 text-white" />}
                    </span>
                    <span className="text-xs text-slate-700">{k}</span>
                  </div>
                ))}
                <p className="text-xs text-slate-500 mt-3">Left on {fmtDateLong(edit.resignation_date)}</p>
              </div>
            )}

            <button onClick={() => { toast("Profile editor opens here"); setEdit(null); }}
              className="w-full py-3 rounded-xl bg-slate-900 text-white text-sm font-medium focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
              Edit profile
            </button>
          </>
        )}
      </Sheet>
    </PageShell>
  );
}
