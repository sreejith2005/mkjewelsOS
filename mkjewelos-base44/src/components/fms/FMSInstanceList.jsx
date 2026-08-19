const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { motion } from 'framer-motion';
import { Play, CheckCircle, Clock, AlertTriangle, XCircle, ChevronRight, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import FMSInstanceDetail from './FMSInstanceDetail';

const STATUS_CONFIG = {
  active:    { label: 'Active',    color: 'bg-blue-100 text-blue-700',    icon: Play },
  completed: { label: 'Done',      color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  overdue:   { label: 'Overdue',   color: 'bg-red-100 text-red-700',      icon: AlertTriangle },
  on_hold:   { label: 'On Hold',   color: 'bg-amber-100 text-amber-700',  icon: Clock },
  cancelled: { label: 'Cancelled', color: 'bg-slate-100 text-slate-500',  icon: XCircle },
};

const PRIORITY_DOT = {
  low:    'bg-slate-400',
  medium: 'bg-blue-500',
  high:   'bg-amber-500',
  urgent: 'bg-red-500',
};

export default function FMSInstanceList({ userProfile, user }) {
  const [instances, setInstances] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    const data = await db.entities.FMSInstance.list('-started_at', 100);
    setInstances(data);
    setLoading(false);
  };

  const filtered = statusFilter === 'all' ? instances : instances.filter(i => i.status === statusFilter);

  const counts = {
    active: instances.filter(i => i.status === 'active').length,
    overdue: instances.filter(i => i.status === 'overdue').length,
    completed: instances.filter(i => i.status === 'completed').length,
  };

  if (selected) {
    return (
      <FMSInstanceDetail
        instance={selected}
        onBack={() => { setSelected(null); load(); }}
        userProfile={userProfile}
        user={user}
      />
    );
  }

  return (
    <div>
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        {[
          { label: 'Active', value: counts.active, color: 'bg-blue-50 text-blue-700 border-blue-100' },
          { label: 'Overdue', value: counts.overdue, color: 'bg-red-50 text-red-700 border-red-100' },
          { label: 'Done', value: counts.completed, color: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
        ].map(s => (
          <div key={s.label} className={`${s.color} border rounded-xl p-2.5 text-center`}>
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-[10px] font-medium">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        {['all','active','overdue','completed','on_hold'].map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all ${
              statusFilter === s
                ? 'bg-indigo-600 text-white'
                : 'bg-white border border-slate-200 text-slate-600'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_CONFIG[s]?.label || s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3].map(i => <div key={i} className="h-24 bg-slate-200 animate-pulse rounded-2xl" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          <Play className="h-10 w-10 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No instances yet. Start a flow!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((inst, i) => {
            const sc = STATUS_CONFIG[inst.status] || STATUS_CONFIG.active;
            const activeSteps = (inst.step_states || []).filter(s => s.status === 'active' || s.status === 'in_progress');
            return (
              <motion.div
                key={inst.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.03 }}
                onClick={() => setSelected(inst)}
                className="bg-white rounded-2xl border border-slate-100 p-4 cursor-pointer hover:border-indigo-200 hover:shadow-sm transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${PRIORITY_DOT[inst.priority] || 'bg-slate-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <p className="font-semibold text-slate-800 text-sm">{inst.title}</p>
                      <Badge className={`text-[10px] ${sc.color}`}>{sc.label}</Badge>
                    </div>
                    <p className="text-xs text-slate-500 mb-2">{inst.flow_name} · {inst.reference_number}</p>
                    {activeSteps.length > 0 && (
                      <div className="flex items-center gap-1">
                        <span className="text-[10px] text-slate-400">Now:</span>
                        {activeSteps.slice(0,2).map(s => (
                          <span key={s.step_id} className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded-full">{s.step_name}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1 flex-shrink-0">
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                    {inst.started_at && (
                      <span className="text-[10px] text-slate-400">
                        {format(new Date(inst.started_at), 'dd MMM')}
                      </span>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}