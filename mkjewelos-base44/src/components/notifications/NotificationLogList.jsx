import React from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Clock, Send, Loader2, SkipForward, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sendNotification } from './notificationEngine';

const statusConfig = {
  queued:    { color: 'bg-slate-100 text-slate-600',   icon: Clock,        label: 'Queued' },
  sending:   { color: 'bg-blue-100 text-blue-600',     icon: Loader2,      label: 'Sending' },
  sent:      { color: 'bg-emerald-100 text-emerald-600', icon: Send,        label: 'Sent' },
  delivered: { color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2, label: 'Delivered' },
  failed:    { color: 'bg-rose-100 text-rose-600',     icon: XCircle,      label: 'Failed' },
  skipped:   { color: 'bg-amber-100 text-amber-600',   icon: SkipForward,  label: 'Skipped' },
};

const channelEmoji = { in_app: '🔔', email: '📧', sms: '📱', whatsapp: '💬', push: '🔕' };

export default function NotificationLogList({ logs, onRetry, loading }) {
  if (loading) {
    return <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-16 bg-slate-100 animate-pulse rounded-xl" />)}</div>;
  }

  if (!logs?.length) {
    return (
      <div className="text-center py-12">
        <Send className="h-10 w-10 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-400 text-sm">No notification logs yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {logs.map((log, i) => {
        const s = statusConfig[log.status] || statusConfig.queued;
        const Icon = s.icon;
        return (
          <motion.div
            key={log.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.02 }}
            className="bg-white rounded-xl border border-slate-100 p-3"
          >
            <div className="flex items-start gap-3">
              <span className="text-lg flex-shrink-0">{channelEmoji[log.channel] || '📨'}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800 truncate">{log.subject || log.event_type}</p>
                  <Badge className={`text-[10px] flex-shrink-0 ${s.color}`}>
                    <Icon className={`h-3 w-3 mr-1 ${log.status === 'sending' ? 'animate-spin' : ''}`} />
                    {s.label}
                  </Badge>
                </div>
                <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{log.body}</p>
                <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400">
                  <span>{log.rule_name || 'Manual'}</span>
                  {log.retry_count > 0 && <span>· {log.retry_count} retries</span>}
                  {log.sent_at && <span>· {format(new Date(log.sent_at), 'MMM d h:mm a')}</span>}
                  {!log.sent_at && log.created_date && <span>· {format(new Date(log.created_date), 'MMM d h:mm a')}</span>}
                </div>
                {log.error_message && (
                  <p className="text-[10px] text-rose-500 mt-1">⚠ {log.error_message}</p>
                )}
              </div>
              {log.status === 'failed' && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-slate-400 hover:text-blue-500 flex-shrink-0"
                  onClick={() => onRetry?.(log)}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}