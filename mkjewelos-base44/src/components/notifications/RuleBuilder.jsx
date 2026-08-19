import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Save, Zap } from 'lucide-react';
import { EVENT_META } from './notificationEngine';

const CHANNELS = ['in_app', 'email', 'sms', 'whatsapp'];
const OPERATORS = ['equals', 'not_equals', 'contains', 'gt', 'gte', 'lt', 'lte', 'is_today', 'is_past', 'is_future', 'is_empty', 'is_not_empty'];
const RECIPIENT_TYPES = ['assigned_user', 'manager', 'department_head', 'branch_manager', 'custom_user', 'customer'];
const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

const needsValue = (op) => !['is_today', 'is_past', 'is_future', 'is_empty', 'is_not_empty'].includes(op);

export default function RuleBuilder({ rule, onSave, loading }) {
  const [form, setForm] = useState({
    name: rule?.name || '',
    event_type: rule?.event_type || 'TASK_ASSIGNED',
    conditions: rule?.conditions || [],
    channels: rule?.channels || ['in_app'],
    recipients: rule?.recipients || { type: 'assigned_user' },
    delay_minutes: rule?.delay_minutes || 0,
    retry_count: rule?.retry_count ?? 3,
    retry_interval_minutes: rule?.retry_interval_minutes ?? 30,
    cooldown_hours: rule?.cooldown_hours || 0,
    priority: rule?.priority || 'normal',
    is_active: rule?.is_active !== false,
  });

  const set = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const addCondition = () => {
    set('conditions', [...form.conditions, { field: '', operator: 'equals', value: '' }]);
  };

  const updateCondition = (i, key, val) => {
    const updated = form.conditions.map((c, idx) => idx === i ? { ...c, [key]: val } : c);
    set('conditions', updated);
  };

  const removeCondition = (i) => {
    set('conditions', form.conditions.filter((_, idx) => idx !== i));
  };

  const toggleChannel = (ch) => {
    set('channels', form.channels.includes(ch)
      ? form.channels.filter(c => c !== ch)
      : [...form.channels, ch]);
  };

  const meta = EVENT_META[form.event_type];

  return (
    <div className="space-y-6 pb-8">
      {/* Basic Info */}
      <div className="space-y-3">
        <div>
          <Label className="text-xs">Rule Name</Label>
          <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Notify on task overdue" className="mt-1" />
        </div>

        <div>
          <Label className="text-xs">Trigger Event</Label>
          <Select value={form.event_type} onValueChange={v => set('event_type', v)}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(EVENT_META).map(([key, m]) => (
                <SelectItem key={key} value={key}>
                  {m.icon} {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {meta && (
            <div className="flex flex-wrap gap-1 mt-2">
              {meta.variables.map(v => (
                <Badge key={v} variant="outline" className="text-[10px] font-mono">{`{{${v}}}`}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Conditions */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <Label className="text-xs">Conditions (all must match)</Label>
          <Button type="button" variant="outline" size="sm" onClick={addCondition} className="h-7 text-xs">
            <Plus className="h-3 w-3 mr-1" /> Add
          </Button>
        </div>
        <div className="space-y-2">
          {form.conditions.map((cond, i) => (
            <div key={i} className="flex gap-2 items-start">
              <Input value={cond.field} onChange={e => updateCondition(i, 'field', e.target.value)} placeholder="field (e.g. priority)" className="h-8 text-xs flex-1" />
              <Select value={cond.operator} onValueChange={v => updateCondition(i, 'operator', v)}>
                <SelectTrigger className="h-8 text-xs w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPERATORS.map(op => <SelectItem key={op} value={op} className="text-xs">{op}</SelectItem>)}
                </SelectContent>
              </Select>
              {needsValue(cond.operator) && (
                <Input value={cond.value} onChange={e => updateCondition(i, 'value', e.target.value)} placeholder="value" className="h-8 text-xs flex-1" />
              )}
              <button onClick={() => removeCondition(i)} className="p-1 text-slate-300 hover:text-rose-500 mt-1">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          {form.conditions.length === 0 && (
            <p className="text-xs text-slate-400 italic">No conditions — rule fires on every matching event</p>
          )}
        </div>
      </div>

      {/* Channels */}
      <div>
        <Label className="text-xs mb-2 block">Delivery Channels</Label>
        <div className="flex gap-2 flex-wrap">
          {CHANNELS.map(ch => (
            <button
              key={ch}
              type="button"
              onClick={() => toggleChannel(ch)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium border transition-all ${
                form.channels.includes(ch)
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-500 border-slate-200'
              }`}
            >
              {ch}
            </button>
          ))}
        </div>
      </div>

      {/* Recipients */}
      <div>
        <Label className="text-xs">Recipients</Label>
        <Select value={form.recipients.type} onValueChange={v => set('recipients', { ...form.recipients, type: v })}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RECIPIENT_TYPES.map(t => <SelectItem key={t} value={t}>{t.replace(/_/g, ' ')}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Advanced */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Priority</Label>
          <Select value={form.priority} onValueChange={v => set('priority', v)}>
            <SelectTrigger className="h-8 mt-1 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>{PRIORITIES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Delay (minutes)</Label>
          <Input type="number" value={form.delay_minutes} onChange={e => set('delay_minutes', parseInt(e.target.value) || 0)} className="h-8 mt-1 text-sm" min={0} />
        </div>
        <div>
          <Label className="text-xs">Retry Count</Label>
          <Input type="number" value={form.retry_count} onChange={e => set('retry_count', parseInt(e.target.value) || 0)} className="h-8 mt-1 text-sm" min={0} max={10} />
        </div>
        <div>
          <Label className="text-xs">Cooldown (hours)</Label>
          <Input type="number" value={form.cooldown_hours} onChange={e => set('cooldown_hours', parseInt(e.target.value) || 0)} className="h-8 mt-1 text-sm" min={0} />
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={form.is_active} onCheckedChange={v => set('is_active', v)} />
        <Label className="font-normal text-sm text-slate-600">Rule Active</Label>
      </div>

      <Button
        onClick={() => onSave(form)}
        disabled={loading || !form.name || form.channels.length === 0}
        className="w-full bg-amber-500 hover:bg-amber-600 py-5 font-semibold"
      >
        <Save className="h-4 w-4 mr-2" />
        {loading ? 'Saving...' : 'Save Rule'}
      </Button>
    </div>
  );
}