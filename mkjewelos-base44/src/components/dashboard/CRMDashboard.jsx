import React from 'react';
import { Users, Database, Phone, AlertCircle, CheckCircle2, Calendar, TrendingUp, BarChart2 } from 'lucide-react';
import MetricCard from './MetricCard';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import { buildBarChartData } from './analyticsEngine';

const TYPE_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444'];

export default function CRMDashboard({ data }) {
  if (!data) return null;
  const { kpis, by_type, by_source, missing_breakdown, acquisition_chart, due_customers } = data;

  const typeChartData = buildBarChartData(by_type, 'type', 'count');
  const sourceChartData = buildBarChartData(by_source, 'source', 'count');

  return (
    <div className="space-y-5">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard title="Total Clients" value={kpis.total_clients} icon={Users} color="blue" index={0} />
        <MetricCard title="Data Completeness" value={kpis.crm_data_completeness} unit="%" icon={Database} color="emerald" index={1} subtitle={`${kpis.complete_profiles} complete profiles`} />
        <MetricCard title="Follow-up Rate" value={kpis.followup_completion_rate} unit="%" icon={CheckCircle2} color="violet" index={2} />
        <MetricCard title="Total Interactions" value={kpis.total_interactions} icon={Phone} color="amber" index={3} />
        <MetricCard title="Due Today" value={kpis.due_today_followups} icon={Calendar} color="orange" index={4} />
        <MetricCard title="Overdue Follow-ups" value={kpis.overdue_followups} icon={AlertCircle} color="rose" index={5} />
      </div>

      {/* Data Completeness Visual */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-slate-700">CRM Data Health</p>
          <span className="text-2xl font-bold text-emerald-600">{kpis.crm_data_completeness}%</span>
        </div>
        <div className="h-3 bg-slate-100 rounded-full overflow-hidden mb-2">
          <div
            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all duration-700"
            style={{ width: `${kpis.crm_data_completeness}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 mb-4">Completeness = clients with required fields / total clients × 100</p>

        {/* Missing Fields Breakdown */}
        <p className="text-xs font-medium text-slate-600 mb-2">Missing Fields</p>
        <div className="space-y-2">
          {Object.entries(missing_breakdown || {}).map(([field, count]) => (
            <div key={field} className="flex items-center gap-3">
              <span className="text-xs text-slate-500 w-28 capitalize">{field.replace('_', ' ')}</span>
              <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-rose-400 rounded-full transition-all"
                  style={{ width: kpis.total_clients > 0 ? `${(count / kpis.total_clients) * 100}%` : '0%' }}
                />
              </div>
              <span className="text-xs font-medium text-rose-600 w-8 text-right">{count}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Client Acquisition Chart */}
      {acquisition_chart?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-sm font-semibold text-slate-700 mb-4">New Clients Acquired</p>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={acquisition_chart}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="New Clients" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Segmentation Charts */}
      <div className="grid grid-cols-2 gap-3">
        {typeChartData.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 p-4">
            <p className="text-xs font-semibold text-slate-600 mb-3">By Type</p>
            <ResponsiveContainer width="100%" height={120}>
              <PieChart>
                <Pie data={typeChartData} dataKey="count" nameKey="type" cx="50%" cy="50%" outerRadius={45}>
                  {typeChartData.map((_, i) => <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
        {sourceChartData.length > 0 && (
          <div className="bg-white rounded-2xl border border-slate-100 p-4">
            <p className="text-xs font-semibold text-slate-600 mb-3">By Source</p>
            <ResponsiveContainer width="100%" height={120}>
              <PieChart>
                <Pie data={sourceChartData} dataKey="count" nameKey="source" cx="50%" cy="50%" outerRadius={45}>
                  {sourceChartData.map((_, i) => <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: 12, fontSize: 11 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Due Follow-ups Table */}
      {due_customers?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-amber-500" />
            Upcoming Follow-ups
          </p>
          <div className="space-y-2">
            {due_customers.slice(0, 8).map((f, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${f.follow_up_date < new Date().toISOString().split('T')[0] ? 'bg-rose-500' : 'bg-amber-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate">{f.subject || f.type}</p>
                </div>
                <span className="text-[10px] text-slate-500">{f.follow_up_date}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}