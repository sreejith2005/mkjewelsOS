import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Save, Eye } from 'lucide-react';
import { EVENT_META, resolveTemplate } from './notificationEngine';

const CHANNELS = ['in_app', 'email', 'sms', 'whatsapp', 'push'];

export default function TemplateEditor({ template, onSave, loading }) {
  const [form, setForm] = useState({
    name: template?.name || '',
    event_type: template?.event_type || 'TASK_ASSIGNED',
    channel: template?.channel || 'in_app',
    subject: template?.subject || '',
    body: template?.body || '',
    cta_label: template?.cta_label || '',
    cta_url: template?.cta_url || '',
    is_active: template?.is_active !== false,
  });
  const [preview, setPreview] = useState(false);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const meta = EVENT_META[form.event_type];

  // Build sample data for preview
  const sampleVars = Object.fromEntries(
    (meta?.variables || []).map(v => [v, `[${v}]`])
  );

  const insertVar = (varKey) => {
    set('body', form.body + `{{${varKey}}}`);
  };

  return (
    <div className="space-y-5 pb-8">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <Label className="text-xs">Template Name</Label>
          <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Task Assigned Alert" className="mt-1" />
        </div>
        <div>
          <Label className="text-xs">Event</Label>
          <Select value={form.event_type} onValueChange={v => set('event_type', v)}>
            <SelectTrigger className="mt-1 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(EVENT_META).map(([key, m]) => (
                <SelectItem key={key} value={key}>{m.icon} {m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Channel</Label>
          <Select value={form.channel} onValueChange={v => set('channel', v)}>
            <SelectTrigger className="mt-1 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CHANNELS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Variables chip palette */}
      {meta?.variables?.length > 0 && (
        <div>
          <Label className="text-xs mb-2 block">Available Variables (tap to insert)</Label>
          <div className="flex flex-wrap gap-2">
            {meta.variables.map(v => (
              <button
                key={v}
                type="button"
                onClick={() => insertVar(v)}
                className="font-mono text-[10px] bg-amber-50 border border-amber-200 text-amber-700 px-2 py-1 rounded-lg hover:bg-amber-100 transition-all"
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <Label className="text-xs">Subject / Title</Label>
        <Input value={form.subject} onChange={e => set('subject', e.target.value)} placeholder="e.g. New task: {{task_title}}" className="mt-1" />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">Message Body</Label>
          <button
            type="button"
            onClick={() => setPreview(!preview)}
            className="flex items-center gap-1 text-[11px] text-blue-500 hover:text-blue-700"
          >
            <Eye className="h-3 w-3" />
            {preview ? 'Edit' : 'Preview'}
          </button>
        </div>
        {preview ? (
          <div className="mt-1 p-4 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-700 whitespace-pre-wrap min-h-24">
            {resolveTemplate(form.body, sampleVars) || <span className="text-slate-400 italic">Nothing to preview</span>}
          </div>
        ) : (
          <Textarea
            value={form.body}
            onChange={e => set('body', e.target.value)}
            placeholder="Hi {{user_name}}, your task {{task_title}} is due on {{due_date}}."
            className="mt-1 h-28 resize-none text-sm"
          />
        )}
      </div>

      {['email'].includes(form.channel) && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label className="text-xs">CTA Label</Label>
            <Input value={form.cta_label} onChange={e => set('cta_label', e.target.value)} placeholder="View Task" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">CTA URL</Label>
            <Input value={form.cta_url} onChange={e => set('cta_url', e.target.value)} placeholder="https://..." className="mt-1" />
          </div>
        </div>
      )}

      <Button
        onClick={() => onSave(form)}
        disabled={loading || !form.name || !form.body}
        className="w-full bg-amber-500 hover:bg-amber-600 py-5 font-semibold"
      >
        <Save className="h-4 w-4 mr-2" />
        {loading ? 'Saving...' : 'Save Template'}
      </Button>
    </div>
  );
}