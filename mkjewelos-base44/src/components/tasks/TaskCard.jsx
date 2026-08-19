import React from 'react';
import { motion } from 'framer-motion';
import { 
  Clock, User, Flag, CheckCircle2, 
  Circle, AlertCircle, Pause, ChevronRight 
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format, isPast, isToday } from 'date-fns';

const priorityConfig = {
  low: { color: 'bg-slate-100 text-slate-600', icon: Flag },
  medium: { color: 'bg-blue-100 text-blue-600', icon: Flag },
  high: { color: 'bg-amber-100 text-amber-600', icon: Flag },
  urgent: { color: 'bg-rose-100 text-rose-600', icon: AlertCircle },
};

const statusConfig = {
  pending: { color: 'text-slate-400', icon: Circle },
  in_progress: { color: 'text-blue-500', icon: Clock },
  on_hold: { color: 'text-amber-500', icon: Pause },
  completed: { color: 'text-emerald-500', icon: CheckCircle2 },
  cancelled: { color: 'text-slate-300', icon: Circle },
};

export default function TaskCard({ task, onClick, index = 0 }) {
  const priority = priorityConfig[task.priority] || priorityConfig.medium;
  const status = statusConfig[task.status] || statusConfig.pending;
  const StatusIcon = status.icon;

  const isDue = task.due_date && isPast(new Date(task.due_date)) && task.status !== 'completed';
  const isDueToday = task.due_date && isToday(new Date(task.due_date));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={() => onClick?.(task)}
      className={`bg-white rounded-xl border p-4 hover:shadow-lg transition-all cursor-pointer group ${
        isDue ? 'border-rose-200 bg-rose-50/50' : 'border-slate-100 hover:border-amber-200'
      }`}
    >
      <div className="flex items-start gap-3">
        <button className={`mt-0.5 ${status.color}`}>
          <StatusIcon className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className={`font-medium ${task.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
            {task.title}
          </h3>
          {task.description && (
            <p className="text-sm text-slate-500 mt-1 line-clamp-2">{task.description}</p>
          )}
          
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <Badge className={priority.color}>
              <priority.icon className="h-3 w-3 mr-1" />
              {task.priority}
            </Badge>
            {task.due_date && (
              <Badge variant="outline" className={isDue ? 'border-rose-300 text-rose-600' : isDueToday ? 'border-amber-300 text-amber-600' : ''}>
                <Clock className="h-3 w-3 mr-1" />
                {format(new Date(task.due_date), 'MMM d, h:mm a')}
              </Badge>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-amber-500 transition-colors" />
      </div>
    </motion.div>
  );
}