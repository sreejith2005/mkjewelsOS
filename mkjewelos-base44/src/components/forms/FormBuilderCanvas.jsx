import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { 
  Plus, Save, Eye, EyeOff, Wand2, ArrowUp, ArrowDown,
  Type, Hash, Mail, Phone, Calendar, List, ToggleLeft,
  AlignLeft, Upload, Star, DollarSign, Minus, Heading, Radio,
  Link2, Trash2, X
} from 'lucide-react';
import FieldEditor, { FIELD_TYPE_CONFIG } from './FieldEditor';
import { FORM_PRESETS } from './formEngine';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import FormRenderer from './FormRenderer';

const FIELD_PALETTE = [
  { type: 'text', icon: Type },
  { type: 'textarea', icon: AlignLeft },
  { type: 'number', icon: Hash },
  { type: 'currency', icon: DollarSign },
  { type: 'email', icon: Mail },
  { type: 'phone', icon: Phone },
  { type: 'date', icon: Calendar },
  { type: 'datetime', icon: Calendar },
  { type: 'select', icon: List },
  { type: 'multiselect', icon: List },
  { type: 'checkbox', icon: ToggleLeft },
  { type: 'radio', icon: Radio },
  { type: 'file', icon: Upload },
  { type: 'rating', icon: Star },
  { type: 'heading', icon: Heading },
  { type: 'divider', icon: Minus },
];

function generateFieldId() {
  return `f_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

export default function FormBuilderCanvas({ form, onSave, loading }) {
  const [formMeta, setFormMeta] = useState({
    name: form?.name || '',
    description: form?.description || '',
    category: form?.category || 'custom',
    is_active: form?.is_active !== false,
    settings: form?.settings || { allow_attachments: false, require_login: true },
    access_roles: form?.access_roles || [],
    tags: form?.tags || [],
    app_links: form?.app_links || [],
  });
  const [fields, setFields] = useState(form?.fields || []);
  const [showPreview, setShowPreview] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showLinkManager, setShowLinkManager] = useState(false);

  const APP_SECTIONS = ['CRM', 'MyTasks', 'Dashboard', 'Home', 'Notifications', 'Settings', 'Forms', 'UserManagement'];
  const LINK_TRIGGERS = [
    { value: 'manual', label: 'Manual (show as button)' },
    { value: 'on_create', label: 'On record create' },
    { value: 'on_complete', label: 'On task complete' },
    { value: 'on_stage_change', label: 'On stage change' },
  ];

  const addAppLink = () => {
    setFormMeta(p => ({
      ...p,
      app_links: [...(p.app_links || []), { section: 'CRM', trigger: 'manual', label: 'Fill Form' }]
    }));
  };

  const updateAppLink = (idx, key, val) => {
    setFormMeta(p => {
      const links = [...(p.app_links || [])];
      links[idx] = { ...links[idx], [key]: val };
      return { ...p, app_links: links };
    });
  };

  const removeAppLink = (idx) => {
    setFormMeta(p => ({ ...p, app_links: p.app_links.filter((_, i) => i !== idx) }));
  };

  const addField = (type) => {
    const config = FIELD_TYPE_CONFIG[type];
    const newField = {
      id: generateFieldId(),
      type,
      label: config?.label || 'New Field',
      placeholder: '',
      required: false,
      width: 'full',
      order: fields.length,
      options: ['select', 'multiselect', 'radio'].includes(type) ? ['Option 1', 'Option 2', 'Option 3'] : undefined,
    };
    setFields(prev => [...prev, newField]);
  };

  const updateField = (id, updated) => {
    setFields(prev => prev.map(f => f.id === id ? updated : f));
  };

  const deleteField = (id) => {
    setFields(prev => prev.filter(f => f.id !== id));
  };

  const moveField = (index, direction) => {
    const newFields = [...fields];
    const swapIndex = direction === 'up' ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= newFields.length) return;
    [newFields[index], newFields[swapIndex]] = [newFields[swapIndex], newFields[index]];
    setFields(newFields.map((f, i) => ({ ...f, order: i })));
  };

  const loadPreset = (presetKey) => {
    const preset = FORM_PRESETS[presetKey];
    if (!preset) return;
    setFormMeta(prev => ({ ...prev, name: preset.name, category: preset.category }));
    setFields(preset.fields.map(f => ({ ...f, id: generateFieldId() })));
    setShowPresets(false);
  };

  const handleSave = () => {
    onSave({ ...formMeta, fields: fields.map((f, i) => ({ ...f, order: i })) });
  };

  const previewForm = { ...formMeta, fields, id: form?.id || 'preview' };

  return (
    <div className="space-y-6">
      {/* Meta Section */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-slate-700">Form Details</h3>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowPresets(true)}
              className="text-xs"
            >
              <Wand2 className="h-3 w-3 mr-1" />
              Load Preset
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label className="text-xs">Form Name *</Label>
            <Input
              value={formMeta.name}
              onChange={(e) => setFormMeta(p => ({ ...p, name: e.target.value }))}
              placeholder="e.g. Repair Job Card"
              className="mt-1"
            />
          </div>
          <div>
            <Label className="text-xs">Category</Label>
            <Select value={formMeta.category} onValueChange={(v) => setFormMeta(p => ({ ...p, category: v }))}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['crm', 'task', 'pms_stage', 'hr', 'inventory', 'repair', 'feedback', 'inspection', 'audit', 'custom'].map(c => (
                  <SelectItem key={c} value={c}>{c.replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3 mt-5">
            <Switch
              checked={formMeta.is_active}
              onCheckedChange={(v) => setFormMeta(p => ({ ...p, is_active: v }))}
            />
            <span className="text-sm text-slate-600">Active</span>
          </div>
          <div className="col-span-2">
            <Label className="text-xs">Description</Label>
            <Textarea
              value={formMeta.description}
              onChange={(e) => setFormMeta(p => ({ ...p, description: e.target.value }))}
              placeholder="What is this form for?"
              className="mt-1 h-16 resize-none"
            />
          </div>
        </div>
      </div>

      {/* Field Palette */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <h3 className="font-bold text-slate-700 mb-3">Add Fields</h3>
        <div className="grid grid-cols-4 gap-2">
          {FIELD_PALETTE.map(({ type, icon: Icon }) => {
            const config = FIELD_TYPE_CONFIG[type];
            return (
              <button
                key={type}
                onClick={() => addField(type)}
                className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-slate-100 hover:border-amber-300 hover:bg-amber-50 transition-all group"
              >
                <div className={`p-1.5 rounded-lg ${config.color} group-hover:scale-110 transition-transform`}>
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span className="text-[10px] text-slate-500 text-center leading-tight">{config.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fields Canvas */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-slate-700">
            Fields
            <span className="ml-2 text-sm font-normal text-slate-400">({fields.length})</span>
          </h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(true)}
            className="text-xs"
          >
            <Eye className="h-3 w-3 mr-1" />
            Preview
          </Button>
        </div>

        {fields.length === 0 ? (
          <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-xl">
            <Plus className="h-8 w-8 text-slate-300 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">Click fields above to add them here</p>
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence>
              {fields.map((field, index) => (
                <div key={field.id} className="flex gap-2">
                  <div className="flex flex-col gap-1 pt-3">
                    <button
                      type="button"
                      onClick={() => moveField(index, 'up')}
                      disabled={index === 0}
                      className="p-0.5 text-slate-300 hover:text-slate-500 disabled:opacity-20"
                    >
                      <ArrowUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveField(index, 'down')}
                      disabled={index === fields.length - 1}
                      className="p-0.5 text-slate-300 hover:text-slate-500 disabled:opacity-20"
                    >
                      <ArrowDown className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="flex-1">
                    <FieldEditor
                      field={field}
                      index={index}
                      onUpdate={(updated) => updateField(field.id, updated)}
                      onDelete={() => deleteField(field.id)}
                    />
                  </div>
                </div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* App Links / Integration Section */}
      <div className="bg-white rounded-2xl border border-slate-100 p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-blue-500" />
            <h3 className="font-bold text-slate-700">App Links</h3>
          </div>
          <button
            type="button"
            onClick={addAppLink}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-blue-50 text-blue-600 text-xs font-medium hover:bg-blue-100 transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add Link
          </button>
        </div>
        <p className="text-xs text-slate-400 mb-4">Choose which parts of the app can access or trigger this form.</p>

        {(formMeta.app_links || []).length === 0 ? (
          <div className="text-center py-6 border-2 border-dashed border-slate-200 rounded-xl">
            <Link2 className="h-6 w-6 text-slate-300 mx-auto mb-2" />
            <p className="text-xs text-slate-400">No app links yet. Click "Add Link" to connect this form to any page.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {(formMeta.app_links || []).map((link, idx) => (
              <div key={idx} className="flex gap-2 items-start p-3 bg-slate-50 rounded-xl border border-slate-200">
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Section</label>
                      <select
                        value={link.section}
                        onChange={e => updateAppLink(idx, 'section', e.target.value)}
                        className="w-full mt-0.5 px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                      >
                        {APP_SECTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Trigger</label>
                      <select
                        value={link.trigger}
                        onChange={e => updateAppLink(idx, 'trigger', e.target.value)}
                        className="w-full mt-0.5 px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                      >
                        {LINK_TRIGGERS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Button Label</label>
                    <input
                      type="text"
                      value={link.label || ''}
                      onChange={e => updateAppLink(idx, 'label', e.target.value)}
                      placeholder="e.g. Fill Feedback Form"
                      className="w-full mt-0.5 px-2 py-1.5 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeAppLink(idx)}
                  className="w-7 h-7 rounded-lg hover:bg-rose-100 flex items-center justify-center text-slate-400 hover:text-rose-500 flex-shrink-0 mt-1"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Save */}
      <Button
        onClick={handleSave}
        disabled={loading || !formMeta.name}
        className="w-full bg-amber-500 hover:bg-amber-600 py-6 text-base font-semibold"
      >
        <Save className="h-5 w-5 mr-2" />
        {loading ? 'Saving...' : 'Save Form'}
      </Button>

      {/* Preview Sheet */}
      <Sheet open={showPreview} onOpenChange={setShowPreview}>
        <SheetContent side="bottom" className="h-[90vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-6">
            <SheetTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5 text-blue-500" />
              Preview: {formMeta.name || 'Untitled Form'}
            </SheetTitle>
          </SheetHeader>
          {fields.length === 0 ? (
            <p className="text-center text-slate-400 py-8">No fields to preview yet</p>
          ) : (
            <FormRenderer
              form={previewForm}
              userProfile={null}
              user={null}
              onCancel={() => setShowPreview(false)}
              onSuccess={() => setShowPreview(false)}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Preset Picker Sheet */}
      <Sheet open={showPresets} onOpenChange={setShowPresets}>
        <SheetContent side="bottom" className="h-[60vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-6">
            <SheetTitle>Load a Preset Template</SheetTitle>
          </SheetHeader>
          <div className="space-y-3">
            {Object.entries(FORM_PRESETS).map(([key, preset]) => (
              <button
                key={key}
                onClick={() => loadPreset(key)}
                className="w-full flex items-start gap-4 p-4 rounded-xl border border-slate-100 hover:border-amber-300 hover:bg-amber-50 transition-all text-left"
              >
                <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-xl flex-shrink-0">
                  {key === 'crm_follow_up' ? '📞' : key === 'repair_job' ? '🔧' : '📋'}
                </div>
                <div>
                  <p className="font-semibold text-slate-800">{preset.name}</p>
                  <p className="text-sm text-slate-500 capitalize">{preset.category.replace('_', ' ')} · {preset.fields.length} fields</p>
                </div>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}