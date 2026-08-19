const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { 
  CheckCircle2, Clock, XCircle, Eye, ChevronDown, ChevronUp,
  User, Calendar, Link, Archive, ThumbsUp, ThumbsDown
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

const statusConfig = {
  submitted: { color: 'bg-blue-100 text-blue-700', icon: Clock, label: 'Submitted' },
  under_review: { color: 'bg-amber-100 text-amber-700', icon: Eye, label: 'Under Review' },
  approved: { color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2, label: 'Approved' },
  rejected: { color: 'bg-rose-100 text-rose-700', icon: XCircle, label: 'Rejected' },
  archived: { color: 'bg-slate-100 text-slate-500', icon: Archive, label: 'Archived' },
};

export default function SubmissionViewer({ submission, onStatusChange, canReview = false, index = 0 }) {
  const [expanded, setExpanded] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const status = statusConfig[submission.status] || statusConfig.submitted;
  const StatusIcon = status.icon;

  const handleReview = async (newStatus) => {
    setReviewing(true);
    await db.entities.FormSubmission.update(submission.id, {
      status: newStatus,
      review_notes: reviewNote,
      reviewed_at: new Date().toISOString(),
    });
    setReviewing(false);
    onStatusChange?.();
  };

  const dataEntries = Object.entries(submission.data_display || submission.data || {});

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="bg-white rounded-2xl border border-slate-100 overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-start gap-3 p-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-slate-800 truncate">{submission.form_name}</p>
            <Badge className={status.color}>
              <StatusIcon className="h-3 w-3 mr-1" />
              {status.label}
            </Badge>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {submission.submitter_name || 'Unknown'}
            </span>
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {format(new Date(submission.created_date), 'MMM d, h:mm a')}
            </span>
            {submission.linked_entity_type && (
              <span className="flex items-center gap-1">
                <Link className="h-3 w-3" />
                {submission.linked_entity_type}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
        >
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {/* Quick preview (first 2 fields) */}
      {!expanded && dataEntries.length > 0 && (
        <div className="px-4 pb-3 flex gap-2 flex-wrap">
          {dataEntries.slice(0, 2).map(([label, value]) => (
            <div key={label} className="bg-slate-50 rounded-lg px-3 py-1.5">
              <p className="text-[10px] text-slate-400">{label}</p>
              <p className="text-xs font-medium text-slate-700 truncate max-w-32">{String(value)}</p>
            </div>
          ))}
          {dataEntries.length > 2 && (
            <div className="bg-slate-50 rounded-lg px-3 py-1.5">
              <p className="text-xs text-slate-400">+{dataEntries.length - 2} more</p>
            </div>
          )}
        </div>
      )}

      {/* Expanded Data */}
      {expanded && (
        <div className="border-t border-slate-100 bg-slate-50/50">
          <div className="p-4 grid grid-cols-2 gap-3">
            {dataEntries.map(([label, value]) => (
              <div key={label} className={`bg-white rounded-xl p-3 border border-slate-100 ${String(value).length > 30 ? 'col-span-2' : 'col-span-1'}`}>
                <p className="text-[10px] text-slate-400 mb-0.5">{label}</p>
                <p className="text-sm text-slate-800 break-words">{String(value)}</p>
              </div>
            ))}
          </div>

          {/* Review Section */}
          {canReview && submission.status === 'submitted' && (
            <div className="px-4 pb-4 space-y-3 border-t border-slate-100">
              <Textarea
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Add review notes (optional)..."
                className="h-16 text-sm resize-none mt-3"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleReview('approved')}
                  disabled={reviewing}
                  className="flex-1 bg-emerald-500 hover:bg-emerald-600 h-9"
                >
                  <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  onClick={() => handleReview('rejected')}
                  disabled={reviewing}
                  variant="outline"
                  className="flex-1 border-rose-200 text-rose-600 hover:bg-rose-50 h-9"
                >
                  <ThumbsDown className="h-3.5 w-3.5 mr-1" />
                  Reject
                </Button>
              </div>
            </div>
          )}

          {submission.review_notes && (
            <div className="px-4 pb-4">
              <p className="text-xs text-slate-400">Review Notes:</p>
              <p className="text-sm text-slate-700 mt-1">{submission.review_notes}</p>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}