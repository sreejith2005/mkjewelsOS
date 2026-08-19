const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { motion } from 'framer-motion';
import {
  ArrowLeft, CheckCircle, Clock, AlertTriangle, Play,
  User, FileText, MessageSquare, ChevronDown, ChevronUp, Send
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { format } from 'date-fns';
import FormRenderer from '@/components/forms/FormRenderer';

const STEP_STATUS_CONFIG = {
  pending:     { label: 'Pending',     color: 'bg-slate-100 text-slate-500',     dot: 'bg-slate-300' },
  active:      { label: 'Active',      color: 'bg-blue-100 text-blue-700',       dot: 'bg-blue-500' },
  in_progress: { label: 'In Progress', color: 'bg-indigo-100 text-indigo-700',   dot: 'bg-indigo-500' },
  completed:   { label: 'Done',        color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  skipped:     { label: 'Skipped',     color: 'bg-slate-100 text-slate-400',     dot: 'bg-slate-300' },
  overdue:     { label: 'Overdue',     color: 'bg-red-100 text-red-600',         dot: 'bg-red-500' },
};

export default function FMSInstanceDetail({ instance, onBack, userProfile, user }) {
  const [inst, setInst] = useState(instance);
  const [expandedStep, setExpandedStep] = useState(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [flow, setFlow] = useState(null);
  const [forms, setForms] = useState({});
  const [formSubmitted, setFormSubmitted] = useState({}); // stepId -> true

  useEffect(() => {
    if (inst.flow_id) {
      db.entities.FMSFlow.filter({ id: inst.flow_id }).then(res => {
        if (res.length) {
          const f = res[0];
          setFlow(f);
          // Load form templates for all steps that have form_id
          const formIds = [...new Set((f.steps || []).filter(s => s.form_id).map(s => s.form_id))];
          if (formIds.length > 0) {
            db.entities.FormTemplate.list('-created_date', 200).then(allForms => {
              const map = {};
              allForms.forEach(fm => { map[fm.id] = fm; });
              setForms(map);
            });
          }
        }
      });
    }
    // Auto-expand first active step
    const firstActive = inst.step_states?.find(s => s.status === 'active' || s.status === 'in_progress');
    if (firstActive) setExpandedStep(firstActive.step_id);
  }, []);

  const getFlowStep = (stepId) => flow?.steps?.find(s => s.id === stepId);

  const completeStep = async (stepState) => {
    setSaving(true);
    const now = new Date().toISOString();
    const updatedStates = inst.step_states.map(s => {
      if (s.step_id === stepState.step_id) {
        const delay = s.planned_at
          ? Math.max(0, Math.round((new Date(now) - new Date(s.planned_at)) / 60000))
          : 0;
        return {
          ...s,
          status: 'completed',
          completed_at: now,
          completed_by: userProfile?.user_id || '',
          delay_minutes: delay,
          sla_breached: delay > 0,
          notes,
        };
      }
      return s;
    });

    const flowStep = getFlowStep(stepState.step_id);
    let nextStepId = flowStep?.next_step_id;

    let newCurrentSteps = inst.current_step_ids.filter(id => id !== stepState.step_id);
    if (nextStepId) {
      updatedStates.forEach(s => {
        if (s.step_id === nextStepId) s.status = 'active';
      });
      newCurrentSteps = [...newCurrentSteps, nextStepId];
    }

    const allDone = updatedStates.every(s => s.status === 'completed' || s.status === 'skipped');
    const totalDelay = updatedStates.reduce((sum, s) => sum + (s.delay_minutes || 0), 0);

    const updated = {
      ...inst,
      step_states: updatedStates,
      current_step_ids: newCurrentSteps,
      status: allDone ? 'completed' : 'active',
      completed_at: allDone ? now : undefined,
      total_delay_minutes: totalDelay,
    };
    await db.entities.FMSInstance.update(inst.id, updated);
    setInst(updated);
    setNotes('');
    setSaving(false);
  };

  const completedCount = (inst.step_states || []).filter(s => s.status === 'completed').length;
  const totalCount = (inst.step_states || []).length;
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-900 to-purple-900 px-4 pt-16 pb-6">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="p-2 rounded-xl bg-white/10 text-white">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-white truncate">{inst.title}</h2>
            <p className="text-indigo-300 text-xs">{inst.flow_name} · {inst.reference_number}</p>
          </div>
          <Badge className={`text-xs ${inst.status === 'completed' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-blue-500/20 text-blue-300'}`}>
            {inst.status}
          </Badge>
        </div>

        {/* Progress bar */}
        <div className="mb-2">
          <div className="flex items-center justify-between text-xs text-indigo-300 mb-1">
            <span>{completedCount}/{totalCount} steps done</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-2 bg-white/10 rounded-full overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.5 }}
              className="h-full bg-amber-400 rounded-full"
            />
          </div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-3">
        {/* Context */}
        {inst.context?.notes && (
          <div className="bg-amber-50 border border-amber-100 rounded-2xl p-3">
            <p className="text-xs font-semibold text-amber-700 mb-1">Opening Notes</p>
            <p className="text-sm text-amber-800">{inst.context.notes}</p>
          </div>
        )}

        {/* Steps */}
        <div className="space-y-2">
          {(inst.step_states || []).map((stepState, idx) => {
            const sc = STEP_STATUS_CONFIG[stepState.status] || STEP_STATUS_CONFIG.pending;
            const isExpanded = expandedStep === stepState.step_id;
            const isActionable = stepState.status === 'active' || stepState.status === 'in_progress';
            const flowStep = getFlowStep(stepState.step_id);
            const linkedForm = flowStep?.form_id ? forms[flowStep.form_id] : null;
            const stepFormDone = formSubmitted[stepState.step_id];

            return (
              <motion.div
                key={stepState.step_id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.04 }}
                className={`bg-white rounded-2xl border-2 transition-all ${
                  isActionable ? 'border-indigo-300 shadow-md' :
                  stepState.status === 'completed' ? 'border-emerald-200' :
                  'border-slate-100'
                }`}
              >
                <div
                  className="p-4 flex items-center gap-3 cursor-pointer"
                  onClick={() => setExpandedStep(isExpanded ? null : stepState.step_id)}
                >
                  {/* Status indicator */}
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${sc.color}`}>
                    {stepState.status === 'completed' ? (
                      <CheckCircle className="h-4 w-4" />
                    ) : stepState.status === 'overdue' ? (
                      <AlertTriangle className="h-4 w-4" />
                    ) : isActionable ? (
                      <Play className="h-4 w-4" />
                    ) : (
                      <span className="text-xs font-bold">{idx + 1}</span>
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-slate-800 text-sm">{stepState.step_name}</p>
                      <Badge className={`text-[9px] px-1.5 ${sc.color}`}>{sc.label}</Badge>
                      {linkedForm && (
                        <Badge className="text-[9px] px-1.5 bg-blue-100 text-blue-600">
                          <FileText className="h-2.5 w-2.5 mr-0.5 inline" />
                          {linkedForm.name}
                        </Badge>
                      )}
                      {stepState.sla_breached && (
                        <Badge className="text-[9px] px-1.5 bg-red-100 text-red-600">⚠ {stepState.delay_minutes}m late</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-400">
                      {stepState.assigned_to_name && (
                        <span className="flex items-center gap-0.5">
                          <User className="h-2.5 w-2.5" />
                          {stepState.assigned_to_name}
                        </span>
                      )}
                      {stepState.planned_at && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-2.5 w-2.5" />
                          Due {format(new Date(stepState.planned_at), 'dd MMM HH:mm')}
                        </span>
                      )}
                      {stepState.completed_at && (
                        <span className="flex items-center gap-0.5 text-emerald-500">
                          <CheckCircle className="h-2.5 w-2.5" />
                          {format(new Date(stepState.completed_at), 'dd MMM HH:mm')}
                        </span>
                      )}
                    </div>
                  </div>

                  {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-300 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-slate-300 flex-shrink-0" />}
                </div>

                {/* Expanded */}
                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-slate-100 pt-3 space-y-3">
                    {stepState.notes && (
                      <div className="bg-slate-50 rounded-xl p-3">
                        <p className="text-xs font-medium text-slate-600 mb-1">Notes</p>
                        <p className="text-xs text-slate-700">{stepState.notes}</p>
                      </div>
                    )}

                    {/* Linked Form — show inline if active */}
                    {isActionable && linkedForm && !stepFormDone && (
                      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                        <div className="flex items-center gap-2 mb-3">
                          <FileText className="h-4 w-4 text-blue-600" />
                          <p className="font-semibold text-blue-700 text-sm">Required Form: {linkedForm.name}</p>
                        </div>
                        <FormRenderer
                          form={linkedForm}
                          userProfile={userProfile}
                          user={user}
                          linkedEntityType="FMSInstance"
                          linkedEntityId={inst.id}
                          linkedEntityName={inst.title}
                          onSuccess={() => setFormSubmitted(prev => ({ ...prev, [stepState.step_id]: true }))}
                          onCancel={() => {}}
                          compact={true}
                        />
                      </div>
                    )}

                    {isActionable && linkedForm && stepFormDone && (
                      <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                        <CheckCircle className="h-4 w-4 text-emerald-600" />
                        <p className="text-sm text-emerald-700 font-medium">Form submitted ✓</p>
                      </div>
                    )}

                    {isActionable && (
                      <>
                        {/* If there's a required form that hasn't been submitted, block completion */}
                        {linkedForm && !stepFormDone ? (
                          <p className="text-xs text-amber-600 text-center py-2">
                            ⚠ Please submit the form above before completing this step
                          </p>
                        ) : (
                          <>
                            <Textarea
                              value={notes}
                              onChange={e => setNotes(e.target.value)}
                              placeholder="Add completion notes (optional)…"
                              className="h-16 resize-none text-sm"
                            />
                            <Button
                              onClick={() => completeStep(stepState)}
                              disabled={saving}
                              className="w-full bg-emerald-600 hover:bg-emerald-700 rounded-xl"
                            >
                              <CheckCircle className="h-4 w-4 mr-2" />
                              {saving ? 'Saving…' : 'Mark Step Complete'}
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Completed banner */}
        {inst.status === 'completed' && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 text-center">
            <CheckCircle className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
            <p className="font-bold text-emerald-700">Flow Completed!</p>
            {inst.completed_at && (
              <p className="text-xs text-emerald-600 mt-1">
                Finished {format(new Date(inst.completed_at), 'dd MMM yyyy HH:mm')}
              </p>
            )}
            {inst.total_delay_minutes > 0 && (
              <p className="text-xs text-amber-600 mt-1">Total delay: {inst.total_delay_minutes} minutes</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}