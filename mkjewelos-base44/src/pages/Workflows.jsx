const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { motion } from 'framer-motion';
import { 
  Plus, GitBranch, Play, Settings2,
  Search, ChevronRight, Layers, Activity
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import WorkflowCard from '@/components/workflow/WorkflowCard';
import WorkflowInstanceCard from '@/components/workflow/WorkflowInstanceCard';
import { Button as Btn } from '@/components/ui/button';

export default function Workflows() {
  const [workflows, setWorkflows] = useState([]);
  const [instances, setInstances] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [selectedWorkflow, setSelectedWorkflow] = useState(null);
  const [saving, setSaving] = useState(false);
  const [userProfile, setUserProfile] = useState(null);
  const [activeTab, setActiveTab] = useState('templates');
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    category: 'sales',
    trigger_type: 'manual',
    stages: [],
    is_active: true,
  });
  const [stageName, setStageName] = useState('');

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    try {
      const currentUser = await db.auth.me();
      const profiles = await db.entities.UserProfile.filter({ user_id: currentUser.id });
      if (profiles.length > 0) setUserProfile(profiles[0]);
    } catch (e) {}
    await loadData();
  };

  const loadData = async () => {
    setLoading(true);
    const [wfs, insts] = await Promise.all([
      db.entities.Workflow.list('-created_date', 50),
      db.entities.WorkflowInstance.list('-created_date', 50),
    ]);
    setWorkflows(wfs);
    setInstances(insts);
    setLoading(false);
  };

  const addStage = () => {
    if (!stageName.trim()) return;
    setFormData(prev => ({
      ...prev,
      stages: [
        ...prev.stages,
        { id: `stage_${Date.now()}`, name: stageName, order: prev.stages.length, sla_hours: 24 }
      ]
    }));
    setStageName('');
  };

  const removeStage = (id) => {
    setFormData(prev => ({
      ...prev,
      stages: prev.stages.filter(s => s.id !== id)
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    const data = { ...formData };
    if (userProfile) {
      data.tenant_id = userProfile.tenant_id;
      data.branch_id = userProfile.branch_id;
    }
    if (selectedWorkflow) {
      await db.entities.Workflow.update(selectedWorkflow.id, data);
    } else {
      await db.entities.Workflow.create(data);
    }
    await loadData();
    setSaving(false);
    setShowForm(false);
    resetForm();
  };

  const resetForm = () => {
    setFormData({ name: '', description: '', category: 'sales', trigger_type: 'manual', stages: [], is_active: true });
    setSelectedWorkflow(null);
  };

  const openWorkflow = (workflow) => {
    setSelectedWorkflow(workflow);
    setFormData({ ...workflow });
    setShowForm(true);
  };

  const filteredWorkflows = workflows.filter(w =>
    w.name?.toLowerCase().includes(search.toLowerCase()) ||
    w.category?.includes(search.toLowerCase())
  );

  const filteredInstances = instances.filter(i =>
    i.reference_number?.toLowerCase().includes(search.toLowerCase()) ||
    i.current_stage_name?.toLowerCase().includes(search.toLowerCase())
  );

  const workflowMap = Object.fromEntries(workflows.map(w => [w.id, w.name]));

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 pt-16 pb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Workflows</h1>
            <p className="text-slate-400 text-sm mt-1">Process Management System</p>
          </div>
          <Button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl"
          >
            <Plus className="h-4 w-4 mr-1" />
            Build
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Templates', value: workflows.length, color: 'bg-violet-500/20 text-violet-300' },
            { label: 'Active', value: instances.filter(i => i.status === 'active').length, color: 'bg-blue-500/20 text-blue-300' },
            { label: 'Done', value: instances.filter(i => i.status === 'completed').length, color: 'bg-emerald-500/20 text-emerald-300' },
          ].map(stat => (
            <div key={stat.label} className={`${stat.color} rounded-xl p-3 text-center`}>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs opacity-80 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workflows..."
            className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-slate-400 rounded-xl"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4">
        <div className="flex gap-2 mb-4">
          {[
            { key: 'templates', label: 'Templates', icon: Layers },
            { key: 'instances', label: 'Running', icon: Activity },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-2 rounded-full text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200'
              }`}
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {loading ? (
          [1,2,3].map(i => <div key={i} className="h-24 bg-slate-200 animate-pulse rounded-xl mb-3" />)
        ) : activeTab === 'templates' ? (
          <div className="space-y-3">
            {filteredWorkflows.length === 0 ? (
              <div className="text-center py-16">
                <GitBranch className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No workflows yet</p>
                <Button onClick={() => setShowForm(true)} className="mt-4 bg-amber-500 hover:bg-amber-600">
                  <Plus className="h-4 w-4 mr-2" />
                  Build Workflow
                </Button>
              </div>
            ) : filteredWorkflows.map((wf, i) => (
              <WorkflowCard key={wf.id} workflow={wf} index={i} onClick={openWorkflow} />
            ))}
          </div>
        ) : (
          <div className="space-y-3">
            {filteredInstances.length === 0 ? (
              <div className="text-center py-16">
                <Activity className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No running workflows</p>
              </div>
            ) : filteredInstances.map((inst, i) => (
              <WorkflowInstanceCard
                key={inst.id}
                instance={inst}
                workflowName={workflowMap[inst.workflow_id]}
                index={i}
                onClick={() => {}}
              />
            ))}
          </div>
        )}
      </div>

      {/* Workflow Builder Sheet */}
      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent side="bottom" className="h-[92vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-6">
            <SheetTitle className="flex items-center gap-2">
              <GitBranch className="h-5 w-5 text-violet-500" />
              {selectedWorkflow ? 'Edit Workflow' : 'Build Workflow'}
            </SheetTitle>
          </SheetHeader>

          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <Label>Workflow Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Repair Order Process"
                />
              </div>
              <div>
                <Label>Category</Label>
                <Select value={formData.category} onValueChange={(v) => setFormData(p => ({ ...p, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['sales', 'order', 'repair', 'custom_order', 'return', 'quality', 'inventory', 'customer_service'].map(c => (
                      <SelectItem key={c} value={c}>{c.replace('_', ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Trigger</Label>
                <Select value={formData.trigger_type} onValueChange={(v) => setFormData(p => ({ ...p, trigger_type: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['manual', 'on_create', 'on_update', 'scheduled'].map(t => (
                      <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData(p => ({ ...p, description: e.target.value }))}
                placeholder="Describe this workflow..."
                className="h-20"
              />
            </div>

            {/* Stage Builder */}
            <div>
              <Label className="mb-3 block">Workflow Stages</Label>
              <div className="space-y-2">
                {formData.stages?.map((stage, i) => (
                  <div key={stage.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-3 border border-slate-200">
                    <div className="w-7 h-7 rounded-lg bg-violet-500 text-white flex items-center justify-center text-xs font-bold">
                      {i + 1}
                    </div>
                    <span className="flex-1 font-medium text-sm">{stage.name}</span>
                    <button
                      onClick={() => removeStage(stage.id)}
                      className="text-slate-400 hover:text-rose-500 transition-colors"
                    >
                      ×
                    </button>
                  </div>
                ))}

                <div className="flex gap-2">
                  <Input
                    value={stageName}
                    onChange={(e) => setStageName(e.target.value)}
                    placeholder="Add stage name..."
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addStage())}
                    className="flex-1"
                  />
                  <Button type="button" variant="outline" onClick={addStage} className="shrink-0">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl">
              <Switch
                checked={formData.is_active}
                onCheckedChange={(v) => setFormData(p => ({ ...p, is_active: v }))}
              />
              <div>
                <p className="font-medium text-sm">Active</p>
                <p className="text-xs text-slate-400">Enable this workflow for use</p>
              </div>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setShowForm(false)} className="flex-1">
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !formData.name}
                className="flex-1 bg-violet-500 hover:bg-violet-600"
              >
                {saving ? 'Saving...' : (selectedWorkflow ? 'Update' : 'Create Workflow')}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}