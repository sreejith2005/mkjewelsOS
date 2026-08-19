import { useState } from "react";
import {
  GitBranch, GitFork, CircleDot, FileCheck, FileText, BellRing, Flag,
  ChevronRight, Check, Clock, AlertTriangle, Plus, Copy, Trash2, ArrowRight,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { FMS_FLOWS } from "../data/fms.js";
import { DROPDOWN_CONFIG } from "../data/org.js";
import { PRIORITY, inr, fmtDate, relDays } from "../lib/utils.js";
import {
  Card, Chip, EmptyState, PageShell, Reveal, SectionTitle, Sheet, Field, Tabs, inputBase,
} from "../components/ui.jsx";

const STEP_ICON = {
  task: CircleDot, approval: FileCheck, form: FileText, notification: BellRing,
  branch: GitFork, parallel_start: GitBranch, parallel_join: GitBranch, end: Flag,
};

const STEP_TONE = {
  task: "bg-blue-100 text-blue-700",
  approval: "bg-amber-100 text-amber-700",
  form: "bg-violet-100 text-violet-700",
  notification: "bg-emerald-100 text-emerald-700",
  branch: "bg-rose-100 text-rose-700",
  parallel_start: "bg-slate-200 text-slate-700",
  parallel_join: "bg-slate-200 text-slate-700",
  end: "bg-slate-900 text-white",
};

const slaLabel = (m) => (m >= 1440 ? `${Math.round(m / 1440)}d` : `${Math.round(m / 60)}h`);

function StartFlowSheet({ flow, onClose, onStart }) {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("medium");
  const [err, setErr] = useState("");
  if (!flow) return null;

  return (
    <Sheet open={!!flow} title={`Start: ${flow.name}`} onClose={onClose}>
      <p className="text-xs text-slate-500 mb-4 leading-relaxed">
        A reference number is generated and the first step lands on whoever the rule names.
      </p>
      <Field label="What is this run for" required>
        <input value={title} onChange={(e) => { setTitle(e.target.value); setErr(""); }}
          placeholder="Ananya Desai - solitaire ring" className={`${inputBase} border-slate-200`} />
      </Field>
      {err && <p className="text-xs text-rose-600 -mt-2 mb-3">{err}</p>}
      <Field label="Priority">
        <div className="grid grid-cols-4 gap-2">
          {DROPDOWN_CONFIG.task_priorities.map((p) => (
            <button key={p} onClick={() => setPriority(p)}
              className={`py-2.5 rounded-xl border text-xs font-medium capitalize focus-visible:ring-2 focus-visible:ring-amber-500 ${
                priority === p ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
              }`}>
              {p}
            </button>
          ))}
        </div>
      </Field>
      <button
        onClick={() => {
          if (!title.trim()) { setErr("Give this run a name so it's findable."); return; }
          onStart({ title: title.trim(), priority });
        }}
        className="w-full mt-2 py-3 rounded-xl bg-slate-900 text-white text-sm font-medium focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
        Start workflow
      </button>
    </Sheet>
  );
}

export default function FMSBuilder() {
  const { profile, fmsInstances, advanceStep, startInstance, users, toast } = useStore();
  const [tab, setTab] = useState("library");
  const [flowId, setFlowId] = useState(null);
  const [instId, setInstId] = useState(null);
  const [starting, setStarting] = useState(null);

  const isAdmin = ["super_admin", "admin", "manager"].includes(profile.role_level);
  const flow = FMS_FLOWS.find((f) => f.id === flowId);
  const inst = fmsInstances.find((i) => i.id === instId);

  /* ---------- one live run ---------- */
  if (inst) {
    const f = FMS_FLOWS.find((x) => x.id === inst.flow_id);
    return (
      <PageShell title={inst.reference_number} subtitle={inst.title} back={() => setInstId(null)} backLabel="Workflows">
        <Card className="p-4 mt-1 mb-5">
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip className={PRIORITY[inst.priority].chip}>{PRIORITY[inst.priority].label}</Chip>
            <Chip className={inst.status === "completed" ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}>
              {inst.status}
            </Chip>
            {inst.sla_breached && (
              <Chip className="bg-rose-100 text-rose-700"><AlertTriangle className="w-3 h-3" />SLA breached</Chip>
            )}
          </div>
          <p className="text-xs text-slate-500 mt-3">
            {f.name} &middot; started {relDays(inst.started_on).toLowerCase()} by {users.find((u) => u.id === inst.started_by)?.name}
          </p>
          {inst.context?.budget && <p className="text-xs text-slate-500 mt-1">Order value {inr(inst.context.budget)}</p>}
        </Card>

        <SectionTitle>Steps</SectionTitle>
        <div>
          {inst.step_states.map((st, i) => {
            const step = f.steps.find((s) => s.id === st.step_id);
            if (!step) return null;
            const Icon = STEP_ICON[step.type] || CircleDot;
            const owner = users.find((u) => u.id === st.assigned_to);
            const isMine = st.assigned_to === profile.id && st.status === "in_progress";
            const last = i === inst.step_states.length - 1;

            return (
              <Reveal key={st.step_id} delay={i * 40}>
                <div className="flex gap-3">
                  <div className="flex flex-col items-center shrink-0">
                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${st.status === "completed" ? "bg-emerald-500 text-white" : STEP_TONE[step.type]}`}>
                      {st.status === "completed" ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                    </span>
                    {!last && <span className={`w-0.5 flex-1 my-1 min-h-[18px] ${st.status === "completed" ? "bg-emerald-300" : "bg-slate-200"}`} />}
                  </div>

                  <div className="flex-1 pb-4">
                    <div className="bg-white rounded-2xl border border-slate-100 p-3.5">
                      <p className={`text-sm font-medium ${st.status === "completed" ? "text-slate-400" : "text-slate-900"}`}>
                        {step.name}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <Chip className="bg-slate-100 text-slate-600 capitalize">{step.type.replace(/_/g, " ")}</Chip>
                        {owner && <Chip className="bg-slate-100 text-slate-600">{owner.name.split(" ")[0]}</Chip>}
                        {step.sla_minutes > 0 && (
                          <Chip className="bg-slate-100 text-slate-600"><Clock className="w-3 h-3" />{slaLabel(step.sla_minutes)}</Chip>
                        )}
                      </div>
                      {st.note && <p className="text-xs text-slate-500 mt-2 italic">{st.note}</p>}
                      {step.branches && (
                        <ul className="mt-2 space-y-1">
                          {step.branches.map((b, bi) => (
                            <li key={bi} className="text-xs text-slate-500 flex items-center gap-1.5">
                              <ArrowRight className="w-3 h-3 shrink-0" />{b.label}
                            </li>
                          ))}
                        </ul>
                      )}
                      {st.status === "completed" && <p className="text-xs text-emerald-600 mt-2">Done {fmtDate(st.completed_on)}</p>}
                      {isMine && (
                        <button onClick={() => advanceStep(inst.id, st.step_id)}
                          className="w-full mt-3 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-medium focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
                          {step.type === "approval" ? "Approve and continue"
                            : step.type === "form" ? "Fill form and continue"
                            : "Complete this step"}
                        </button>
                      )}
                      {st.status === "in_progress" && !isMine && (
                        <p className="text-xs text-blue-600 mt-2">Waiting on {owner?.name || "assignment"}</p>
                      )}
                    </div>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </PageShell>
    );
  }

  /* ---------- one flow template ---------- */
  if (flow) {
    return (
      <PageShell title={flow.name} subtitle={flow.description} back={() => setFlowId(null)} backLabel="Workflows">
        <Card className="p-4 mt-1 mb-5">
          <div className="flex flex-wrap gap-1.5">
            <Chip className="bg-slate-100 text-slate-600 capitalize">{flow.category}</Chip>
            <Chip className="bg-slate-100 text-slate-600">v{flow.version}</Chip>
            <Chip className="bg-slate-100 text-slate-600">{flow.usage_count} runs</Chip>
            <Chip className={flow.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"}>
              {flow.is_active ? "Active" : "Draft"}
            </Chip>
          </div>
        </Card>

        <SectionTitle>Step sequence</SectionTitle>
        <div className="space-y-2">
          {flow.steps.map((s, i) => {
            const Icon = STEP_ICON[s.type] || CircleDot;
            return (
              <Reveal key={s.id} delay={i * 35}>
                <Card className="p-3.5">
                  <div className="flex items-start gap-3">
                    <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${STEP_TONE[s.type]}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">{s.name}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {s.assignee_rule.label}
                        {s.sla_minutes > 0 && ` \u00b7 ${slaLabel(s.sla_minutes)} SLA`}
                      </p>
                      {s.branches && (
                        <ul className="mt-2 space-y-1">
                          {s.branches.map((b, bi) => (
                            <li key={bi} className="text-xs text-rose-600 flex items-center gap-1.5">
                              <GitFork className="w-3 h-3 shrink-0" />{b.label}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <span className="text-xs text-slate-300 font-medium tabular-nums shrink-0">{s.order}</span>
                  </div>
                </Card>
              </Reveal>
            );
          })}
        </div>

        <div className="flex gap-2 mt-5">
          <button onClick={() => setStarting(flow)}
            className="flex-1 py-3 rounded-xl bg-slate-900 text-white text-sm font-medium focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
            Start this workflow
          </button>
          {isAdmin && (
            <>
              <button onClick={() => toast("Flow canvas editor opens here")} aria-label="Duplicate flow"
                className="px-4 py-3 rounded-xl border border-slate-200 focus-visible:ring-2 focus-visible:ring-amber-500">
                <Copy className="w-4 h-4 text-slate-600" />
              </button>
              <button onClick={() => toast("Deleting needs Director confirmation")} aria-label="Delete flow"
                className="px-4 py-3 rounded-xl border border-slate-200 focus-visible:ring-2 focus-visible:ring-amber-500">
                <Trash2 className="w-4 h-4 text-slate-600" />
              </button>
            </>
          )}
        </div>

        <StartFlowSheet flow={starting} onClose={() => setStarting(null)}
          onStart={(payload) => { startInstance(flow, payload); setStarting(null); setFlowId(null); setTab("live"); }} />
      </PageShell>
    );
  }

  /* ---------- library + live list ---------- */
  return (
    <PageShell title="Workflows" subtitle="Repeatable processes with owners, gates and deadlines">
      <Tabs value={tab} onChange={setTab}
        items={[
          { id: "library", label: "Flow library" },
          { id: "live", label: `Running (${fmsInstances.filter((i) => i.status === "active").length})` },
        ]} />

      {tab === "library" && (
        <div className="space-y-2.5 mt-4">
          {FMS_FLOWS.map((f, i) => (
            <Reveal key={f.id} delay={i * 40}>
              <Card onClick={() => setFlowId(f.id)} className="p-4">
                <div className="flex items-start gap-3">
                  <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center shrink-0">
                    <GitBranch className="w-5 h-5 text-white" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900">{f.name}</p>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">{f.description}</p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                      <Chip className="bg-slate-100 text-slate-600">{f.steps.length} steps</Chip>
                      <Chip className="bg-slate-100 text-slate-600">{f.usage_count} runs</Chip>
                      {!f.is_active && <Chip className="bg-slate-200 text-slate-600">Draft</Chip>}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-300 shrink-0 mt-1" />
                </div>
              </Card>
            </Reveal>
          ))}
          {isAdmin && (
            <button onClick={() => toast("Flow canvas opens here")}
              className="w-full py-3 rounded-2xl border-2 border-dashed border-slate-200 text-slate-500 text-xs font-medium flex items-center justify-center gap-2 focus-visible:ring-2 focus-visible:ring-amber-500">
              <Plus className="w-4 h-4" /> Build a new flow
            </button>
          )}
        </div>
      )}

      {tab === "live" && (
        <div className="space-y-2.5 mt-4">
          {fmsInstances.length === 0 ? (
            <Card><EmptyState icon={GitBranch} title="Nothing running" hint="Start a flow from the library and it will show up here." /></Card>
          ) : (
            fmsInstances.map((it, i) => {
              const f = FMS_FLOWS.find((x) => x.id === it.flow_id);
              const doneN = it.step_states.filter((s) => s.status === "completed").length;
              const pct = Math.round((doneN / it.step_states.length) * 100);
              const cur = it.step_states.find((s) => s.status === "in_progress");
              const curStep = cur && f.steps.find((s) => s.id === cur.step_id);
              const waiting = users.find((u) => u.id === cur?.assigned_to);

              return (
                <Reveal key={it.id} delay={i * 40}>
                  <Card onClick={() => setInstId(it.id)} className="p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs text-slate-400 font-medium tabular-nums">{it.reference_number}</p>
                        <p className="text-sm font-medium text-slate-900 mt-0.5 leading-snug">{it.title}</p>
                      </div>
                      <Chip className={it.status === "completed" ? "bg-emerald-100 text-emerald-700" : PRIORITY[it.priority].chip}>
                        {it.status === "completed" ? "Done" : PRIORITY[it.priority].label}
                      </Chip>
                    </div>
                    <div className="flex items-center gap-2 mt-3">
                      <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${it.status === "completed" ? "bg-emerald-500" : "bg-violet-500"}`}
                          style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-slate-500 tabular-nums">{doneN}/{it.step_states.length}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-2.5">
                      {curStep ? (
                        <>At <span className="text-slate-700 font-medium">{curStep.name}</span> &middot; {waiting?.name.split(" ")[0] || "unassigned"}</>
                      ) : "All steps closed"}
                      {it.sla_breached && <span className="text-rose-600 font-medium"> &middot; overdue</span>}
                    </p>
                  </Card>
                </Reveal>
              );
            })
          )}
        </div>
      )}
    </PageShell>
  );
}
