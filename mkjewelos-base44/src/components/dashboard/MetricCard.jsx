import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

const colorMap = {
  blue: 'from-blue-500 to-blue-600',
  emerald: 'from-emerald-500 to-emerald-600',
  amber: 'from-amber-500 to-amber-600',
  violet: 'from-violet-500 to-violet-600',
  rose: 'from-rose-500 to-rose-600',
  cyan: 'from-cyan-500 to-cyan-600',
  slate: 'from-slate-500 to-slate-600',
  orange: 'from-orange-500 to-orange-600',
};

const bgMap = {
  blue: 'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  violet: 'bg-violet-50 text-violet-600',
  rose: 'bg-rose-50 text-rose-600',
  cyan: 'bg-cyan-50 text-cyan-600',
  slate: 'bg-slate-50 text-slate-600',
  orange: 'bg-orange-50 text-orange-600',
};

export default function MetricCard({ title, value, unit = '', subtitle = '', icon: Icon, color = 'blue', change, changeLabel = 'vs yesterday', target, index = 0 }) {
  const progress = target ? Math.min((parseFloat(value) / target) * 100, 100) : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm hover:shadow-md transition-all"
    >
      <div className="flex items-start justify-between mb-3">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${bgMap[color] || bgMap.blue}`}>
          {Icon && <Icon className="h-5 w-5" />}
        </div>
        {change !== undefined && change !== null && (
          <div className={`flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full ${
            change > 0 ? 'bg-emerald-50 text-emerald-600' :
            change < 0 ? 'bg-rose-50 text-rose-600' :
            'bg-slate-50 text-slate-400'
          }`}>
            {change > 0 ? <TrendingUp className="h-3 w-3" /> : change < 0 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {Math.abs(change)}%
          </div>
        )}
      </div>

      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-slate-800">{value}</span>
          {unit && <span className="text-sm text-slate-500">{unit}</span>}
        </div>
        <p className="text-xs font-medium text-slate-600 mt-0.5">{title}</p>
        {subtitle && <p className="text-[10px] text-slate-400 mt-0.5">{subtitle}</p>}
      </div>

      {progress !== null && (
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-slate-400">Target: {target}{unit}</span>
            <span className="text-[10px] font-medium text-slate-600">{progress.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${colorMap[color] || colorMap.blue} transition-all duration-700`}
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}
    </motion.div>
  );
}