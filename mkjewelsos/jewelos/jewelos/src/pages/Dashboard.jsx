import { useState } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { useStore } from "../lib/store.jsx";
import { BRANCHES } from "../data/org.js";
import { WEEKLY_SALES, CONVERSION_TREND, CATEGORY_MIX } from "../data/analytics.js";
import { inr } from "../lib/utils.js";
import { Card, PageShell, Reveal, SectionTitle, FilterRow } from "../components/ui.jsx";

const TONE = {
  emerald: "text-emerald-600", amber: "text-amber-600",
  rose: "text-rose-600", blue: "text-blue-600", violet: "text-violet-600",
};

const tooltipStyle = { borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 };
const axisTick = { fontSize: 11, fill: "#94a3b8" };

export default function Dashboard() {
  const { profile, tasks, customers, fmsInstances, submissions } = useStore();
  const [range, setRange] = useState("week");
  const [branch, setBranch] = useState("all");

  const isLeader = ["super_admin", "admin", "manager"].includes(profile.role_level);
  const mine = tasks.filter((t) => t.assigned_to === profile.id);
  const completion = mine.length ? Math.round((mine.filter((t) => t.status === "completed").length / mine.length) * 100) : 0;

  const totalWeek = WEEKLY_SALES.reduce((s, d) => s + d.bandra + d.andheri, 0);
  const targetWeek = WEEKLY_SALES.reduce((s, d) => s + d.target, 0);
  const activeFlows = fmsInstances.filter((f) => f.status === "active").length;
  const breached = fmsInstances.filter((f) => f.sla_breached).length;
  const vips = customers.filter((c) => c.customer_type === "vip").length;

  const kpis = isLeader
    ? [
        { label: "Revenue this week", value: `\u20b9${(totalWeek / 100).toFixed(1)}L`, delta: "+12% vs last", tone: "emerald" },
        { label: "Against target", value: `${Math.round((totalWeek / targetWeek) * 100)}%`, delta: `${inr((totalWeek - targetWeek) * 1000)} gap`, tone: totalWeek >= targetWeek ? "emerald" : "amber" },
        { label: "Workflows running", value: activeFlows, delta: `${breached} past SLA`, tone: breached ? "rose" : "blue" },
        { label: "VIP customers", value: vips, delta: `${customers.length} total`, tone: "violet" },
      ]
    : [
        { label: "Tasks done today", value: `${completion}%`, delta: `${mine.filter((t) => t.status === "completed").length} of ${mine.length}`, tone: "emerald" },
        { label: "My customers", value: customers.filter((c) => c.assigned_to === profile.id).length, delta: "assigned to you", tone: "blue" },
        { label: "Forms submitted", value: submissions.filter((s) => s.submitted_by === profile.id).length, delta: "this month", tone: "amber" },
        { label: "Conversion", value: "31%", delta: "+5 pts", tone: "violet" },
      ];

  return (
    <PageShell title="Reports" subtitle={isLeader ? "Across every branch you can see" : "Your numbers this week"}>
      <FilterRow value={range} onChange={setRange}
        options={[["week", "This week"], ["month", "This month"], ["quarter", "Quarter"]]} />

      {isLeader && (
        <div className="mt-2">
          <FilterRow value={branch} onChange={setBranch}
            options={[["all", "All branches"], ...profile.accessible_branches.map((b) => [b, BRANCHES.find((x) => x.id === b)?.code])]} />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mt-4">
        {kpis.map((k, i) => (
          <Reveal key={k.label} delay={i * 40}>
            <Card className="p-4">
              <p className="text-xs text-slate-500 leading-snug">{k.label}</p>
              <p className="text-2xl font-bold text-slate-900 mt-1.5 tabular-nums">{k.value}</p>
              <p className={`text-xs mt-1 ${TONE[k.tone]}`}>{k.delta}</p>
            </Card>
          </Reveal>
        ))}
      </div>

      <Reveal delay={160} className="mt-6">
        <SectionTitle>Daily sales against target</SectionTitle>
        <Card className="p-4 pb-2">
          <div className="w-full h-[200px]">
            <ResponsiveContainer>
              <BarChart data={WEEKLY_SALES} margin={{ top: 4, right: 4, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="day" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => `\u20b9${v}k`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="bandra" name="Bandra" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                <Bar dataKey="andheri" name="Andheri" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </Reveal>

      <Reveal delay={200} className="mt-6">
        <SectionTitle>Walk-in to sale conversion</SectionTitle>
        <Card className="p-4 pb-2">
          <div className="w-full h-[170px]">
            <ResponsiveContainer>
              <LineChart data={CONVERSION_TREND} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="week" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} unit="%" />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}%`} />
                <Line type="monotone" dataKey="rate" stroke="#8b5cf6" strokeWidth={2.5} dot={{ r: 3, fill: "#8b5cf6" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </Reveal>

      <Reveal delay={240} className="mt-6">
        <SectionTitle>What's selling</SectionTitle>
        <Card className="p-4">
          <div className="w-full h-[190px]">
            <ResponsiveContainer>
              <PieChart>
                <Pie data={CATEGORY_MIX} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72} paddingAngle={2}>
                  {CATEGORY_MIX.map((e) => <Cell key={e.name} fill={e.fill} />)}
                </Pie>
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => `${v}%`} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </Reveal>
    </PageShell>
  );
}
