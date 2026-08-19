import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, Plus, Save, Settings2, Trash2, GitBranch, Zap,
  Clock, Users, FileText, CheckSquare, ArrowRight, AlignJustify,
  ChevronDown, ChevronUp, PlusCircle, Layers, Merge, Flag,
  ToggleLeft, Link2, Copy, MoveVertical
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import StepEditor from './StepEditor';

const STEP_TYPES = [
  { type: 'task',           label: 'Task',            icon: CheckSquare, color: 'bg-indigo-500', desc: 'Standard doer task' },
  { type: 'form',           label: 'Form',            icon: FileText,    color: 'bg-blue-500',   desc: 'Fill & submit a form' },
  { type: 'approval',       label: 'Approval',        icon: Users,       color: 'bg-amber-500',  desc: 'Requires sign-off' },
  { type: 'branch',         label: 'Branch',          icon: GitBranch,   color: 'bg-rose-500',   desc: 'If/else condition' },
  { type: 'parallel_start', label: 'Parallel Start',  icon: Layers,      color: 'bg-purple-500', desc: 'Split into parallel steps' },
  { type: 'parallel_join',  label: 'Parallel Join',   icon: Merge,       color: 'bg-purple-700', desc: 'Merge parallel paths' },
  { type: 'notification',   label: 'Notification',    icon: Zap,         color: 'bg-yellow-500', desc: 'Send alert/message' },
  { type: 'end',            label: 'End',             icon: Flag,        color: 'bg-slate-500',  desc: 'Flow completion' },
];

const STEP_TYPE_MAP = Object.fromEntries(STEP_TYPES.map(s => [s.type, s]));

function generateId() {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export default function FlowBuilder({ flow, userProfile, onSave, onBack }) {
  const [meta, setMeta] = useState({
    name: flow?.name || '',
    description: flow?.description || '',
    category: flow?.category || 'custom',
    trigger_type: flow?.trigger_type || 'manual',
    is_active: flow?.is_active !== false,
    tenant_id: flow?.tenant_id || userProfile?.tenant_id || 'default',
    branch_id: flow?.branch_id || userProfile?.branch_id || '',
  });
  const [steps, setSteps] = useState(flow?.steps || []);
  const [editingStep, setEditingStep] = useState(null);
  const [showPalette, setShowPalette] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showMeta, setShowMeta] = useState(!flow?.id);

  const addStep = (type) => {
    const typeConfig = STEP_TYPE_MAP[type];
    const newStep = {
      id: generateId(),
      name: typeConfig.label,
      description: '',
      type,
      order: steps.length,
      is_required: true,
      assignee_rule: { type: 'role', value: 'staff', allow_next_step_selection: false },
      sla_rule: { type: 'relative_to_prev_step', minutes: 60, business_hours_only: false, exclude_week_offs: true },
      branches: type === 'branch' ? [
        { id: generateId(), label: 'Yes', condition_field: 'status', condition_operator: 'equals', condition_value: 'yes', next_step_id: '' },
        { id: generateId(), label: 'No', condition_field: 'status', condition_operator: 'equals', condition_value: 'no', next_step_id: '' },
      ] : [],
      parallel_step_ids: type === 'parallel_start' ? [] : undefined,
      join_rule: type === 'parallel_join' ? 'all' : undefined,
      completion_rule: 'any_doer',
      next_step_id: '',
      color: typeConfig.color,
    };
    setSteps(prev => [...prev, newStep]);
    setEditingStep(newStep);
    setShowPalette(false);
  };

  const updateStep = (updated) => {
    setSteps(prev => prev.map(s => s.id === updated.id ? updated : s));
    setEditingStep(updated);
  };

  const deleteStep = (id) => {
    setSteps(prev => prev.filter(s => s.id !== id).map((s, i) => ({ ...s, order: i })));
    setEditingStep(null);
  };

  const moveStep = (index, dir) => {
    const arr = [...steps];
    const target = dir === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= arr.length) return;
    [arr[index], arr[target]] = [arr[target], arr[index]];
    setSteps(arr.map((s, i) => ({ ...s, order: i })));
  };

  const handleSave = async () => {
    if (!meta.name) return;
    setSaving(true);
    await onSave({ ...meta, steps: steps.map((s, i) => ({ ...s, order: i })) });
    setSaving(false);
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-28">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-900 to-purple-900 px-4 pt-16 pb-4 sticky top-0 z-20">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onBack} className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-white truncate">{meta.name || 'Untitled Flow'}</h2>
            <p className="text-indigo-300 text-xs">{steps.length} steps · {meta.category}</p>
          </div>
          <button
            onClick={() => setShowMeta(v => !v)}
            className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20 transition-colors"
          >
            <Settings2 className="h-4 w-4" />
          </button>
          <Button
            onClick={handleSave}
            disabled={saving || !meta.name}
            className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm px-4 h-9"
          >
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        {/* Meta Panel */}
        <AnimatePresence>
          {showMeta && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="bg-white rounded-2xl border border-slate-100 p-4 space-y-3 overflow-hidden"
            >
              <h3 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-indigo-500" />
                Flow Settings
              </h3>
              <div>
                <Label className="text-xs">Flow Name *</Label>
                <Input
                  value={meta.name}
                  onChange={e => setMeta(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Instagram Lead Journey"
                  className="mt-1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Category</Label>
                  <Select value={meta.category} onValueChange={v => setMeta(p => ({ ...p, category: v }))}>
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {['sales','crm','repair','order','hr','inventory','custom'].map(c => (
                        <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Trigger</Label>
                  <Select value={meta.trigger_type} onValueChange={v => setMeta(p => ({ ...p, trigger_type: v }))}>
                    <SelectTrigger className="mt-1 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        { v: 'manual', l: 'Manual' },
                        { v: 'on_customer_create', l: 'Customer Created' },
                        { v: 'on_task_complete', l: 'Task Completed' },
                        { v: 'form_submit', l: 'Form Submitted' },
                      ].map(t => (
                        <SelectItem key={t.v} value={t.v} className="text-xs">{t.l}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-xs">Description</Label>
                <Textarea
                  value={meta.description}
                  onChange={e => setMeta(p => ({ ...p, description: e.target.value }))}
                  placeholder="Describe this flow's purpose…"
                  className="mt-1 h-16 resize-none text-xs"
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={meta.is_active}
                  onCheckedChange={v => setMeta(p => ({ ...p, is_active: v }))}
                />
                <span className="text-xs text-slate-600">Active</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Steps Canvas */}
        <div className="bg-white rounded-2xl border border-slate-100 p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-700 flex items-center gap-2">
              <AlignJustify className="h-4 w-4 text-indigo-500" />
              Steps
              <span className="text-sm font-normal text-slate-400">({steps.length})</span>
            </h3>
            <button
              onClick={() => setShowPalette(v => !v)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-xl text-xs font-semibold hover:bg-indigo-100 transition-colors"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              Add Step
            </button>
          </div>

          {/* Field Palette */}
          <AnimatePresence>
            {showPalette && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 overflow-hidden"
              >
                <div className="grid grid-cols-2 gap-2 p-3 bg-indigo-50 rounded-xl">
                  {STEP_TYPES.map(s => (
                    <button
                      key={s.type}
                      onClick={() => addStep(s.type)}
                      className="flex items-center gap-2 p-2.5 bg-white rounded-xl border border-slate-100 hover:border-indigo-300 hover:shadow-sm transition-all text-left group"
                    >
                      <div className={`w-7 h-7 rounded-lg ${s.color} flex items-center justify-center flex-shrink-0`}>
                        <s.icon className="h-3.5 w-3.5 text-white" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-700">{s.label}</p>
                        <p className="text-[10px] text-slate-400 leading-tight">{s.desc}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {steps.length === 0 ? (
            <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
              <GitBranch className="h-10 w-10 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 font-medium text-sm mb-1">No steps yet</p>
              <p className="text-slate-400 text-xs mb-4">Click "Add Step" to start building your flow</p>
            </div>
          ) : (
            <div className="space-y-1">
              {steps.map((step, idx) => {
                const typeConfig = STEP_TYPE_MAP[step.type] || STEP_TYPE_MAP.task;
                const isEditing = editingStep?.id === step.id;
                return (
                  <div key={step.id}>
                    {/* Connection line */}
                    {idx > 0 && (
                      <div className="flex justify-center py-0.5">
                        <div className="w-px h-4 bg-slate-200" />
                      </div>
                    )}
                    <motion.div
                      layout
                      className={`border-2 rounded-2xl transition-all cursor-pointer ${
                        isEditing
                          ? 'border-indigo-400 bg-indigo-50/50 shadow-md'
                          : 'border-slate-100 bg-white hover:border-indigo-200 hover:shadow-sm'
                      }`}
                      onClick={() => setEditingStep(isEditing ? null : step)}
                    >
                      <div className="p-3 flex items-center gap-3">
                        {/* Step type icon */}
                        <div className={`w-9 h-9 rounded-xl ${typeConfig.color} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                          <typeConfig.icon className="h-4 w-4 text-white" />
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-slate-800 text-sm">{step.name}</span>
                            <Badge className={`text-[9px] px-1.5 py-0.5 ${
                              step.type === 'branch' ? 'bg-rose-100 text-rose-600' :
                              step.type === 'parallel_start' ? 'bg-purple-100 text-purple-600' :
                              step.type === 'form' ? 'bg-blue-100 text-blue-600' :
                              step.type === 'approval' ? 'bg-amber-100 text-amber-600' :
                              'bg-indigo-100 text-indigo-600'
                            }`}>
                              {typeConfig.label}
                            </Badge>
                            {step.is_required === false && (
                              <Badge className="text-[9px] px-1.5 py-0.5 bg-slate-100 text-slate-500">Optional</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-slate-400">
                            <span className="flex items-center gap-0.5">
                              <Clock className="h-2.5 w-2.5" />
                              {step.sla_rule?.minutes ? `${step.sla_rule.minutes}m SLA` : 'No SLA'}
                            </span>
                            <span className="flex items-center gap-0.5">
                              <Users className="h-2.5 w-2.5" />
                              {step.assignee_rule?.type?.replace('_', ' ')}
                            </span>
                            {step.branches?.length > 0 && (
                              <span className="flex items-center gap-0.5 text-rose-500">
                                <GitBranch className="h-2.5 w-2.5" />
                                {step.branches.length} branches
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Controls */}
                        <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
                          <button
                            onClick={() => moveStep(idx, 'up')}
                            disabled={idx === 0}
                            className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-300 hover:text-slate-500 disabled:opacity-20"
                          >
                            <ChevronUp className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => moveStep(idx, 'down')}
                            disabled={idx === steps.length - 1}
                            className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-300 hover:text-slate-500 disabled:opacity-20"
                          >
                            <ChevronDown className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => deleteStep(step.id)}
                            className="w-6 h-6 rounded-lg flex items-center justify-center text-slate-300 hover:text-rose-500"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>

                      {/* Branch preview */}
                      {step.type === 'branch' && step.branches?.length > 0 && (
                        <div className="px-3 pb-3 flex gap-2 flex-wrap">
                          {step.branches.map(b => (
                            <span key={b.id} className="text-[10px] bg-rose-50 text-rose-600 border border-rose-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                              <ArrowRight className="h-2.5 w-2.5" />
                              {b.label}
                            </span>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  </div>
                );
              })}

              {/* End indicator */}
              {steps.length > 0 && steps[steps.length - 1]?.type !== 'end' && (
                <div className="flex flex-col items-center py-2">
                  <div className="w-px h-4 bg-slate-200" />
                  <div className="w-6 h-6 rounded-full border-2 border-dashed border-slate-300 flex items-center justify-center">
                    <Flag className="h-3 w-3 text-slate-300" />
                  </div>
                  <span className="text-[10px] text-slate-300 mt-1">End of flow</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Step Editor Sheet */}
      <Sheet open={!!editingStep} onOpenChange={(open) => { if (!open) setEditingStep(null); }}>
        <SheetContent side="bottom" className="h-[85vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2 text-base">
              {editingStep && (() => {
                const tc = STEP_TYPE_MAP[editingStep.type];
                return tc ? (
                  <>
                    <div className={`w-7 h-7 rounded-lg ${tc.color} flex items-center justify-center`}>
                      <tc.icon className="h-3.5 w-3.5 text-white" />
                    </div>
                    Edit Step: {editingStep.name}
                  </>
                ) : null;
              })()}
            </SheetTitle>
          </SheetHeader>
          {editingStep && (
            <StepEditor
              step={editingStep}
              allSteps={steps}
              onUpdate={updateStep}
              onDelete={() => deleteStep(editingStep.id)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}