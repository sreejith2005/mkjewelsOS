const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect, useCallback } from 'react';

import { motion, AnimatePresence } from 'framer-motion';
import { 
  ClipboardList, Plus, Search, Filter, Repeat, 
  AlertCircle, CheckCircle2, Clock, UserCheck, RefreshCw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { format } from 'date-fns';
import TaskInstanceCard from '@/components/tasks/TaskInstanceCard';
import DelegateTaskSheet from '@/components/tasks/DelegateTaskSheet';
import RecurringTaskForm from '@/components/tasks/RecurringTaskForm';
import { 
  generateTodayInstances, filterTasksByRole, 
  delegateTask, updateChecklistItem, completeTaskInstance, calcChecklistPct 
} from '@/components/tasks/recurringTaskEngine';
import { makeOwnerProfile } from '@/components/auth/ownerUtils';

export default function MyTasks() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [instances, setInstances] = useState([]);
  const [recurringTasks, setRecurringTasks] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [allProfiles, setAllProfiles] = useState([]);
  const [search, setSearch] = useState('');
  const [recurrenceFilter, setRecurrenceFilter] = useState('all');
  const [activeTab, setActiveTab] = useState('today');
  const [loading, setLoading] = useState(true);
  const [delegating, setDelegating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taskToDelegate, setTaskToDelegate] = useState(null);
  const [showRecurringForm, setShowRecurringForm] = useState(false);
  const [selectedRecurring, setSelectedRecurring] = useState(null);
  const [generating, setGenerating] = useState(false);

  useEffect(() => { init(); }, []);

  const init = async () => {
    setLoading(true);
    try {
      const currentUser = await db.auth.me();
      setUser(currentUser);
      const [profiles, depts, users, allProfs] = await Promise.all([
        db.entities.UserProfile.filter({ user_id: currentUser.id }),
        db.entities.Department.list(),
        db.entities.User.list(),
        db.entities.UserProfile.list(),
      ]);
      const profile = profiles[0] || (currentUser.role === 'admin' ? makeOwnerProfile(currentUser) : null);
      setUserProfile(profile);
      setDepartments(depts);
      setAllUsers(users);
      setAllProfiles(allProfs);

      if (profile && profile.tenant_id) {
        setGenerating(true);
        await generateTodayInstances(profile);
        setGenerating(false);
      }
    } catch (e) { console.error(e); }
    await loadInstances();
    await loadRecurring();
    setLoading(false);
  };

  const loadInstances = async () => {
    const all = await db.entities.TaskInstance.list('-due_date', 200);
    setInstances(all);
  };

  const loadRecurring = async () => {
    const all = await db.entities.RecurringTask.list('-created_date', 100);
    setRecurringTasks(all);
  };

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  const getFilteredInstances = () => {
    let tasks = filterTasksByRole(instances, userProfile);
    if (recurrenceFilter !== 'all') {
      tasks = tasks.filter(t => t.recurrence_type === recurrenceFilter);
    }
    if (search) {
      const q = search.toLowerCase();
      tasks = tasks.filter(t =>
        t.title?.toLowerCase().includes(q) ||
        t.description?.toLowerCase().includes(q)
      );
    }
    return tasks;
  };

  const todayTasks = getFilteredInstances().filter(t => t.due_date_only === todayStr);
  const delegatedTasks = getFilteredInstances().filter(t => t.is_delegated);
  const allTasks = getFilteredInstances();

  const stats = {
    todayTotal: todayTasks.length,
    todayDone: todayTasks.filter(t => t.status === 'completed').length,
    todayPct: todayTasks.length > 0 ? Math.round((todayTasks.filter(t => t.status === 'completed').length / todayTasks.length) * 100) : 0,
    overdue: allTasks.filter(t => t.status === 'overdue').length,
    delegated: delegatedTasks.length,
  };

  const handleChecklistToggle = async (task, itemId, checked) => {
    const { updatedChecklist } = await updateChecklistItem(task, itemId, checked, user?.id);
    setInstances(prev => prev.map(t =>
      t.id === task.id
        ? { ...t, checklist: updatedChecklist, ...calcChecklistPct(updatedChecklist) }
        : t
    ));
  };

  const handleComplete = async (task) => {
    await completeTaskInstance(task, user?.id, '');
    setInstances(prev => prev.map(t =>
      t.id === task.id ? { ...t, status: 'completed', completed_at: new Date().toISOString() } : t
    ));
  };

  const handleDelegate = async (task, toUserId, reason) => {
    setDelegating(true);
    await delegateTask(task, toUserId, reason, user?.id, userProfile);
    setDelegating(false);
    setTaskToDelegate(null);
    await loadInstances();
  };

  const handleSaveRecurring = async (formData) => {
    setSaving(true);
    if (userProfile) {
      formData.tenant_id = userProfile.tenant_id;
      formData.branch_id = userProfile.branch_id;
      formData.created_by = user?.id;
    }
    if (selectedRecurring) {
      await db.entities.RecurringTask.update(selectedRecurring.id, formData);
    } else {
      await db.entities.RecurringTask.create(formData);
    }
    setSaving(false);
    setShowRecurringForm(false);
    setSelectedRecurring(null);
    await loadRecurring();
  };

  const canManageRecurring = ['super_admin', 'tenant_admin', 'branch_manager', 'department_head'].includes(userProfile?.role_level);

  const renderTaskList = (tasks) => {
    if (tasks.length === 0) {
      return (
        <div className="text-center py-12">
          <CheckCircle2 className="h-10 w-10 text-emerald-300 mx-auto mb-3" />
          <p className="text-slate-500 font-medium">All clear!</p>
          <p className="text-slate-400 text-sm">No tasks here</p>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {tasks.map((task, i) => (
          <TaskInstanceCard
            key={task.id}
            task={task}
            index={i}
            currentUserId={user?.id}
            onChecklistToggle={handleChecklistToggle}
            onComplete={handleComplete}
            onDelegate={(t) => setTaskToDelegate(t)}
            onOpen={() => {}}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 pt-16 pb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">My Tasks</h1>
            <p className="text-slate-400 text-sm mt-1">
              {generating ? 'Generating today\'s tasks...' : `Dept-wise Recurring Task Management`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={() => init()}
              className="bg-white/10 border-white/20 text-white hover:bg-white/20"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {canManageRecurring && (
              <Button
                onClick={() => { setSelectedRecurring(null); setShowRecurringForm(true); }}
                className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl"
              >
                <Plus className="h-4 w-4 mr-1" />
                Schedule
              </Button>
            )}
          </div>
        </div>

        {/* Today stats */}
        <div className="bg-white/10 rounded-2xl p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-white font-medium text-sm">Today's Completion</p>
            <span className="text-white text-xl font-bold">{stats.todayPct}%</span>
          </div>
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-emerald-400 rounded-full"
              initial={{ width: 0 }}
              animate={{ width: `${stats.todayPct}%` }}
              transition={{ duration: 0.8 }}
            />
          </div>
          <div className="grid grid-cols-3 gap-3 mt-4">
            {[
              { label: 'Today', value: stats.todayTotal, color: 'text-blue-300' },
              { label: 'Done', value: stats.todayDone, color: 'text-emerald-300' },
              { label: 'Delegated', value: stats.delegated, color: 'text-violet-300' },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-white/60 text-xs">{s.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks..."
            className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-slate-400 rounded-xl"
          />
        </div>
      </div>

      {/* Recurrence filter pills */}
      <div className="px-6 py-4 flex gap-2 overflow-x-auto">
        {['all', 'daily', 'weekly', 'monthly', 'yearly'].map(r => (
          <button
            key={r}
            onClick={() => setRecurrenceFilter(r)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              recurrenceFilter === r
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            {r !== 'all' && <Repeat className="h-3 w-3" />}
            {r.charAt(0).toUpperCase() + r.slice(1)}
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="px-6">
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {[
            { key: 'today', label: "Today", count: todayTasks.length },
            { key: 'delegated', label: "Delegated", count: delegatedTasks.length },
            { key: 'all', label: "All Tasks", count: allTasks.length },
            ...(canManageRecurring ? [{ key: 'schedules', label: "Schedules", count: recurringTasks.length }] : []),
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
                activeTab === tab.key
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'bg-white text-slate-600 border border-slate-200'
              }`}
            >
              {tab.label}
              <span className={`text-xs rounded-full px-1.5 py-0.5 ${
                activeTab === tab.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
              }`}>{tab.count}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-24 bg-slate-200 animate-pulse rounded-2xl" />)}
          </div>
        ) : activeTab === 'today' ? (
          renderTaskList(todayTasks)
        ) : activeTab === 'delegated' ? (
          renderTaskList(delegatedTasks)
        ) : activeTab === 'all' ? (
          renderTaskList(allTasks)
        ) : (
          // Schedules tab
          <div className="space-y-3">
            {recurringTasks.length === 0 ? (
              <div className="text-center py-12">
                <Repeat className="h-10 w-10 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No recurring tasks scheduled</p>
                <Button onClick={() => setShowRecurringForm(true)} className="mt-4 bg-amber-500 hover:bg-amber-600">
                  <Plus className="h-4 w-4 mr-2" />
                  Create Schedule
                </Button>
              </div>
            ) : recurringTasks.map((rt, i) => (
              <motion.div
                key={rt.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="bg-white rounded-2xl border border-slate-100 p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-lg ${rt.is_active ? 'bg-emerald-100' : 'bg-slate-100'}`}>
                      {rt.recurrence_type === 'daily' ? '📅' : rt.recurrence_type === 'weekly' ? '📆' : rt.recurrence_type === 'monthly' ? '🗓️' : '🎯'}
                    </div>
                    <div>
                      <p className="font-semibold text-slate-800">{rt.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <Badge variant="outline" className="text-[10px] capitalize">{rt.recurrence_type}</Badge>
                        <span className="text-xs text-slate-400">{rt.recurrence_time || 'EOD'}</span>
                        {rt.checklist?.length > 0 && (
                          <span className="text-xs text-slate-400">{rt.checklist.length} checklist items</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setSelectedRecurring(rt); setShowRecurringForm(true); }}
                    className="text-slate-400 hover:text-amber-500"
                  >
                    Edit
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Delegate Sheet */}
      <DelegateTaskSheet
        open={!!taskToDelegate}
        onClose={() => setTaskToDelegate(null)}
        task={taskToDelegate}
        users={allUsers}
        userProfiles={allProfiles}
        onDelegate={handleDelegate}
        loading={delegating}
      />

      {/* Recurring Task Form Sheet */}
      <Sheet open={showRecurringForm} onOpenChange={setShowRecurringForm}>
        <SheetContent side="bottom" className="h-[92vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-6">
            <SheetTitle className="flex items-center gap-2">
              <Repeat className="h-5 w-5 text-amber-500" />
              {selectedRecurring ? 'Edit Recurring Task' : 'Schedule Recurring Task'}
            </SheetTitle>
          </SheetHeader>
          <RecurringTaskForm
            task={selectedRecurring}
            departments={departments}
            users={allUsers}
            onSave={handleSaveRecurring}
            onCancel={() => setShowRecurringForm(false)}
            loading={saving}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}