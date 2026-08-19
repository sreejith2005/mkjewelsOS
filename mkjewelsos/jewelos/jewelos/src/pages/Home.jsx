import {
  Gem, ClipboardList, UserCheck, GitBranch, Phone, AlertTriangle, Users,
  FileText, Bell, BarChart3, Plus, Play, Repeat,
} from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { canAccessPage, ROLE_LABELS } from "../lib/roleConfig.jsx";
import { greeting, TODAY_ISO } from "../lib/utils.js";
import { FORM_TEMPLATES } from "../data/forms.js";
import { Chip, Card, SectionTitle, EmptyState, Reveal, Ring, HeroStat } from "../components/ui.jsx";
import TaskInstanceCard from "../components/TaskInstanceCard.jsx";

function SwipePanel({ tone, icon: Icon, label, count, caption, items, onOpen }) {
  const tones = {
    blue: "from-blue-500 to-blue-600",
    violet: "from-violet-500 to-violet-600",
    emerald: "from-emerald-500 to-emerald-600",
    amber: "from-amber-500 to-amber-600",
    rose: "from-rose-500 to-rose-600",
  };
  return (
    <button onClick={onOpen}
      className="snap-center shrink-0 w-64 text-left rounded-2xl bg-white border border-slate-100 shadow-sm p-4 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
      <div className="flex items-center justify-between mb-3">
        <span className={`w-9 h-9 rounded-xl bg-gradient-to-br ${tones[tone]} flex items-center justify-center`}>
          <Icon className="w-[18px] h-[18px] text-white" />
        </span>
        <span className="text-2xl font-bold text-slate-900 tabular-nums">{count}</span>
      </div>
      <p className="text-sm font-semibold text-slate-900">{label}</p>
      <p className="text-xs text-slate-500 mt-0.5">{caption}</p>
      <ul className="mt-3 space-y-1.5 border-t border-slate-100 pt-3">
        {items.length === 0 && <li className="text-xs text-slate-400">Nothing waiting</li>}
        {items.slice(0, 2).map((t, i) => (
          <li key={i} className="text-xs text-slate-600 truncate flex items-center gap-1.5">
            <span className="w-1 h-1 rounded-full bg-slate-300 shrink-0" />
            {t}
          </li>
        ))}
      </ul>
    </button>
  );
}

export default function Home() {
  const { profile, tasks, customers, interactions, notifications, fmsInstances, go, branchOf, users } = useStore();

  const mine = tasks.filter((t) => t.assigned_to === profile.id);
  const delegated = mine.filter((t) => t.is_delegated);
  const own = mine.filter((t) => !t.is_delegated);
  const doneCount = mine.filter((t) => t.status === "completed").length;
  const todayPct = mine.length ? Math.round((doneCount / mine.length) * 100) : 0;

  const unread = notifications.filter((n) => !n.is_read);
  const myFms = fmsInstances.filter(
    (fi) => fi.status === "active" && fi.step_states.some((s) => s.assigned_to === profile.id && s.status === "in_progress")
  );
  const followUps = interactions.filter((i) => i.follow_up_date === TODAY_ISO && i.user_id === profile.id);
  const priority = mine.filter((t) => t.status !== "completed" && ["urgent", "high"].includes(t.priority)).slice(0, 3);
  const role = ROLE_LABELS[profile.role_level];

  const cName = (cid) => {
    const c = customers.find((x) => x.id === cid);
    return c ? `${c.first_name} ${c.last_name}` : "Customer";
  };

  const modules = [
    { page: "CRM", label: "Customers", icon: Users, tone: "from-blue-500 to-blue-600", sub: `${customers.length} on file` },
    { page: "MyTasks", label: "My tasks", icon: ClipboardList, tone: "from-emerald-500 to-emerald-600", sub: `${mine.length - doneCount} open` },
    { page: "FMSBuilder", label: "Workflows", icon: GitBranch, tone: "from-violet-500 to-violet-600", sub: `${fmsInstances.filter((f) => f.status === "active").length} running` },
    { page: "Forms", label: "Forms", icon: FileText, tone: "from-amber-500 to-amber-600", sub: `${FORM_TEMPLATES.length} live` },
    { page: "Notifications", label: "Alerts", icon: Bell, tone: "from-rose-500 to-rose-600", sub: `${unread.length} unread` },
    { page: "Dashboard", label: "Reports", icon: BarChart3, tone: "from-slate-600 to-slate-700", sub: "This week" },
  ].filter((m) => canAccessPage(m.page, profile));

  const quick = [
    { icon: Plus, label: "New order", page: "Forms" },
    { icon: Users, label: "Add client", page: "CRM" },
    { icon: Play, label: "Start flow", page: "FMSBuilder" },
    { icon: Repeat, label: "Schedule", page: "MyTasks" },
  ].filter((q) => canAccessPage(q.page, profile));

  return (
    <div>
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 pt-6 pb-10">
        <Reveal>
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <p className="text-slate-400 text-xs">{greeting()},</p>
              <h1 className="text-2xl font-bold text-white mt-0.5 truncate">{profile.name.split(" ")[0]} &#128075;</h1>
              <div className="flex items-center gap-2 mt-2">
                <Chip className={role.chip}>{role.label}</Chip>
                <span className="text-xs text-slate-400 truncate">{branchOf(profile.branch_id)?.name}</span>
              </div>
            </div>
            <div className="relative shrink-0">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                <Gem className="w-6 h-6 text-white" />
              </div>
              {unread.length > 0 && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-rose-500 border-2 border-slate-900" />}
            </div>
          </div>
        </Reveal>

        <Reveal delay={60}>
          <div className="mt-6 flex items-center gap-5">
            <Ring pct={todayPct} />
            <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2.5">
              <HeroStat n={mine.length} label="Tasks" color="text-blue-300" />
              <HeroStat n={doneCount} label="Done" color="text-emerald-300" />
              <HeroStat n={delegated.length} label="Delegated" color="text-violet-300" />
              <HeroStat n={unread.length} label="Alerts" color="text-rose-300" />
            </div>
          </div>
        </Reveal>
      </div>

      <div className="bg-slate-50 rounded-t-3xl -mt-4 px-6 pt-6 pb-8">
        <Reveal delay={100}>
          <SectionTitle>Your day at a glance</SectionTitle>
          <div className="flex gap-3 overflow-x-auto no-scrollbar snap-x pb-2 -mx-6 px-6">
            <SwipePanel tone="blue" icon={ClipboardList} label="My daily tasks"
              count={own.filter((t) => t.status !== "completed").length} caption="Recurring and one-off"
              items={own.filter((t) => t.status !== "completed").map((t) => t.title)} onOpen={() => go("MyTasks")} />
            <SwipePanel tone="violet" icon={UserCheck} label="Delegated to me" count={delegated.length}
              caption="Passed over by someone"
              items={delegated.map((t) => `${t.title} \u2014 from ${users.find((u) => u.id === t.delegated_from)?.name.split(" ")[0]}`)}
              onOpen={() => go("MyTasks")} />
            <SwipePanel tone="emerald" icon={GitBranch} label="Workflow steps" count={myFms.length}
              caption="Waiting on you to move" items={myFms.map((f) => f.title)} onOpen={() => go("FMSBuilder")} />
            <SwipePanel tone="amber" icon={Phone} label="Customer follow-ups" count={followUps.length}
              caption="Promised for today" items={followUps.map((f) => `${cName(f.customer_id)} \u2014 ${f.subject}`)}
              onOpen={() => go("CRM")} />
            <SwipePanel tone="rose" icon={AlertTriangle} label="Needs attention" count={unread.length}
              caption="Unread alerts" items={unread.map((n) => n.title)} onOpen={() => go("Notifications")} />
          </div>
        </Reveal>

        {quick.length > 0 && (
          <Reveal delay={140} className="mt-7">
            <SectionTitle>Quick actions</SectionTitle>
            <div className="grid grid-cols-4 gap-2.5">
              {quick.map((q, i) => (
                <button key={i} onClick={() => go(q.page)}
                  className="bg-white rounded-2xl border border-slate-100 p-3 flex flex-col items-center gap-1.5 focus-visible:ring-2 focus-visible:ring-amber-500">
                  <q.icon className="w-4 h-4 text-slate-700" />
                  <span className="text-xs text-slate-600 text-center leading-tight">{q.label}</span>
                </button>
              ))}
            </div>
          </Reveal>
        )}

        <Reveal delay={180} className="mt-7">
          <SectionTitle action="See all" onAction={() => go("MyTasks")}>Priority today</SectionTitle>
          {priority.length === 0 ? (
            <Card><EmptyState title="Nothing urgent left" hint="Every high-priority task for today is closed. Good day." /></Card>
          ) : (
            <div className="space-y-2.5">
              {priority.map((t, i) => <TaskInstanceCard key={t.id} task={t} delay={i * 50} />)}
            </div>
          )}
        </Reveal>

        <Reveal delay={220} className="mt-7">
          <SectionTitle>Modules</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            {modules.map((m) => (
              <button key={m.page} onClick={() => go(m.page)}
                className="bg-white rounded-2xl border border-slate-100 p-4 text-left focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
                <span className={`w-10 h-10 rounded-xl bg-gradient-to-br ${m.tone} flex items-center justify-center mb-3`}>
                  <m.icon className="w-5 h-5 text-white" />
                </span>
                <p className="text-sm font-semibold text-slate-900">{m.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{m.sub}</p>
              </button>
            ))}
          </div>
        </Reveal>
      </div>
    </div>
  );
}
