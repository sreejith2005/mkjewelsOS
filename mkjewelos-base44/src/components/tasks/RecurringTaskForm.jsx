import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Plus, Trash2, Save, X } from 'lucide-react';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function RecurringTaskForm({ task, departments = [], users = [], onSave, onCancel, loading }) {
  const [formData, setFormData] = useState(task || {
    title: '',
    description: '',
    recurrence_type: 'daily',
    recurrence_days: [],
    recurrence_time: '09:00',
    category: 'custom',
    priority: 'medium',
    department_id: '',
    assigned_to: '',
    checklist: [],
    is_active: true,
    sla_hours: 24,
  });

  const [newCheckItem, setNewCheckItem] = useState('');
  const [checkRequired, setCheckRequired] = useState(false);

  const handleChange = (field, value) => setFormData(p => ({ ...p, [field]: value }));

  const toggleDay = (day) => {
    const days = formData.recurrence_days || [];
    const updated = days.includes(day) ? days.filter(d => d !== day) : [...days, day];
    handleChange('recurrence_days', updated);
  };

  const addChecklist = () => {
    if (!newCheckItem.trim()) return;
    handleChange('checklist', [
      ...(formData.checklist || []),
      { id: `ci_${Date.now()}`, item: newCheckItem, required: checkRequired, order: (formData.checklist || []).length }
    ]);
    setNewCheckItem('');
    setCheckRequired(false);
  };

  const removeChecklist = (id) => handleChange('checklist', formData.checklist.filter(c => c.id !== id));

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <Label>Task Title *</Label>
        <Input value={formData.title} onChange={(e) => handleChange('title', e.target.value)} placeholder="e.g. Daily Opening Checklist" required />
      </div>

      <div>
        <Label>Description</Label>
        <Textarea value={formData.description} onChange={(e) => handleChange('description', e.target.value)} placeholder="Task details..." className="h-20" />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Recurrence *</Label>
          <Select value={formData.recurrence_type} onValueChange={(v) => handleChange('recurrence_type', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Time</Label>
          <Input type="time" value={formData.recurrence_time} onChange={(e) => handleChange('recurrence_time', e.target.value)} />
        </div>
      </div>

      {/* Day selector for weekly */}
      {formData.recurrence_type === 'weekly' && (
        <div>
          <Label>Repeat On</Label>
          <div className="flex gap-2 mt-2 flex-wrap">
            {DAYS.map((day, i) => (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(i)}
                className={`w-10 h-10 rounded-full text-sm font-medium transition-all ${
                  formData.recurrence_days?.includes(i)
                    ? 'bg-amber-500 text-white shadow'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                }`}
              >
                {day.charAt(0)}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Day of month for monthly */}
      {formData.recurrence_type === 'monthly' && (
        <div>
          <Label>Day of Month</Label>
          <Input
            type="number"
            min="1"
            max="31"
            value={formData.recurrence_days?.[0] || ''}
            onChange={(e) => handleChange('recurrence_days', [parseInt(e.target.value)])}
            placeholder="e.g. 1 for 1st"
          />
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Category</Label>
          <Select value={formData.category} onValueChange={(v) => handleChange('category', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['opening', 'closing', 'audit', 'cleaning', 'report', 'follow_up', 'maintenance', 'custom'].map(c => (
                <SelectItem key={c} value={c}>{c.replace('_', ' ')}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Priority</Label>
          <Select value={formData.priority} onValueChange={(v) => handleChange('priority', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {['low', 'medium', 'high', 'urgent'].map(p => (
                <SelectItem key={p} value={p}>{p}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Department</Label>
          <Select value={formData.department_id} onValueChange={(v) => handleChange('department_id', v)}>
            <SelectTrigger><SelectValue placeholder="Select dept" /></SelectTrigger>
            <SelectContent>
              {departments.map(d => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Default Assignee</Label>
          <Select value={formData.assigned_to} onValueChange={(v) => handleChange('assigned_to', v)}>
            <SelectTrigger><SelectValue placeholder="Select user" /></SelectTrigger>
            <SelectContent>
              {users.map(u => (
                <SelectItem key={u.id} value={u.id}>{u.full_name || u.email}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>SLA (hours)</Label>
        <Input
          type="number"
          value={formData.sla_hours}
          onChange={(e) => handleChange('sla_hours', parseInt(e.target.value))}
          className="w-28"
        />
      </div>

      {/* Checklist Builder */}
      <div>
        <Label className="mb-2 block">Checklist Items</Label>
        <div className="space-y-2">
          {formData.checklist?.map((item, i) => (
            <div key={item.id} className="flex items-center gap-2 bg-slate-50 rounded-xl p-3">
              <div className="flex-1">
                <span className="text-sm">{item.item}</span>
                {item.required && <span className="text-rose-400 text-xs ml-2">*required</span>}
              </div>
              <button type="button" onClick={() => removeChecklist(item.id)} className="text-slate-400 hover:text-rose-500">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}

          <div className="flex gap-2">
            <Input
              value={newCheckItem}
              onChange={(e) => setNewCheckItem(e.target.value)}
              placeholder="Add checklist item..."
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addChecklist())}
              className="flex-1"
            />
            <div className="flex items-center gap-1">
              <Checkbox checked={checkRequired} onCheckedChange={setCheckRequired} />
              <span className="text-xs text-slate-500">req</span>
            </div>
            <Button type="button" variant="outline" onClick={addChecklist}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl">
        <Switch checked={formData.is_active} onCheckedChange={(v) => handleChange('is_active', v)} />
        <div>
          <p className="font-medium text-sm">Active</p>
          <p className="text-xs text-slate-400">Generate instances on schedule</p>
        </div>
      </div>

      <div className="flex gap-3">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          <X className="h-4 w-4 mr-1" />Cancel
        </Button>
        <Button type="submit" disabled={loading} className="flex-1 bg-amber-500 hover:bg-amber-600">
          <Save className="h-4 w-4 mr-1" />
          {loading ? 'Saving...' : 'Save Recurring Task'}
        </Button>
      </div>
    </form>
  );
}