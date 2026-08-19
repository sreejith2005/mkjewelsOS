const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { motion, AnimatePresence } from 'framer-motion';
import { 
  Plus, Search, Filter, ClipboardList, 
  CheckCircle2, Clock, AlertCircle, SlidersHorizontal
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TaskCard from '@/components/tasks/TaskCard';
import TaskForm from '@/components/tasks/TaskForm';
import { format } from 'date-fns';

export default function Tasks() {
  const [tasks, setTasks] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [viewTask, setViewTask] = useState(null);
  const [userProfile, setUserProfile] = useState(null);

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    filterTasks();
  }, [search, statusFilter, tasks]);

  const init = async () => {
    try {
      const currentUser = await db.auth.me();
      const profiles = await db.entities.UserProfile.filter({ user_id: currentUser.id });
      if (profiles.length > 0) setUserProfile(profiles[0]);
      
      const [depts, userList] = await Promise.all([
        db.entities.Department.list(),
        db.entities.User.list(),
      ]);
      setDepartments(depts);
      setUsers(userList);
    } catch(e) {}
    await loadTasks();
  };

  const loadTasks = async () => {
    setLoading(true);
    const data = await db.entities.Task.list('-created_date', 100);
    setTasks(data);
    setLoading(false);
  };

  const filterTasks = () => {
    let result = [...tasks];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(t => t.title?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') {
      result = result.filter(t => t.status === statusFilter);
    }
    setFiltered(result);
  };

  const handleSave = async (formData) => {
    setSaving(true);
    if (userProfile) {
      formData.tenant_id = userProfile.tenant_id;
      formData.branch_id = userProfile.branch_id;
      if (!formData.assigned_by) formData.assigned_by = userProfile.user_id;
    }
    if (selectedTask) {
      await db.entities.Task.update(selectedTask.id, formData);
    } else {
      await db.entities.Task.create(formData);
    }
    await loadTasks();
    setSaving(false);
    setShowForm(false);
    setSelectedTask(null);
  };

  const handleStatusChange = async (task, newStatus) => {
    await db.entities.Task.update(task.id, { 
      status: newStatus,
      completed_at: newStatus === 'completed' ? new Date().toISOString() : null
    });
    await loadTasks();
  };

  const stats = {
    pending: tasks.filter(t => t.status === 'pending').length,
    in_progress: tasks.filter(t => t.status === 'in_progress').length,
    completed: tasks.filter(t => t.status === 'completed').length,
    urgent: tasks.filter(t => t.priority === 'urgent' && t.status !== 'completed').length,
  };

  const statusTabs = [
    { key: 'all', label: 'All', count: tasks.length },
    { key: 'pending', label: 'Pending', count: stats.pending },
    { key: 'in_progress', label: 'In Progress', count: stats.in_progress },
    { key: 'completed', label: 'Done', count: stats.completed },
  ];

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 pt-16 pb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">Tasks</h1>
            <p className="text-slate-400 text-sm mt-1">Department-wise Task Management</p>
          </div>
          <Button
            onClick={() => { setSelectedTask(null); setShowForm(true); }}
            className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl"
          >
            <Plus className="h-4 w-4 mr-1" />
            New
          </Button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-2 mb-6">
          {[
            { label: 'Pending', value: stats.pending, color: 'bg-slate-500/20 text-slate-300' },
            { label: 'Active', value: stats.in_progress, color: 'bg-blue-500/20 text-blue-300' },
            { label: 'Done', value: stats.completed, color: 'bg-emerald-500/20 text-emerald-300' },
            { label: 'Urgent', value: stats.urgent, color: 'bg-rose-500/20 text-rose-300' },
          ].map(stat => (
            <div key={stat.label} className={`${stat.color} rounded-xl p-2 text-center`}>
              <p className="text-xl font-bold">{stat.value}</p>
              <p className="text-xs opacity-80">{stat.label}</p>
            </div>
          ))}
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

      {/* Status Tabs */}
      <div className="px-6 py-4 flex gap-2 overflow-x-auto">
        {statusTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              statusFilter === tab.key
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-amber-300'
            }`}
          >
            {tab.label}
            <span className={`text-xs rounded-full px-1.5 py-0.5 ${
              statusFilter === tab.key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              {tab.count}
            </span>
          </button>
        ))}
      </div>

      {/* Task List */}
      <div className="px-6 space-y-3">
        {loading ? (
          [1,2,3].map(i => <div key={i} className="h-24 bg-slate-200 animate-pulse rounded-xl" />)
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <ClipboardList className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No tasks found</p>
            <Button onClick={() => setShowForm(true)} className="mt-4 bg-amber-500 hover:bg-amber-600">
              <Plus className="h-4 w-4 mr-2" />
              Create Task
            </Button>
          </div>
        ) : (
          filtered.map((task, i) => (
            <TaskCard
              key={task.id}
              task={task}
              index={i}
              onClick={(t) => {
                setSelectedTask(t);
                setShowForm(true);
              }}
            />
          ))
        )}
      </div>

      {/* Task Form Sheet */}
      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent side="bottom" className="h-[90vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-6">
            <SheetTitle>{selectedTask ? 'Edit Task' : 'New Task'}</SheetTitle>
          </SheetHeader>
          <TaskForm
            task={selectedTask}
            departments={departments}
            users={users}
            onSave={handleSave}
            onCancel={() => setShowForm(false)}
            loading={saving}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}