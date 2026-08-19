import React from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { 
  User, ClipboardList, FileText, Bell, 
  CheckCircle2, Clock, AlertCircle
} from 'lucide-react';

const iconMap = {
  customer: User,
  task: ClipboardList,
  form: FileText,
  notification: Bell,
};

const statusColors = {
  completed: 'bg-emerald-100 text-emerald-600',
  pending: 'bg-amber-100 text-amber-600',
  urgent: 'bg-rose-100 text-rose-600',
};

export default function RecentActivity({ activities = [] }) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-8">
        <Clock className="h-8 w-8 text-slate-300 mx-auto mb-2" />
        <p className="text-slate-500 text-sm">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activities.slice(0, 5).map((activity, index) => {
        const Icon = iconMap[activity.type] || Bell;
        return (
          <motion.div
            key={activity.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.1 }}
            className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <div className={`p-2 rounded-lg ${statusColors[activity.status] || 'bg-slate-100 text-slate-600'}`}>
              <Icon className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-slate-800 truncate">{activity.title}</p>
              <p className="text-xs text-slate-500 truncate">{activity.description}</p>
            </div>
            <span className="text-xs text-slate-400 whitespace-nowrap">
              {format(new Date(activity.created_date), 'h:mm a')}
            </span>
          </motion.div>
        );
      })}
    </div>
  );
}