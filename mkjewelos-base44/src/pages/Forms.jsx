const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { motion } from 'framer-motion';
import { 
  Plus, FileText, Search, Edit2, Send, 
  ClipboardList, BarChart, Eye, Trash2, Tag
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import FormBuilderCanvas from '@/components/forms/FormBuilderCanvas';
import FormRenderer from '@/components/forms/FormRenderer';
import SubmissionViewer from '@/components/forms/SubmissionViewer';
import { canAccessForm } from '@/components/forms/formEngine';

const categoryColors = {
  crm: 'bg-blue-100 text-blue-700',
  task: 'bg-emerald-100 text-emerald-700',
  pms_stage: 'bg-violet-100 text-violet-700',
  hr: 'bg-pink-100 text-pink-700',
  inventory: 'bg-amber-100 text-amber-700',
  repair: 'bg-orange-100 text-orange-700',
  feedback: 'bg-cyan-100 text-cyan-700',
  inspection: 'bg-indigo-100 text-indigo-700',
  audit: 'bg-rose-100 text-rose-700',
  custom: 'bg-slate-100 text-slate-600',
};

export default function Forms() {
  const [forms, setForms] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [showFill, setShowFill] = useState(false);
  const [showSubmissions, setShowSubmissions] = useState(false);
  const [selectedForm, setSelectedForm] = useState(null);
  const [activeTab, setActiveTab] = useState('forms');
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);

  useEffect(() => { init(); }, []);

  const init = async () => {
    try {
      const currentUser = await db.auth.me();
      setUser(currentUser);
      const profiles = await db.entities.UserProfile.filter({ user_id: currentUser.id });
      if (profiles.length > 0) setUserProfile(profiles[0]);
    } catch (e) {}
    await loadData();
  };

  const loadData = async () => {
    setLoading(true);
    const [fms, subs] = await Promise.all([
      db.entities.FormTemplate.list('-created_date', 100),
      db.entities.FormSubmission.list('-created_date', 200),
    ]);
    setForms(fms);
    setSubmissions(subs);
    setLoading(false);
  };

  const handleSaveForm = async (formData) => {
    setSaving(true);
    if (userProfile) {
      formData.tenant_id = userProfile.tenant_id;
      formData.branch_id = userProfile.branch_id;
      formData.department_id = userProfile.department_id;
    }
    if (selectedForm) {
      await db.entities.FormTemplate.update(selectedForm.id, formData);
    } else {
      await db.entities.FormTemplate.create(formData);
    }
    await loadData();
    setSaving(false);
    setShowBuilder(false);
    setSelectedForm(null);
  };

  const openFill = (form) => {
    if (!canAccessForm(form, userProfile)) {
      alert('You do not have permission to submit this form.');
      return;
    }
    setSelectedForm(form);
    setShowFill(true);
  };

  const openBuilder = (form = null) => {
    setSelectedForm(form);
    setShowBuilder(true);
  };

  const openSubmissions = (form) => {
    setSelectedForm(form);
    setShowSubmissions(true);
  };

  const isManager = ['super_admin', 'tenant_admin', 'branch_manager', 'department_head'].includes(userProfile?.role_level);

  const filteredForms = forms.filter(f => {
    const matchSearch = f.name?.toLowerCase().includes(search.toLowerCase());
    const matchCategory = categoryFilter === 'all' || f.category === categoryFilter;
    return matchSearch && matchCategory;
  });

  const formSubmissions = selectedForm
    ? submissions.filter(s => s.form_template_id === selectedForm.id)
    : submissions;

  const stats = {
    total: forms.length,
    active: forms.filter(f => f.is_active).length,
    submissions: submissions.length,
    pending: submissions.filter(s => s.status === 'submitted').length,
  };

  const categories = ['all', ...new Set(forms.map(f => f.category).filter(Boolean))];

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 pt-16 pb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Forms</h1>
            <p className="text-slate-400 text-sm mt-1">Universal Form Engine</p>
          </div>
          {isManager && (
            <Button
              onClick={() => openBuilder(null)}
              className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl"
            >
              <Plus className="h-4 w-4 mr-1" />
              Build
            </Button>
          )}
        </div>

        <div className="grid grid-cols-4 gap-2 mb-6">
          {[
            { label: 'Total', value: stats.total, color: 'bg-blue-500/20 text-blue-300' },
            { label: 'Active', value: stats.active, color: 'bg-emerald-500/20 text-emerald-300' },
            { label: 'Responses', value: stats.submissions, color: 'bg-violet-500/20 text-violet-300' },
            { label: 'Pending', value: stats.pending, color: 'bg-amber-500/20 text-amber-300' },
          ].map(s => (
            <div key={s.label} className={`${s.color} rounded-xl p-2 text-center`}>
              <p className="text-xl font-bold">{s.value}</p>
              <p className="text-xs opacity-80">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search forms..."
            className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-slate-400 rounded-xl"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4">
        <div className="flex gap-2 mb-4">
          {[
            { key: 'forms', label: 'Templates', icon: FileText },
            { key: 'submissions', label: 'Responses', icon: ClipboardList },
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

        {/* Category filters */}
        {activeTab === 'forms' && (
          <div className="flex gap-2 overflow-x-auto pb-3 mb-2">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all capitalize ${
                  categoryFilter === cat
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-600 border border-slate-200'
                }`}
              >
                {cat === 'all' ? 'All' : cat.replace('_', ' ')}
              </button>
            ))}
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-24 bg-slate-200 animate-pulse rounded-2xl" />)}
          </div>
        ) : activeTab === 'forms' ? (
          <div className="space-y-3">
            {filteredForms.length === 0 ? (
              <div className="text-center py-16">
                <FileText className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 font-medium">No forms yet</p>
                {isManager && (
                  <Button onClick={() => openBuilder(null)} className="mt-4 bg-amber-500 hover:bg-amber-600">
                    <Plus className="h-4 w-4 mr-2" />
                    Build First Form
                  </Button>
                )}
              </div>
            ) : filteredForms.map((form, i) => {
              const formSubs = submissions.filter(s => s.form_template_id === form.id);
              return (
                <motion.div
                  key={form.id}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="bg-white rounded-2xl border border-slate-100 p-4 hover:shadow-lg hover:border-amber-200 transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center flex-shrink-0 text-xl">
                      {form.category === 'crm' ? '📞' : form.category === 'repair' ? '🔧' :
                       form.category === 'audit' ? '📋' : form.category === 'hr' ? '👤' : '📝'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-800 truncate">{form.name}</h3>
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${form.is_active ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                      </div>
                      {form.description && (
                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">{form.description}</p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge className={`text-[10px] ${categoryColors[form.category] || categoryColors.custom}`}>
                          {form.category?.replace('_', ' ')}
                        </Badge>
                        <span className="text-xs text-slate-400">{form.fields?.length || 0} fields</span>
                        <span className="text-xs text-slate-400">·</span>
                        <span className="text-xs text-slate-400">{formSubs.length} responses</span>
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      {isManager && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openSubmissions(form)}
                            className="h-8 w-8 text-slate-400 hover:text-blue-500"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openBuilder(form)}
                            className="h-8 w-8 text-slate-400 hover:text-amber-500"
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        onClick={() => openFill(form)}
                        className="h-8 bg-amber-500 hover:bg-amber-600 text-xs"
                      >
                        <Send className="h-3 w-3 mr-1" />
                        Fill
                      </Button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            {submissions.length === 0 ? (
              <div className="text-center py-16">
                <ClipboardList className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No responses yet</p>
              </div>
            ) : submissions.map((sub, i) => (
              <SubmissionViewer
                key={sub.id}
                submission={sub}
                canReview={isManager}
                onStatusChange={loadData}
                index={i}
              />
            ))}
          </div>
        )}
      </div>

      {/* Form Builder Sheet */}
      <Sheet open={showBuilder} onOpenChange={setShowBuilder}>
        <SheetContent side="bottom" className="h-[95vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-4">
            <SheetTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-amber-500" />
              {selectedForm ? 'Edit Form' : 'Build New Form'}
            </SheetTitle>
          </SheetHeader>
          <FormBuilderCanvas
            form={selectedForm}
            onSave={handleSaveForm}
            loading={saving}
          />
        </SheetContent>
      </Sheet>

      {/* Form Fill Sheet */}
      <Sheet open={showFill} onOpenChange={setShowFill}>
        <SheetContent side="bottom" className="h-[88vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-6">
            <SheetTitle>{selectedForm?.name}</SheetTitle>
            {selectedForm?.description && (
              <p className="text-sm text-slate-500 text-left">{selectedForm.description}</p>
            )}
          </SheetHeader>
          {selectedForm && (
            <FormRenderer
              form={selectedForm}
              userProfile={userProfile}
              user={user}
              onSuccess={() => { setShowFill(false); loadData(); }}
              onCancel={() => setShowFill(false)}
            />
          )}
        </SheetContent>
      </Sheet>

      {/* Submissions Sheet */}
      <Sheet open={showSubmissions} onOpenChange={setShowSubmissions}>
        <SheetContent side="bottom" className="h-[88vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-6">
            <SheetTitle>
              Responses: {selectedForm?.name}
              <span className="ml-2 text-slate-400 font-normal text-sm">({formSubmissions.length})</span>
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-3">
            {formSubmissions.length === 0 ? (
              <div className="text-center py-12">
                <ClipboardList className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-400">No responses yet</p>
              </div>
            ) : formSubmissions.map((sub, i) => (
              <SubmissionViewer
                key={sub.id}
                submission={sub}
                canReview={isManager}
                onStatusChange={loadData}
                index={i}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}