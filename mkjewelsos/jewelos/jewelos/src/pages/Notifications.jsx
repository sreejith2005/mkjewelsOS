import { useState } from "react";
import { Bell } from "lucide-react";
import { useStore } from "../lib/store.jsx";
import { Card, Chip, EmptyState, PageShell, Reveal, FilterRow } from "../components/ui.jsx";

const DOT = { urgent: "bg-rose-500", high: "bg-amber-500", medium: "bg-blue-500", low: "bg-slate-300" };

export default function Notifications() {
  const { notifications, markRead, markAllRead, go } = useStore();
  const [type, setType] = useState("all");

  const list = notifications.filter((n) => type === "all" || n.type === type);
  const unread = notifications.filter((n) => !n.is_read).length;

  return (
    <PageShell title="Alerts" subtitle={unread ? `${unread} unread` : "All caught up"}>
      <FilterRow value={type} onChange={setType}
        options={[["all", "All"], ["task", "Task"], ["workflow", "Workflow"], ["alert", "Alert"], ["announcement", "Announcement"]]} />

      {unread > 0 && (
        <button onClick={markAllRead} className="text-xs font-medium text-amber-700 mt-3 focus-visible:underline">
          Mark all as read
        </button>
      )}

      <div className="space-y-2.5 mt-4">
        {list.length === 0 ? (
          <Card>
            <EmptyState icon={Bell} title="Nothing here"
              hint="Alerts about tasks, workflow steps and customer dates land in this list." />
          </Card>
        ) : list.map((n, i) => (
          <Reveal key={n.id} delay={i * 35}>
            <Card onClick={() => { markRead(n.id); go(n.page); }} className={`p-4 ${n.is_read ? "opacity-70" : "border-slate-200"}`}>
              <div className="flex gap-3">
                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${n.is_read ? "bg-transparent" : DOT[n.priority]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className={`text-sm leading-snug ${n.is_read ? "text-slate-600" : "text-slate-900 font-medium"}`}>{n.title}</p>
                    <span className="text-xs text-slate-400 shrink-0">{n.when}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">{n.message}</p>
                  <Chip className="bg-slate-100 text-slate-600 mt-2 capitalize">{n.type}</Chip>
                </div>
              </div>
            </Card>
          </Reveal>
        ))}
      </div>
    </PageShell>
  );
}
