const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { Bell, Mail, MessageSquare, Phone, CheckCircle2 } from 'lucide-react';

const channelIcons = {
  in_app: Bell,
  email: Mail,
  whatsapp: MessageSquare,
  sms: Phone,
  push: Bell,
};

const priorityBorder = {
  urgent: 'border-l-rose-500',
  high: 'border-l-amber-500',
  normal: 'border-l-blue-400',
  low: 'border-l-slate-300',
};

export default function NotificationItem({ notification, onRead, index = 0 }) {
  const Icon = channelIcons[notification.channel] || Bell;
  const isUnread = !notification.is_read;

  const handleRead = async () => {
    if (!isUnread) return;
    await db.entities.Notification.update(notification.id, {
      is_read: true,
      read_at: new Date().toISOString(),
    });
    onRead?.();
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03 }}
      onClick={handleRead}
      className={`
        flex items-start gap-3 p-4 rounded-2xl border-l-4 cursor-pointer transition-all
        ${priorityBorder[notification.priority] || priorityBorder.normal}
        ${isUnread ? 'bg-white shadow-sm' : 'bg-slate-50/60'}
      `}
    >
      <div className={`
        w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0
        ${isUnread ? 'bg-blue-100' : 'bg-slate-100'}
      `}>
        <Icon className={`h-4 w-4 ${isUnread ? 'text-blue-600' : 'text-slate-400'}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={`text-sm leading-snug ${isUnread ? 'font-semibold text-slate-800' : 'font-normal text-slate-600'}`}>
            {notification.title}
          </p>
          {isUnread && <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0 mt-1" />}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{notification.message}</p>
        <p className="text-[10px] text-slate-400 mt-1">
          {notification.sent_at
            ? format(new Date(notification.sent_at), 'MMM d · h:mm a')
            : format(new Date(notification.created_date), 'MMM d · h:mm a')}
        </p>
      </div>
    </motion.div>
  );
}