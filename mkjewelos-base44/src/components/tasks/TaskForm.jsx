import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, X, Plus, Trash2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';

export default function TaskForm({ task, departments = [], users = [], onSave, onCancel, loading }) {
  const [formData, setFormData] = useState(task || {
    title: '',
    description: '',
    type: 'general',
    priority: 'medium',
    status: 'pending',
    department_id: '',
    assigned_to: '',
    due_date: '',
    checklist: [],
  });

  const [newCheckItem, setNewCheckItem] = useState('');

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const addChecklistItem = () => {
    if (!newCheckItem.trim()) return;
    setFormData(prev => ({
      ...prev,
      checklist: [...(prev.checklist || []), { item: newCheckItem, completed: false }]
    }));
    setNewCheckItem('');
  };

  const removeChecklistItem = (index) => {
    setFormData(prev => ({
      ...prev,
      checklist: prev.checklist.filter((_, i) => i !== index)
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <Label>Task Title *</Label>
        <Input
          value={formData.title}
          onChange={(e) => handleChange('title', e.target.value)}
          placeholder="Enter task title"
          required
        />
      </div>

      <div>
        <Label>Description</Label>
        <Textarea
          value={formData.description}
          onChange={(e) => handleChange('description', e.target.value)}
          placeholder="Task description..."
          className="h-24"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Type</Label>
          <Select value={formData.type} onValueChange={(v) => handleChange('type', v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="customer_follow_up">Customer Follow-up</SelectItem>
              <SelectItem value="order_processing">Order Processing</SelectItem>
              <SelectItem value="inventory">Inventory</SelectItem>
              <SelectItem value="repair">Repair</SelectItem>
              <SelectItem value="delivery">Delivery</SelectItem>
              <SelectItem value="quality_check">Quality Check</SelectItem>
              <SelectItem value="documentation">Documentation</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Priority</Label>
          <Select value={formData.priority} onValueChange={(v) => handleChange('priority', v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Low</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Department</Label>
          <Select value={formData.department_id} onValueChange={(v) => handleChange('department_id', v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select department" />
            </SelectTrigger>
            <SelectContent>
              {departments.map(dept => (
                <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Assign To</Label>
          <Select value={formData.assigned_to} onValueChange={(v) => handleChange('assigned_to', v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select user" />
            </SelectTrigger>
            <SelectContent>
              {users.map(user => (
                <SelectItem key={user.id} value={user.id}>{user.full_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>Due Date</Label>
        <Input
          type="datetime-local"
          value={formData.due_date}
          onChange={(e) => handleChange('due_date', e.target.value)}
        />
      </div>

      <div>
        <Label>Checklist</Label>
        <div className="space-y-2 mt-2">
          {formData.checklist?.map((item, index) => (
            <div key={index} className="flex items-center gap-2 bg-slate-50 rounded-lg p-2">
              <Checkbox checked={item.completed} />
              <span className="flex-1 text-sm">{item.item}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeChecklistItem(index)}
                className="h-6 w-6 text-slate-400 hover:text-rose-500"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              value={newCheckItem}
              onChange={(e) => setNewCheckItem(e.target.value)}
              placeholder="Add checklist item"
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addChecklistItem())}
            />
            <Button type="button" variant="outline" onClick={addChecklistItem}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          <X className="h-4 w-4 mr-2" />
          Cancel
        </Button>
        <Button type="submit" disabled={loading} className="flex-1 bg-amber-500 hover:bg-amber-600">
          <Save className="h-4 w-4 mr-2" />
          {loading ? 'Saving...' : 'Save Task'}
        </Button>
      </div>
    </form>
  );
}