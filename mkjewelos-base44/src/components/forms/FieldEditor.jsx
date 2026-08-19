import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  GripVertical, Trash2, ChevronDown, ChevronUp,
  Type, Hash, Mail, Phone, Calendar, List, ToggleLeft, 
  AlignLeft, Upload, Star, DollarSign, Minus, Heading,
  Eye, EyeOff
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';

export const FIELD_TYPE_CONFIG = {
  text: { label: 'Short Text', icon: Type, color: 'bg-blue-100 text-blue-600' },
  textarea: { label: 'Long Text', icon: AlignLeft, color: 'bg-blue-100 text-blue-600' },
  number: { label: 'Number', icon: Hash, color: 'bg-emerald-100 text-emerald-600' },
  currency: { label: 'Currency (₹)', icon: DollarSign, color: 'bg-emerald-100 text-emerald-600' },
  email: { label: 'Email', icon: Mail, color: 'bg-violet-100 text-violet-600' },
  phone: { label: 'Phone', icon: Phone, color: 'bg-violet-100 text-violet-600' },
  date: { label: 'Date', icon: Calendar, color: 'bg-amber-100 text-amber-600' },
  datetime: { label: 'Date & Time', icon: Calendar, color: 'bg-amber-100 text-amber-600' },
  select: { label: 'Dropdown', icon: List, color: 'bg-rose-100 text-rose-600' },
  multiselect: { label: 'Multi-select', icon: List, color: 'bg-rose-100 text-rose-600' },
  checkbox: { label: 'Checkbox', icon: ToggleLeft, color: 'bg-cyan-100 text-cyan-600' },
  radio: { label: 'Radio', icon: ToggleLeft, color: 'bg-cyan-100 text-cyan-600' },
  file: { label: 'File Upload', icon: Upload, color: 'bg-slate-100 text-slate-600' },
  rating: { label: 'Rating', icon: Star, color: 'bg-amber-100 text-amber-600' },
  heading: { label: 'Section Heading', icon: Heading, color: 'bg-slate-100 text-slate-500' },
  divider: { label: 'Divider', icon: Minus, color: 'bg-slate-100 text-slate-400' },
};

export default function FieldEditor({ field, onUpdate, onDelete, index }) {
  const [expanded, setExpanded] = useState(false);
  const config = FIELD_TYPE_CONFIG[field.type] || FIELD_TYPE_CONFIG.text;
  const Icon = config.icon;
  const isLayout = ['divider', 'heading'].includes(field.type);

  const update = (key, val) => onUpdate({ ...field, [key]: val });

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className={`bg-white rounded-xl border-2 transition-all ${expanded ? 'border-amber-300 shadow-md' : 'border-slate-100 hover:border-slate-200'}`}
    >
      {/* Field Header */}
      <div className="flex items-center gap-3 p-3">
        <div className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-400 flex-shrink-0">
          <GripVertical className="h-5 w-5" />
        </div>

        <div className={`p-1.5 rounded-lg flex-shrink-0 ${config.color}`}>
          <Icon className="h-4 w-4" />
        </div>

        <div className="flex-1 min-w-0">
          {isLayout ? (
            <Input
              value={field.label}
              onChange={(e) => update('label', e.target.value)}
              placeholder={field.type === 'heading' ? 'Section title...' : ''}
              className="h-8 text-sm border-0 shadow-none p-0 font-medium focus-visible:ring-0"
            />
          ) : (
            <Input
              value={field.label}
              onChange={(e) => update('label', e.target.value)}
              placeholder="Field label"
              className="h-8 text-sm border-0 shadow-none p-0 focus-visible:ring-0"
            />
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {!isLayout && (
            <>
              <Badge variant="outline" className="text-[10px] px-1.5 hidden sm:flex">{config.label}</Badge>
              {field.required && (
                <span className="text-rose-400 text-xs font-bold">*</span>
              )}
            </>
          )}
          {!isLayout && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
            >
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
          <button
            onClick={onDelete}
            className="p-1 rounded-lg text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Expanded Settings */}
      {expanded && !isLayout && (
        <div className="border-t border-slate-100 p-4 space-y-4 bg-slate-50/50">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Placeholder</Label>
              <Input
                value={field.placeholder || ''}
                onChange={(e) => update('placeholder', e.target.value)}
                placeholder="Hint text"
                className="h-8 mt-1 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Helper Text</Label>
              <Input
                value={field.helper_text || ''}
                onChange={(e) => update('helper_text', e.target.value)}
                placeholder="e.g. Enter in mm/dd/yyyy"
                className="h-8 mt-1 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Width</Label>
              <Select value={field.width || 'full'} onValueChange={(v) => update('width', v)}>
                <SelectTrigger className="h-8 mt-1 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full">Full Width</SelectItem>
                  <SelectItem value="half">Half Width</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Default Value</Label>
              <Input
                value={field.default_value || ''}
                onChange={(e) => update('default_value', e.target.value)}
                placeholder="Pre-filled value"
                className="h-8 mt-1 text-sm"
              />
            </div>
          </div>

          {/* Options for select/radio/multiselect */}
          {['select', 'multiselect', 'radio'].includes(field.type) && (
            <div>
              <Label className="text-xs">Options (one per line)</Label>
              <Textarea
                value={(field.options || []).join('\n')}
                onChange={(e) => update('options', e.target.value.split('\n').filter(Boolean))}
                placeholder="Option 1&#10;Option 2&#10;Option 3"
                className="mt-1 text-sm h-24 resize-none"
              />
            </div>
          )}

          {/* Validation */}
          {['text', 'textarea', 'number', 'currency'].includes(field.type) && (
            <div className="grid grid-cols-2 gap-3">
              {['text', 'textarea'].includes(field.type) && (
                <>
                  <div>
                    <Label className="text-xs">Min Length</Label>
                    <Input
                      type="number"
                      value={field.validation?.minLength || ''}
                      onChange={(e) => update('validation', { ...field.validation, minLength: parseInt(e.target.value) || undefined })}
                      className="h-8 mt-1 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Max Length</Label>
                    <Input
                      type="number"
                      value={field.validation?.maxLength || ''}
                      onChange={(e) => update('validation', { ...field.validation, maxLength: parseInt(e.target.value) || undefined })}
                      className="h-8 mt-1 text-sm"
                    />
                  </div>
                </>
              )}
              {['number', 'currency'].includes(field.type) && (
                <>
                  <div>
                    <Label className="text-xs">Min Value</Label>
                    <Input
                      type="number"
                      value={field.validation?.min ?? ''}
                      onChange={(e) => update('validation', { ...field.validation, min: parseFloat(e.target.value) })}
                      className="h-8 mt-1 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Max Value</Label>
                    <Input
                      type="number"
                      value={field.validation?.max ?? ''}
                      onChange={(e) => update('validation', { ...field.validation, max: parseFloat(e.target.value) })}
                      className="h-8 mt-1 text-sm"
                    />
                  </div>
                </>
              )}
            </div>
          )}

          {/* Toggles */}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <Switch
                checked={field.required || false}
                onCheckedChange={(v) => update('required', v)}
                className="scale-75"
              />
              <span className="text-xs text-slate-600">Required</span>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}