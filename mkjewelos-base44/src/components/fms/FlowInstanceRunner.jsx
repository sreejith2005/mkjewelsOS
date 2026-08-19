const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { ArrowLeft, Play, User, Link2, AlignJustify, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

export default function FlowInstanceRunner({ flow, userProfile, onBack, onLaunched }) {
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('medium');
  const [relatedEntity, setRelatedEntity] = useState('');
  const [relatedId, setRelatedId] = useState('');
  const [notes, setNotes] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    db.entities.User.list().then(setUsers).catch(() => {});
  }, []);

  const buildInitialStepStates = () => {
    if (!flow?.steps?.length) return [];
    const firstStep = flow.steps.sort((a, b) => (a.order || 0) - (b.order || 0))[0];
    return flow.steps.map(step => ({
      step_id: step.id,
      step_name: step.name,
      status: step.id === firstStep.id ? 'active' : 'pending',
      assigned_to: step.assignee_rule?.type === 'specific_user' ? step.assignee_rule.value : '',
      assigned_to_name: '',
      planned_at: step.id === firstStep.id ? new Date(Date.now() + (step.sla_rule?.minutes || 60) * 60000).toISOString() : null,
      sla_breached: false,
      delay_minutes: 0,
    }));
  };

  const handleLaunch = async () => {
    if (!title) return;
    setLoading(true);
    const refNum = `FMS-${Date.now().toString(36).toUpperCase()}`;
    const instance = {
      tenant_id: userProfile?.tenant_id || flow?.tenant_id || 'default',
      branch_id: userProfile?.branch_id || flow?.branch_id || '',
      flow_id: flow.id,
      flow_name: flow.name,
      reference_number: refNum,
      title,
      status: 'active',
      priority,
      started_by: userProfile?.user_id || '',
      started_at: new Date().toISOString(),
      related_entity: relatedEntity || '',
      related_entity_id: relatedId || '',
      context: { notes },
      current_step_ids: flow.steps?.length ? [flow.steps.sort((a,b)=>(a.order||0)-(b.order||0))[0].id] : [],
      step_states: buildInitialStepStates(),
      sla_breached: false,
      total_delay_minutes: 0,
    };
    await db.entities.FMSInstance.create(instance);
    // Bump usage count
    await db.entities.FMSFlow.update(flow.id, { usage_count: (flow.usage_count || 0) + 1 });
    setLoading(false);
    onLaunched?.();
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <div className="bg-gradient-to-r from-indigo-900 to-purple-900 px-4 pt-16 pb-6">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} className="p-2 rounded-xl bg-white/10 text-white">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h2 className="text-lg font-bold text-white">Start Instance</h2>
            <p className="text-indigo-300 text-xs">{flow?.name}</p>
          </div>
        </div>
        {/* Step preview */}
        {flow?.steps && (
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {flow.steps.slice(0,6).map((s,i) => (
              <React.Fragment key={s.id}>
                <span className="flex-shrink-0 text-[10px] px-2 py-0.5 bg-white/10 text-indigo-200 rounded-full">{s.name}</span>
                {i < Math.min(flow.steps.length-1,5) && <span className="text-indigo-400 text-xs flex-shrink-0">›</span>}
              </React.Fragment>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pt-5 space-y-4">
        <div className="bg-white rounded-2xl border border-slate-100 p-4 space-y-4">
          <h3 className="font-bold text-slate-700 text-sm flex items-center gap-2">
            <Play className="h-4 w-4 text-indigo-500" />
            Instance Details
          </h3>

          <div>
            <Label className="text-xs">Title / Reference *</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Lead: Priya Sharma" className="mt-1" />
          </div>

          <div>
            <Label className="text-xs">Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['low','medium','high','urgent'].map(p => (
                  <SelectItem key={p} value={p} className="capitalize">{p}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Related To</Label>
              <Input value={relatedEntity} onChange={e => setRelatedEntity(e.target.value)} placeholder="e.g. Customer" className="mt-1 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Record Name / ID</Label>
              <Input value={relatedId} onChange={e => setRelatedId(e.target.value)} placeholder="Name or ID" className="mt-1 text-sm" />
            </div>
          </div>

          <div>
            <Label className="text-xs">Opening Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Any context to pass through the flow…" className="mt-1 h-20 resize-none text-sm" />
          </div>
        </div>

        <Button
          onClick={handleLaunch}
          disabled={loading || !title}
          className="w-full bg-indigo-600 hover:bg-indigo-700 py-6 text-base font-semibold rounded-2xl"
        >
          <Play className="h-5 w-5 mr-2" />
          {loading ? 'Launching…' : 'Launch Flow Instance'}
        </Button>
      </div>
    </div>
  );
}