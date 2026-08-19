import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Clock, CheckCircle2, Circle, AlertCircle, 
  ChevronDown, ChevronUp, UserCheck, Repeat,
  Flag, MoreVertical, GitBranch
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { format, isPast } from 'date-fns';
import { calcChecklistPct } from '@/components/tasks/recurringTaskEngine';

const priorityConfig = {
  low: 'bg-slate-100 text-slate-500',
  medium: 'bg-blue-100 text-blue-600',
  high: 'bg-amber-100 text-amber-600',
  urgent: 'bg-rose-100 text-rose-600',
};

const recurrenceIcon = {
  daily: '📅',
  weekly: '📆',
  monthly: '🗓️',
  yearly: '🎯',
  once: '☝️',
};

export default function TaskInstanceCard({ 
  task, 
  onChecklistToggle, 
  onComplete, 
  onDelegate, 
  onOpen,
  currentUserId,
  index = 0 
}) {
  const [expanded, setExpanded] = useState(false);
  const { pct, allRequiredDone } = calcChecklistPct(task.checklist);
  const isOverdue = task.due_date && isPast(new Date(task.due_date)) && task.status !== 'completed';
  const isCompleted = task.status === 'completed';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className={`bg-white rounded-2xl border overflow-hidden transition-all ${
        isCompleted ? 'border-emerald-200 opacity-75' :
        isOverdue ? 'border-rose-200' :
        'border-slate-100 hover:border-amber-200'
      }`}
    >
      {/* Top Bar */}
      <div
        className="flex items-start gap-3 p-4 cursor-pointer"
        onClick={() => onOpen?.(task)}
      >
        {/* Status icon */}
        <button
          onClick={(e) => { e.stopPropagation(); !isCompleted && allRequiredDone && onComplete?.(task); }}
          className="mt-0.5 flex-shrink-0"
        >
          {isCompleted ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          ) : allRequiredDone ? (
            <CheckCircle2 className="h-5 w-5 text-slate-300 hover:text-emerald-400 transition-colors" />
          ) : (
            <Circle className="h-5 w-5 text-slate-300" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-base">{recurrenceIcon[task.recurrence_type] || '📋'}</span>
            <h3 className={`font-semibold text-sm ${isCompleted ? 'line-through text-slate-400' : 'text-slate-800'}`}>
              {task.title}
            </h3>
            {task.is_delegated && (
              <Badge className="bg-violet-100 text-violet-600 text-[10px] px-1.5 py-0">delegated</Badge>
            )}
          </div>

          <div className="flex items-center gap-2 mt-1.5 flex-wrap">
            <Badge className={`text-[10px] px-1.5 ${priorityConfig[task.priority] || priorityConfig.medium}`}>
              {task.priority}
            </Badge>
            {task.category && (
              <span className="text-[10px] text-slate-400 capitalize">{task.category}</span>
            )}
            {task.due_date && (
              <span className={`text-[10px] flex items-center gap-0.5 ${isOverdue ? 'text-rose-500 font-medium' : 'text-slate-400'}`}>
                <Clock className="h-3 w-3" />
                {format(new Date(task.due_date), 'h:mm a')}
                {isOverdue && ' OVERDUE'}
              </span>
            )}
          </div>

          {/* Checklist mini-progress */}
          {task.checklist?.length > 0 && (
            <div className="mt-2">
              <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                <span>{task.checklist.filter(c => c.completed).length}/{task.checklist.length} items</span>
                <span>{pct}%</span>
              </div>
              <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    pct === 100 ? 'bg-emerald-400' : pct > 50 ? 'bg-amber-400' : 'bg-blue-400'
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {task.checklist?.length > 0 && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Expandable Checklist */}
      <AnimatePresence>
        {expanded && task.checklist?.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="border-t border-slate-100 px-4 py-3 space-y-2 bg-slate-50">
              {task.checklist.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    checked={item.completed}
                    disabled={isCompleted}
                    onCheckedChange={(checked) => onChecklistToggle?.(task, item.id, checked)}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <span className={`text-sm ${item.completed ? 'line-through text-slate-400' : 'text-slate-700'}`}>
                      {item.item}
                    </span>
                    {item.required && !item.completed && (
                      <span className="text-rose-400 text-[10px] ml-1">*required</span>
                    )}
                  </div>
                </div>
              ))}

              {/* Action buttons */}
              {!isCompleted && (
                <div className="flex gap-2 pt-2 border-t border-slate-200">
                  {allRequiredDone && (
                    <Button
                      size="sm"
                      onClick={(e) => { e.stopPropagation(); onComplete?.(task); }}
                      className="flex-1 h-8 bg-emerald-500 hover:bg-emerald-600 text-xs"
                    >
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Mark Complete
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => { e.stopPropagation(); onDelegate?.(task); }}
                    className="h-8 text-xs"
                  >
                    <UserCheck className="h-3 w-3 mr-1" />
                    Delegate
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}