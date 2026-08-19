const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Trash2, Plus, GitBranch, X, Clock, Users, Layers } from 'lucide-react';

const ASSIGNEE_RULES = [
  { value: 'specific_user', label: 'Specific User' },
  { value: 'role', label: 'By Role' },
  { value: 'department_head', label: 'Department Head' },
  { value: 'manager', label: 'Branch Manager' },
  { value: 'previous_step_doer', label: 'Prev Step Doer' },
  { value: 'reporter', label: 'Flow Initiator' },
];

const SLA_RULE_TYPES = [
  { value: 'fixed_minutes', label: 'Fixed Minutes from Start' },
  { value: 'relative_to_prev_step', label: 'After Prev Step Completion' },
  { value: 'relative_to_start', label: 'After Flow Start' },
  { value: 'business_hours', label: 'Business Hours Based' },
];

const ROLES = ['super_admin','tenant_admin','branch_manager','department_head','team_lead','staff'];
const OPERATORS = ['equals','not_equals','contains','gt','lt','is_empty'];
const JOIN_RULES = [
  { value: 'all', label: 'All parallel steps complete' },
  { value: 'any', label: 'Any one completes' },
  { value: 'specific', label: 'Specific steps complete' },
];
const COMPLETION_RULES = [
  { value: 'any_doer', label: 'Any assigned doer' },
  { value: 'all_doers', label: 'All assigned doers' },
  { value: 'majority', label: 'Majority of doers' },
];

function generateId() {
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
}

export default function StepEditor({ step, allSteps, onUpdate, onDelete }) {
  const [forms, setForms] = useState([]);

  useEffect(() => {
    db.entities.FormTemplate.list('-created_date', 200).then(setForms).catch(() => {});
  }, []);

  const update = (key, val) => onUpdate({ ...step, [key]: val });
  const updateNested = (obj, key, val) => onUpdate({ ...step, [obj]: { ...step[obj], [key]: val } });

  const otherSteps = allSteps.filter(s => s.id !== step.id);

  const addBranch = () => {
    update('branches', [...(step.branches || []), {
      id: generateId(), label: 'New Branch', condition_field: '', condition_operator: 'equals', condition_value: '', next_step_id: ''
    }]);
  };

  const updateBranch = (idx, key, val) => {
    const branches = [...(step.branches || [])];
    branches[idx] = { ...branches[idx], [key]: val };
    update('branches', branches);
  };

  const removeBranch = (idx) => {
    update('branches', step.branches.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-5 pb-8">
      {/* Basic */}
      <Section title="Basic Info" icon={<Users className="h-4 w-4 text-indigo-500" />}>
        <Field label="Step Name *">
          <Input value={step.name} onChange={e => update('name', e.target.value)} placeholder="e.g. Qualification Call" className="text-sm" />
        </Field>
        <Field label="Description">
          <Textarea value={step.description || ''} onChange={e => update('description', e.target.value)} placeholder="What should the doer do?" className="h-16 resize-none text-sm" />
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-600 font-medium">Required to proceed?</span>
          <Switch checked={step.is_required !== false} onCheckedChange={v => update('is_required', v)} />
        </div>
      </Section>

      {/* Assignee */}
      <Section title="Who Does This" icon={<Users className="h-4 w-4 text-amber-500" />}>
        <Field label="Assignment Rule">
          <Select value={step.assignee_rule?.type || 'role'} onValueChange={v => updateNested('assignee_rule', 'type', v)}>
            <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {ASSIGNEE_RULES.map(r => <SelectItem key={r.value} value={r.value} className="text-sm">{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        {step.assignee_rule?.type === 'role' && (
          <Field label="Role">
            <Select value={step.assignee_rule?.value || 'staff'} onValueChange={v => updateNested('assignee_rule', 'value', v)}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ROLES.map(r => <SelectItem key={r} value={r} className="text-sm capitalize">{r.replace('_',' ')}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        )}
        {step.assignee_rule?.type === 'specific_user' && (
          <Field label="User ID or Email">
            <Input value={step.assignee_rule?.value || ''} onChange={e => updateNested('assignee_rule', 'value', e.target.value)} placeholder="user@example.com" className="text-sm" />
          </Field>
        )}
        <Field label="Completion Rule">
          <Select value={step.completion_rule || 'any_doer'} onValueChange={v => update('completion_rule', v)}>
            <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {COMPLETION_RULES.map(r => <SelectItem key={r.value} value={r.value} className="text-sm">{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-600 font-medium">Allow doer to select next step's assignee?</span>
          <Switch
            checked={step.assignee_rule?.allow_next_step_selection || false}
            onCheckedChange={v => updateNested('assignee_rule', 'allow_next_step_selection', v)}
          />
        </div>
      </Section>

      {/* SLA / Timing */}
      <Section title="Planned Time (SLA)" icon={<Clock className="h-4 w-4 text-blue-500" />}>
        <Field label="SLA Type">
          <Select value={step.sla_rule?.type || 'relative_to_prev_step'} onValueChange={v => updateNested('sla_rule', 'type', v)}>
            <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {SLA_RULE_TYPES.map(r => <SelectItem key={r.value} value={r.value} className="text-sm">{r.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <Field label="SLA Duration (minutes)">
          <Input
            type="number"
            value={step.sla_rule?.minutes || 60}
            onChange={e => updateNested('sla_rule', 'minutes', parseInt(e.target.value) || 60)}
            className="text-sm"
          />
        </Field>
        <Field label="Escalate After (minutes, 0=off)">
          <Input
            type="number"
            value={step.sla_rule?.escalate_after_minutes || 0}
            onChange={e => updateNested('sla_rule', 'escalate_after_minutes', parseInt(e.target.value) || 0)}
            className="text-sm"
          />
        </Field>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-600 font-medium">Business hours only?</span>
          <Switch
            checked={step.sla_rule?.business_hours_only || false}
            onCheckedChange={v => updateNested('sla_rule', 'business_hours_only', v)}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-600 font-medium">Exclude week-offs?</span>
          <Switch
            checked={step.sla_rule?.exclude_week_offs !== false}
            onCheckedChange={v => updateNested('sla_rule', 'exclude_week_offs', v)}
          />
        </div>
      </Section>

      {/* Form Link */}
      {(step.type === 'task' || step.type === 'form' || step.type === 'approval') && (
        <Section title="Linked Form (optional)" icon={<GitBranch className="h-4 w-4 text-blue-500" />}>
          <Field label="Select Form">
            <Select
              value={step.form_id || '__none__'}
              onValueChange={v => update('form_id', v === '__none__' ? '' : v)}
            >
              <SelectTrigger className="text-sm"><SelectValue placeholder="No form linked" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-sm text-slate-400">— No Form —</SelectItem>
                {forms.map(f => (
                  <SelectItem key={f.id} value={f.id} className="text-sm">
                    {f.name} <span className="text-slate-400 text-xs ml-1">({f.category})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {step.form_id && (
            <p className="text-[10px] text-slate-400">ID: {step.form_id}</p>
          )}
        </Section>
      )}

      {/* Next Step (linear) */}
      {step.type !== 'branch' && step.type !== 'parallel_start' && step.type !== 'end' && (
        <Section title="Next Step" icon={<GitBranch className="h-4 w-4 text-slate-500" />}>
          <Field label="Goes to">
            <Select value={step.next_step_id || '__none__'} onValueChange={v => update('next_step_id', v === '__none__' ? '' : v)}>
              <SelectTrigger className="text-sm"><SelectValue placeholder="Select next step" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-sm text-slate-400">— None (End) —</SelectItem>
                {otherSteps.map(s => <SelectItem key={s.id} value={s.id} className="text-sm">{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </Section>
      )}

      {/* Branch logic */}
      {step.type === 'branch' && (
        <Section title="Branch Conditions" icon={<GitBranch className="h-4 w-4 text-rose-500" />}>
          <div className="space-y-3">
            {(step.branches || []).map((branch, idx) => (
              <div key={branch.id} className="p-3 bg-rose-50 rounded-xl border border-rose-100 space-y-2">
                <div className="flex items-center justify-between">
                  <Input
                    value={branch.label}
                    onChange={e => updateBranch(idx, 'label', e.target.value)}
                    placeholder="Branch label"
                    className="text-xs h-7 font-semibold"
                  />
                  <button onClick={() => removeBranch(idx)} className="ml-2 p-1 hover:text-rose-500">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  <Input value={branch.condition_field} onChange={e => updateBranch(idx, 'condition_field', e.target.value)} placeholder="field" className="text-xs h-7" />
                  <Select value={branch.condition_operator} onValueChange={v => updateBranch(idx, 'condition_operator', v)}>
                    <SelectTrigger className="text-xs h-7"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {OPERATORS.map(o => <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input value={branch.condition_value} onChange={e => updateBranch(idx, 'condition_value', e.target.value)} placeholder="value" className="text-xs h-7" />
                </div>
                <div>
                  <Select value={branch.next_step_id || '__none__'} onValueChange={v => updateBranch(idx, 'next_step_id', v === '__none__' ? '' : v)}>
                    <SelectTrigger className="text-xs h-7"><SelectValue placeholder="→ Next step" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__" className="text-xs text-slate-400">— End flow —</SelectItem>
                      {otherSteps.map(s => <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
            <button
              onClick={addBranch}
              className="w-full flex items-center justify-center gap-1 py-2 rounded-xl border-2 border-dashed border-rose-200 text-rose-400 hover:border-rose-400 text-xs font-medium transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Add Branch
            </button>
          </div>
        </Section>
      )}

      {/* Parallel Start */}
      {step.type === 'parallel_start' && (
        <Section title="Parallel Steps" icon={<Layers className="h-4 w-4 text-purple-500" />}>
          <p className="text-xs text-slate-500 mb-2">Select which steps run in parallel from this split point.</p>
          <div className="space-y-2">
            {otherSteps.filter(s => s.type !== 'parallel_start' && s.type !== 'end').map(s => (
              <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={(step.parallel_step_ids || []).includes(s.id)}
                  onChange={e => {
                    const ids = step.parallel_step_ids || [];
                    update('parallel_step_ids', e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id));
                  }}
                  className="rounded"
                />
                <span className="text-sm">{s.name}</span>
              </label>
            ))}
          </div>
        </Section>
      )}

      {/* Parallel Join */}
      {step.type === 'parallel_join' && (
        <Section title="Join Rule" icon={<Layers className="h-4 w-4 text-purple-700" />}>
          <Field label="Complete when">
            <Select value={step.join_rule || 'all'} onValueChange={v => update('join_rule', v)}>
              <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                {JOIN_RULES.map(r => <SelectItem key={r.value} value={r.value} className="text-sm">{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          {step.join_rule === 'specific' && (
            <div className="space-y-2">
              <Label className="text-xs">Required steps to complete:</Label>
              {otherSteps.map(s => (
                <label key={s.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(step.join_required_step_ids || []).includes(s.id)}
                    onChange={e => {
                      const ids = step.join_required_step_ids || [];
                      update('join_required_step_ids', e.target.checked ? [...ids, s.id] : ids.filter(id => id !== s.id));
                    }}
                    className="rounded"
                  />
                  <span className="text-sm">{s.name}</span>
                </label>
              ))}
            </div>
          )}
          <Field label="After join, go to">
            <Select value={step.next_step_id || '__none__'} onValueChange={v => update('next_step_id', v === '__none__' ? '' : v)}>
              <SelectTrigger className="text-sm"><SelectValue placeholder="Select next step" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__" className="text-sm text-slate-400">— End flow —</SelectItem>
                {otherSteps.map(s => <SelectItem key={s.id} value={s.id} className="text-sm">{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </Section>
      )}

      {/* Delete */}
      <button
        onClick={onDelete}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-dashed border-rose-200 text-rose-400 hover:border-rose-400 hover:bg-rose-50 text-sm font-medium transition-colors"
      >
        <Trash2 className="h-4 w-4" /> Delete This Step
      </button>
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <div className="bg-slate-50 rounded-2xl border border-slate-100 p-4 space-y-3">
      <h4 className="text-sm font-bold text-slate-700 flex items-center gap-2">{icon}{title}</h4>
      {children}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-slate-500">{label}</Label>
      {children}
    </div>
  );
}