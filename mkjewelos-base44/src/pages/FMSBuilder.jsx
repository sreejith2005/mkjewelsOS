const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, GitBranch, Play, Eye, Pencil, Trash2,
  Copy, ArrowRight, CheckCircle, Zap, BarChart3, Video, ExternalLink
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import FlowBuilder from '@/components/fms/FlowBuilder';
import FlowInstanceRunner from '@/components/fms/FlowInstanceRunner';
import FMSInstanceList from '@/components/fms/FMSInstanceList';

const CATEGORY_COLORS = {
  sales:     'bg-blue-100 text-blue-700',
  crm:       'bg-purple-100 text-purple-700',
  repair:    'bg-orange-100 text-orange-700',
  order:     'bg-green-100 text-green-700',
  hr:        'bg-pink-100 text-pink-700',
  inventory: 'bg-cyan-100 text-cyan-700',
  custom:    'bg-slate-100 text-slate-600',
};

export default function FMSBuilder() {
  const [view, setView] = useState('list'); // list | builder | runner | instances
  const [flows, setFlows] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedFlow, setSelectedFlow] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [platformUser, setPlatformUser] = useState(null);
  const [platformUserObj, setPlatformUserObj] = useState(null);
  const [activeTab, setActiveTab] = useState('flows'); // flows | instances

  useEffect(() => { init(); }, []);

  const init = async () => {
    try {
      const user = await db.auth.me();
      setPlatformUser(user);
      setPlatformUserObj(user);
      const profiles = await db.entities.UserProfile.filter({ user_id: user.id });
      if (profiles.length > 0) setUserProfile(profiles[0]);
    } catch {}
    await loadFlows();
  };

  const loadFlows = async () => {
    setLoading(true);
    const data = await db.entities.FMSFlow.list('-created_date', 100);
    setFlows(data);
    setLoading(false);
  };

  const handleCreate = () => {
    setSelectedFlow(null);
    setView('builder');
  };

  const handleEdit = (flow) => {
    setSelectedFlow(flow);
    setView('builder');
  };

  const handleSaveFlow = async (flowData) => {
    if (flowData.tenant_id === undefined && userProfile) {
      flowData.tenant_id = userProfile.tenant_id || 'default';
      flowData.branch_id = userProfile.branch_id;
    }
    if (selectedFlow?.id) {
      await db.entities.FMSFlow.update(selectedFlow.id, flowData);
    } else {
      await db.entities.FMSFlow.create(flowData);
    }
    await loadFlows();
    setView('list');
  };

  const handleDelete = async (flow) => {
    if (!window.confirm(`Delete "${flow.name}"?`)) return;
    await db.entities.FMSFlow.delete(flow.id);
    await loadFlows();
  };

  const handleDuplicate = async (flow) => {
    const copy = { ...flow, name: `${flow.name} (Copy)`, id: undefined, usage_count: 0, version: 1 };
    delete copy.id;
    await db.entities.FMSFlow.create(copy);
    await loadFlows();
  };

  const handleRunFlow = (flow) => {
    setSelectedFlow(flow);
    setView('runner');
  };

  const ALLOWED_EMAILS = ['contact.tech.hn@gmail.com', 'sanket.kadam.8898@gmail.com'];
  const isSuperAdmin = userProfile?.role_level === 'super_admin' || userProfile?.permissions?.includes('*') || platformUser?.role === 'admin' || ALLOWED_EMAILS.includes(platformUser?.email?.toLowerCase());

  const filtered = flows.filter(f =>
    f.name?.toLowerCase().includes(search.toLowerCase()) ||
    f.category?.toLowerCase().includes(search.toLowerCase())
  );

  const stats = {
    total: flows.length,
    active: flows.filter(f => f.is_active).length,
    categories: [...new Set(flows.map(f => f.category))].length,
  };

  if (view === 'builder') {
    return (
      <FlowBuilder
        flow={selectedFlow}
        userProfile={userProfile}
        onSave={handleSaveFlow}
        onBack={() => setView('list')}
      />
    );
  }

  if (view === 'runner') {
    return (
      <FlowInstanceRunner
        flow={selectedFlow}
        userProfile={userProfile}
        user={platformUserObj}
        onBack={() => setView('list')}
        onLaunched={() => { setView('instances'); setActiveTab('instances'); }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-indigo-900 via-indigo-800 to-purple-900 px-6 pt-16 pb-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center">
                <GitBranch className="h-4 w-4 text-white" />
              </div>
              <h1 className="text-2xl font-bold text-white">FMS Builder</h1>
            </div>
            <p className="text-indigo-300 text-sm">Flowchart Management System</p>
          </div>
          {isSuperAdmin && (
            <Button
              onClick={handleCreate}
              className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold"
            >
              <Plus className="h-4 w-4 mr-1" />
              New Flow
            </Button>
          )}
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          {[
            { label: 'Total Flows', value: stats.total, icon: GitBranch },
            { label: 'Active', value: stats.active, icon: CheckCircle },
            { label: 'Categories', value: stats.categories, icon: Zap },
          ].map(s => (
            <div key={s.label} className="bg-white/10 rounded-2xl p-3 text-center backdrop-blur-sm">
              <s.icon className="h-4 w-4 text-indigo-300 mx-auto mb-1" />
              <p className="text-xl font-bold text-white">{s.value}</p>
              <p className="text-[10px] text-indigo-300">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Quick Links: Video + Figma */}
        <div className="flex gap-2 mb-4">
          <a
            href="https://www.youtube.com/watch?v=YOUR_VIDEO_ID"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl px-3 py-2 transition-colors"
          >
            <div className="w-6 h-6 rounded-lg bg-red-500/80 flex items-center justify-center flex-shrink-0">
              <Video className="h-3 w-3 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-semibold leading-tight">Video Tutorial</p>
              <p className="text-indigo-300 text-[10px] truncate">Watch how FMS works</p>
            </div>
            <ExternalLink className="h-3 w-3 text-indigo-300 flex-shrink-0 ml-auto" />
          </a>
          <a
            href="https://www.figma.com/file/YOUR_FIGMA_FILE_ID"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center gap-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl px-3 py-2 transition-colors"
          >
            <div className="w-6 h-6 rounded-lg bg-purple-500/80 flex items-center justify-center flex-shrink-0">
              <ExternalLink className="h-3 w-3 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-semibold leading-tight">Figma Design</p>
              <p className="text-indigo-300 text-[10px] truncate">View flow diagrams</p>
            </div>
            <ExternalLink className="h-3 w-3 text-indigo-300 flex-shrink-0 ml-auto" />
          </a>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search flows..."
            className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-indigo-300 rounded-xl"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4 flex gap-2">
        {[
          { key: 'flows', label: 'Flow Library', icon: GitBranch },
          { key: 'instances', label: 'Live Instances', icon: Play },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-medium transition-all ${
              activeTab === tab.key
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-indigo-300'
            }`}
          >
            <tab.icon className="h-3.5 w-3.5" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="px-6 pt-4">
        {activeTab === 'flows' ? (
          loading ? (
            <div className="space-y-3">
              {[1,2,3].map(i => <div key={i} className="h-32 bg-slate-200 animate-pulse rounded-2xl" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <GitBranch className="h-8 w-8 text-indigo-400" />
              </div>
              <p className="text-slate-600 font-semibold mb-1">No flows yet</p>
              <p className="text-slate-400 text-sm mb-4">Build your first flowchart to automate work</p>
              {isSuperAdmin && (
                <Button onClick={handleCreate} className="bg-indigo-600 hover:bg-indigo-700">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Flow
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <AnimatePresence>
                {filtered.map((flow, i) => (
                  <motion.div
                    key={flow.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="bg-white rounded-2xl border border-slate-100 p-4 shadow-sm"
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h3 className="font-bold text-slate-800 text-base">{flow.name}</h3>
                          <Badge className={`text-[10px] ${CATEGORY_COLORS[flow.category] || CATEGORY_COLORS.custom}`}>
                            {flow.category}
                          </Badge>
                          {!flow.is_active && (
                            <Badge className="text-[10px] bg-red-100 text-red-600">Inactive</Badge>
                          )}
                        </div>
                        {flow.description && (
                          <p className="text-slate-500 text-xs line-clamp-1">{flow.description}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mb-3 text-xs text-slate-400">
                      <span className="flex items-center gap-1">
                        <GitBranch className="h-3 w-3" />
                        {flow.steps?.length || 0} steps
                      </span>
                      <span>v{flow.version || 1}</span>
                      <span>Used {flow.usage_count || 0}×</span>
                    </div>

                    {/* Step preview chips */}
                    {flow.steps && flow.steps.length > 0 && (
                      <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-1">
                        {flow.steps.slice(0, 5).map((step, si) => (
                          <React.Fragment key={step.id}>
                            <span className={`flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full font-medium ${
                              step.type === 'branch' ? 'bg-amber-100 text-amber-700' :
                              step.type === 'parallel_start' ? 'bg-purple-100 text-purple-700' :
                              step.type === 'form' ? 'bg-blue-100 text-blue-700' :
                              'bg-slate-100 text-slate-600'
                            }`}>
                              {step.name}
                            </span>
                            {si < Math.min(flow.steps.length - 1, 4) && (
                              <ArrowRight className="h-2.5 w-2.5 text-slate-300 flex-shrink-0" />
                            )}
                          </React.Fragment>
                        ))}
                        {flow.steps.length > 5 && (
                          <span className="text-[10px] text-slate-400">+{flow.steps.length - 5} more</span>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        onClick={() => handleRunFlow(flow)}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-xs h-8 rounded-xl"
                      >
                        <Play className="h-3 w-3 mr-1" />
                        Start Instance
                      </Button>
                      {isSuperAdmin && (
                        <>
                          <button
                            onClick={() => handleEdit(flow)}
                            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-amber-100 flex items-center justify-center text-slate-500 hover:text-amber-600 transition-colors"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDuplicate(flow)}
                            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-blue-100 flex items-center justify-center text-slate-500 hover:text-blue-600 transition-colors"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(flow)}
                            className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-rose-100 flex items-center justify-center text-slate-500 hover:text-rose-500 transition-colors"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )
        ) : (
          <FMSInstanceList userProfile={userProfile} user={platformUserObj} />
        )}
      </div>
    </div>
  );
}