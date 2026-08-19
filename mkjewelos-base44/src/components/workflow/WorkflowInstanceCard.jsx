import React from 'react';
import { motion } from 'framer-motion';
import { 
  GitBranch, Clock, User, AlertTriangle, 
  CheckCircle2, ChevronRight, Play 
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { format } from 'date-fns';

const statusColors = {
  active: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-slate-100 text-slate-500',
  on_hold: 'bg-amber-100 text-amber-700',
};

const priorityColors = {
  low: 'bg-slate-100 text-slate-600',
  medium: 'bg-blue-100 text-blue-600',
  high: 'bg-amber-100 text-amber-600',
  urgent: 'bg-rose-100 text-rose-600',
};

export default function WorkflowInstanceCard({ instance, workflowName, onClick, index = 0 }) {
  const stagesCompleted = instance.stage_history?.length || 0;
  const totalStages = 5; // This would come from workflow definition
  const progress = (stagesCompleted / totalStages) * 100;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={() => onClick?.(instance)}
      className={`bg-white rounded-xl border p-4 hover:shadow-lg transition-all cursor-pointer group ${
        instance.sla_breached ? 'border-rose-200' : 'border-slate-100 hover:border-amber-200'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            instance.status === 'completed' ? 'bg-emerald-100' : 
            instance.status === 'on_hold' ? 'bg-amber-100' : 'bg-blue-100'
          }`}>
            {instance.status === 'completed' ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            ) : instance.status === 'on_hold' ? (
              <Clock className="h-5 w-5 text-amber-600" />
            ) : (
              <Play className="h-5 w-5 text-blue-600" />
            )}
          </div>
          <div>
            <p className="text-xs text-slate-400 font-mono">{instance.reference_number}</p>
            <h3 className="font-medium text-slate-800">{workflowName || 'Workflow'}</h3>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {instance.sla_breached && (
            <AlertTriangle className="h-4 w-4 text-rose-500" />
          )}
          <Badge className={priorityColors[instance.priority || 'medium']}>
            {instance.priority}
          </Badge>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-slate-500">Current: {instance.current_stage_name || 'N/A'}</span>
          <span className="text-slate-400">{stagesCompleted}/{totalStages}</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <Clock className="h-3 w-3" />
          {instance.started_at && format(new Date(instance.started_at), 'MMM d, h:mm a')}
        </div>
        <Badge className={statusColors[instance.status || 'active']}>
          {instance.status}
        </Badge>
      </div>
    </motion.div>
  );
}