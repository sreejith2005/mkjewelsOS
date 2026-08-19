import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { Bell } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function NotificationBell({ unreadCount }) {
  return (
    <Link
      to={createPageUrl('Notifications')}
      className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-slate-800/50 hover:bg-slate-700/50 transition-all"
    >
      <Bell className="h-4.5 w-4.5 text-slate-300" />
      <AnimatePresence>
        {unreadCount > 0 && (
          <motion.div
            key="badge"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-rose-500 rounded-full flex items-center justify-center px-1"
          >
            <span className="text-white text-[9px] font-bold leading-none">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </Link>
  );
}