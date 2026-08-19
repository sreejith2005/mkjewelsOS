import React from 'react';
import { Users, CheckSquare, AlertCircle, Zap, BarChart2, Star, Phone, FileText, TrendingUp } from 'lucide-react';
import MetricCard from './MetricCard';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, PieChart, Pie, Cell } from 'recharts';

const SCORE_COLOR = (score) => score >= 80 ? 'text-emerald-600 bg-emerald-50' : score >= 60 ? 'text-amber-600 bg-amber-50' : 'text-rose-600 bg-rose-50';

export default function ManagerDashboard({ data }) {
  if (!data) return null;
  const { kpis, staff_scores, task_trend_chart, outcome_breakdown, workflow_summary } = data;

  const outcomeData = Object.entries(outcome_breakdown || {}).map(([k, v]) => ({ name: k, value: v }));
  const COLORS = { positive: '#10b981', neutral: '#64748b', negative: '#ef4444', pending: '#f59e0b' };

  return (
    <div className="space-y-5">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard title="Total Staff" value={kpis.total_staff} icon={Users} color="blue" index={0} />
        <MetricCard title="Task Completion" value={kpis.task_completion_rate} unit="%" icon={CheckSquare} color="emerald" index={1} />
        <MetricCard title="Tasks Overdue" value={kpis.tasks_overdue} icon={AlertCircle} color="rose" index={2} />
        <MetricCard title="FMS Efficiency" value={kpis.fms_efficiency} unit="%" icon={Zap} color="violet" index={3} />
        <MetricCard title="Total Clients" value={kpis.total_clients} icon={TrendingUp} color="cyan" index={4} subtitle={`+${kpis.new_clients_period} this period`} />
        <MetricCard title="CRM Health" value={kpis.crm_data_completeness} unit="%" icon={BarChart2} color="amber" index={5} />
        <MetricCard title="SLA Breaches" value={kpis.wf_sla_breached} icon={AlertCircle} color="orange" index={6} />
        <MetricCard title="Forms Submitted" value={kpis.forms_submitted} icon={FileText} color="slate" index={7} />
      </div>

      {/* Task Trend Chart */}
      {task_trend_chart?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-sm font-semibold text-slate-700 mb-4">Task Performance Trend</p>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={task_trend_chart}>
              <defs>
                <linearGradient id="gc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              <Area type="monotone" dataKey="completed" stroke="#10b981" fill="url(#gc)" strokeWidth={2} name="Completed" />
              <Area type="monotone" dataKey="overdue" stroke="#ef4444" fill="url(#gr)" strokeWidth={2} name="Overdue" />
              <Area type="monotone" dataKey="pending" stroke="#f59e0b" fill="none" strokeWidth={2} strokeDasharray="4 2" name="Pending" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Outcome Breakdown Pie */}
      {outcomeData.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-sm font-semibold text-slate-700 mb-4">Interaction Outcomes</p>
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={130} height={130}>
              <PieChart>
                <Pie data={outcomeData} dataKey="value" cx="50%" cy="50%" outerRadius={55} innerRadius={30}>
                  {outcomeData.map((entry, i) => (
                    <Cell key={i} fill={COLORS[entry.name] || '#64748b'} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {outcomeData.map(entry => (
                <div key={entry.name} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: COLORS[entry.name] }} />
                  <span className="text-xs text-slate-600 capitalize">{entry.name}</span>
                  <span className="text-xs font-bold text-slate-800">{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Staff Discipline Table */}
      {staff_scores?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-4">
            <Star className="h-4 w-4 text-amber-500" />
            <p className="text-sm font-semibold text-slate-700">Staff Discipline Scores</p>
          </div>
          <div className="space-y-2">
            {staff_scores.map((staff, i) => (
              <div key={staff.user_id} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50">
                <span className="text-sm font-bold text-slate-400 w-5">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{staff.designation || 'Staff'}</p>
                  <p className="text-[10px] text-slate-400">{staff.tasks_completed}/{staff.tasks_total} tasks · {staff.followups_done} followups</p>
                </div>
                <div className={`px-2.5 py-1 rounded-xl text-sm font-bold ${SCORE_COLOR(staff.discipline_score)}`}>
                  {staff.discipline_score}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 mt-2 text-center">
            Score = tasks(40%) + followups(30%) + SLA(30%)
          </p>
        </div>
      )}

      {/* Workflow Summary Table */}
      {workflow_summary?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="h-4 w-4 text-violet-500" />
            <p className="text-sm font-semibold text-slate-700">FMS Summary</p>
          </div>
          <div className="space-y-2">
            {workflow_summary.map((wf, i) => (
              <div key={wf.id} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-800 font-medium truncate">{wf.name}</p>
                  <p className="text-[10px] text-slate-400 capitalize">{wf.category}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-emerald-600">{wf.completed_instances} done</p>
                  <p className="text-[10px] text-amber-500">{wf.active_instances} active</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}