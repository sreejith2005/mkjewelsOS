import React from 'react';
import { motion } from 'framer-motion';
import { 
  UserPlus, ClipboardPlus, FileText, Bell,
  Package, Wrench, Calculator, MessageSquare
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

const actions = [
  { icon: UserPlus, label: 'New Customer', page: 'CRM', color: 'bg-blue-500' },
  { icon: ClipboardPlus, label: 'Create Task', page: 'Tasks', color: 'bg-emerald-500' },
  { icon: FileText, label: 'New Form', page: 'Forms', color: 'bg-violet-500' },
  { icon: Bell, label: 'Send Alert', page: 'Notifications', color: 'bg-amber-500' },
  { icon: Package, label: 'Inventory', page: 'Dashboard', color: 'bg-rose-500' },
  { icon: Wrench, label: 'Repair Job', page: 'Workflows', color: 'bg-cyan-500' },
  { icon: Calculator, label: 'Estimate', page: 'Forms', color: 'bg-indigo-500' },
  { icon: MessageSquare, label: 'Follow Up', page: 'CRM', color: 'bg-pink-500' },
];

export default function QuickActions() {
  return (
    <div className="grid grid-cols-4 gap-4">
      {actions.map((action, index) => (
        <motion.div
          key={action.label}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.05 }}
        >
          <Link to={createPageUrl(action.page)}>
            <div className="flex flex-col items-center gap-2 group">
              <div className={`${action.color} w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg group-hover:scale-105 transition-transform`}>
                <action.icon className="h-6 w-6 text-white" />
              </div>
              <span className="text-xs text-slate-600 font-medium text-center">{action.label}</span>
            </div>
          </Link>
        </motion.div>
      ))}
    </div>
  );
}