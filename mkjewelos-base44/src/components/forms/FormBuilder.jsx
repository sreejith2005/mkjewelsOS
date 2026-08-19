import React, { useState } from 'react';
import { motion, Reorder } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card } from '@/components/ui/card';
import { 
  Plus, Trash2, GripVertical, Type, Hash, Calendar,
  ToggleLeft, List, Mail, Phone, FileText, Image, Save
} from 'lucide-react';
// uuid via timestamp

const fieldTypes = [
  { type: 'text', label: 'Text', icon: Type },
  { type: 'number', label: 'Number', icon: Hash },
  { type: 'email', label: 'Email', icon: Mail },
  { type: 'phone', label: 'Phone', icon: Phone },
  { type: 'date', label: 'Date', icon: Calendar },
  { type: 'select', label: 'Dropdown', icon: List },
  { type: 'checkbox', label: 'Checkbox', icon: ToggleLeft },
  { type: 'textarea', label: 'Long Text', icon: FileText },
  { type: 'file', label: 'File Upload', icon: Image },
];

function FieldEditor({ field, onUpdate, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <button className="mt-2 cursor-grab active:cursor-grabbing text-slate-400">
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="flex-1 space-y-3">
          <div className="flex items-center gap-3">
            <Input
              value={field.label}
              onChange={(e) => onUpdate({ ...field, label: e.target.value })}
              placeholder="Field label"
              className="flex-1"
            />
            <Select 
              value={field.type} 
              onValueChange={(v) => onUpdate({ ...field, type: v })}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {fieldTypes.map(ft => (
                  <SelectItem key={ft.type} value={ft.type}>
                    <span className="flex items-center gap-2">
                      <ft.icon className="h-3 w-3" />
                      {ft.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-2">
              <Switch
                checked={field.required}
                onCheckedChange={(v) => onUpdate({ ...field, required: v })}
              />
              <span className="text-xs text-slate-500">Required</span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onDelete}
              className="text-slate-400 hover:text-rose-500"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          
          {(field.type === 'select') && (
            <div>
              <Label className="text-xs">Options (comma separated)</Label>
              <Input
                value={field.options?.join(', ') || ''}
                onChange={(e) => onUpdate({ 
                  ...field, 
                  options: e.target.value.split(',').map(o => o.trim()).filter(Boolean) 
                })}
                placeholder="Option 1, Option 2, Option 3"
              />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

export default function FormBuilder({ form, onSave, loading }) {
  const [formData, setFormData] = useState(form || {
    name: '',
    description: '',
    category: 'other',
    fields: [],
    settings: { allow_attachments: true }
  });

  const addField = (type) => {
    const newField = {
      id: `field_${Date.now()}`,
      type,
      label: `New ${type} field`,
      placeholder: '',
      required: false,
      options: type === 'select' ? ['Option 1', 'Option 2'] : undefined,
      order: formData.fields.length
    };
    setFormData(prev => ({
      ...prev,
      fields: [...prev.fields, newField]
    }));
  };

  const updateField = (id, updatedField) => {
    setFormData(prev => ({
      ...prev,
      fields: prev.fields.map(f => f.id === id ? updatedField : f)
    }));
  };

  const deleteField = (id) => {
    setFormData(prev => ({
      ...prev,
      fields: prev.fields.filter(f => f.id !== id)
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Form Name *</Label>
          <Input
            value={formData.name}
            onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
            placeholder="Enter form name"
            required
          />
        </div>
        <div>
          <Label>Category</Label>
          <Select 
            value={formData.category} 
            onValueChange={(v) => setFormData(prev => ({ ...prev, category: v }))}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="customer">Customer</SelectItem>
              <SelectItem value="order">Order</SelectItem>
              <SelectItem value="inventory">Inventory</SelectItem>
              <SelectItem value="repair">Repair</SelectItem>
              <SelectItem value="feedback">Feedback</SelectItem>
              <SelectItem value="inspection">Inspection</SelectItem>
              <SelectItem value="checklist">Checklist</SelectItem>
              <SelectItem value="survey">Survey</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label>Description</Label>
        <Input
          value={formData.description}
          onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
          placeholder="Form description"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <Label>Form Fields</Label>
          <div className="flex gap-1 flex-wrap">
            {fieldTypes.slice(0, 5).map(ft => (
              <Button
                key={ft.type}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => addField(ft.type)}
                className="h-8"
              >
                <ft.icon className="h-3 w-3 mr-1" />
                {ft.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          {formData.fields.length === 0 ? (
            <div className="text-center py-12 bg-slate-50 rounded-xl border-2 border-dashed border-slate-200">
              <FileText className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <p className="text-slate-500">No fields added yet</p>
              <p className="text-sm text-slate-400">Click buttons above to add fields</p>
            </div>
          ) : (
            formData.fields.map(field => (
              <FieldEditor
                key={field.id}
                field={field}
                onUpdate={(f) => updateField(field.id, f)}
                onDelete={() => deleteField(field.id)}
              />
            ))
          )}
        </div>
      </div>

      <Button type="submit" disabled={loading} className="w-full bg-amber-500 hover:bg-amber-600">
        <Save className="h-4 w-4 mr-2" />
        {loading ? 'Saving...' : 'Save Form'}
      </Button>
    </form>
  );
}