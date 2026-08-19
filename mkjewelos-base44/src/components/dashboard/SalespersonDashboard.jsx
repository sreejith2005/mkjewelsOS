import React from 'react';
import { Users, Phone, CheckCircle, Share2, Star, TrendingUp, Clock, BarChart2 } from 'lucide-react';
import MetricCard from './MetricCard';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';

export default function SalespersonDashboard({ data }) {
  if (!data) return null;
  const { kpis, chart_data, recent_interactions } = data;

  const outcomeColors = { positive: '#10b981', neutral: '#64748b', negative: '#ef4444', pending: '#f59e0b' };

  return (
    <div className="space-y-5">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard title="Clients Attended" value={kpis.clients_attended} icon={Users} color="blue" index={0} />
        <MetricCard title="Sales Conversions" value={kpis.sales_conversions} icon={TrendingUp} color="emerald" index={1} />
        <MetricCard title="Conversion Rate" value={kpis.conversion_rate} unit="%" icon={BarChart2} color="violet" index={2} subtitle="sales / clients attended" />
        <MetricCard title="Calls Made" value={kpis.calls_made} icon={Phone} color="amber" index={3} />
        <MetricCard title="Follow-ups Done" value={kpis.followups_done} icon={CheckCircle} color="cyan" index={4} />
        <MetricCard title="Referrals" value={kpis.referrals_collected} icon={Share2} color="orange" index={5} />
        <MetricCard title="Reviews Collected" value={kpis.reviews_collected} icon={Star} color="rose" index={6} />
        <MetricCard title="Tasks Done" value={kpis.tasks_completed} icon={Clock} color="slate" index={7} />
      </div>

      {/* Conversion rate highlight */}
      <div className="bg-gradient-to-br from-amber-50 to-amber-100 rounded-2xl p-5 border border-amber-200">
        <p className="text-xs font-semibold text-amber-700 uppercase tracking-wider mb-1">Conversion Rate Formula</p>
        <div className="text-center">
          <p className="text-4xl font-bold text-amber-600">{kpis.conversion_rate}%</p>
          <p className="text-xs text-amber-700 mt-1">{kpis.sales_conversions} sales ÷ {kpis.clients_attended} clients</p>
        </div>
      </div>

      {/* Activity Chart */}
      {chart_data?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-sm font-semibold text-slate-700 mb-4">Activity Trend</p>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chart_data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} />
              <Line type="monotone" dataKey="clients" stroke="#3b82f6" strokeWidth={2} dot={false} name="Clients" />
              <Line type="monotone" dataKey="sales" stroke="#10b981" strokeWidth={2} dot={false} name="Sales" />
              <Line type="monotone" dataKey="calls" stroke="#f59e0b" strokeWidth={2} dot={false} name="Calls" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Recent Interactions Table */}
      {recent_interactions?.length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <p className="text-sm font-semibold text-slate-700 mb-3">Recent Interactions</p>
          <div className="space-y-2">
            {recent_interactions.map((interaction, i) => (
              <div key={i} className="flex items-center gap-3 py-2 border-b border-slate-50 last:border-0">
                <div className={`w-2 h-2 rounded-full flex-shrink-0`} style={{ background: outcomeColors[interaction.outcome] || '#64748b' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-700 truncate">{interaction.subject || interaction.type}</p>
                  <p className="text-[10px] text-slate-400">{interaction.date}</p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded-full capitalize font-medium"
                  style={{ background: outcomeColors[interaction.outcome] + '20', color: outcomeColors[interaction.outcome] }}>
                  {interaction.outcome}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}