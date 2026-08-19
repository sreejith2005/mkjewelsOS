import React from 'react';
import { motion } from 'framer-motion';
import { GitBranch, Play, Pause, Clock, ChevronRight, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const categoryColors = {
  sales: 'bg-blue-100 text-blue-700',
  order: 'bg-emerald-100 text-emerald-700',
  repair: 'bg-amber-100 text-amber-700',
  custom_order: 'bg-violet-100 text-violet-700',
  return: 'bg-rose-100 text-rose-700',
  quality: 'bg-cyan-100 text-cyan-700',
  inventory: 'bg-indigo-100 text-indigo-700',
  customer_service: 'bg-pink-100 text-pink-700',
};

export default function WorkflowCard({ workflow, onClick, index = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={() => onClick?.(workflow)}
      className="bg-white rounded-xl border border-slate-100 p-5 hover:shadow-lg hover:border-amber-200 transition-all cursor-pointer group"
    >
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-violet-600 flex items-center justify-center flex-shrink-0">
          <GitBranch className="h-5 w-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-800">{workflow.name}</h3>
            {workflow.is_active ? (
              <Play className="h-3 w-3 text-emerald-500 fill-emerald-500" />
            ) : (
              <Pause className="h-3 w-3 text-slate-400" />
            )}
          </div>
          <p className="text-sm text-slate-500 mt-1 line-clamp-1">{workflow.description}</p>
          
          <div className="flex items-center gap-2 mt-3">
            <Badge className={categoryColors[workflow.category] || 'bg-slate-100 text-slate-600'}>
              {workflow.category?.replace('_', ' ')}
            </Badge>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs text-slate-500 flex items-center gap-1">
              <Users className="h-3 w-3" />
              {workflow.stages?.length || 0} stages
            </span>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-amber-500 transition-colors" />
      </div>
    </motion.div>
  );
}