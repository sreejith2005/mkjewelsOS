const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { motion } from 'framer-motion';
import { 
  Users, ClipboardList, GitBranch, Bell, 
  BarChart3, TrendingUp, Gem, ChevronRight,
  Star, Repeat, UserCheck, AlertTriangle, MessageSquare
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import QuickActions from '@/components/home/QuickActions';
import TaskSwipePanel from '@/components/tasks/TaskSwipePanel';
import TaskInstanceCard from '@/components/tasks/TaskInstanceCard';
import DelegateTaskSheet from '@/components/tasks/DelegateTaskSheet';
import { 
  generateTodayInstances, filterTasksByRole, 
  delegateTask, updateChecklistItem, completeTaskInstance, calcChecklistPct 
} from '@/components/tasks/recurringTaskEngine';
import { makeOwnerProfile } from '@/components/auth/ownerUtils';
import { format } from 'date-fns';

export default function Home() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [todayTasks, setTodayTasks] = useState([]);
  const [delegatedTasks, setDelegatedTasks] = useState([]);
  const [workflowTasks, setWorkflowTasks] = useState([]);
  const [crmFollowUps, setCrmFollowUps] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [allProfiles, setAllProfiles] = useState([]);
  const [taskToDelegate, setTaskToDelegate] = useState(null);
  const [delegating, setDelegating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ customers: 0, tasks: 0, workflows: 0, notifications: 0 });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const currentUser = await db.auth.me();
      setUser(currentUser);

      const [profiles, users, allProfs] = await Promise.all([
        db.entities.UserProfile.filter({ user_id: currentUser.id }),
        db.entities.User.list(),
        db.entities.UserProfile.list(),
      ]);

      // Owner: use synthetic profile so task engine works
      const profile = profiles[0] || (currentUser.role === 'admin' ? makeOwnerProfile(currentUser) : null);
      setUserProfile(profile);
      setAllUsers(users);
      setAllProfiles(allProfs);

      if (profile && profile.tenant_id) {
        await generateTodayInstances(profile);
      }

      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const [instances, wfInstances, customers, notifications] = await Promise.all([
        db.entities.TaskInstance.filter({ due_date_only: todayStr }),
        db.entities.WorkflowInstance.filter({ status: 'active' }),
        db.entities.Customer.list('-created_date', 50),
        db.entities.Notification.filter({ is_read: false }),
      ]);

      const visibleTasks = filterTasksByRole(instances, profile);

      setTodayTasks(visibleTasks.filter(t => !t.is_delegated));
      setDelegatedTasks(visibleTasks.filter(t => t.is_delegated));
      setWorkflowTasks(wfInstances.slice(0, 5));

      // CRM follow-ups: customers with upcoming anniversary or interactions
      const followUps = customers
        .filter(c => c.anniversary_date || c.notes)
        .slice(0, 5)
        .map(c => ({
          id: c.id,
          title: `${c.first_name} ${c.last_name}`,
          meta: c.phone,
          status: 'pending',
          priority: c.customer_type === 'vip' ? 'high' : 'medium',
        }));
      setCrmFollowUps(followUps);
      setAlerts(notifications.slice(0, 5).map(n => ({
        id: n.id,
        title: n.title,
        meta: n.message,
        status: n.priority === 'urgent' ? 'urgent' : 'pending',
        priority: n.priority,
      })));

      const allCustomers = await db.entities.Customer.list('-created_date', 200);
      setStats({
        customers: allCustomers.length,
        tasks: visibleTasks.filter(t => t.status !== 'completed').length,
        workflows: wfInstances.length,
        notifications: notifications.length,
      });
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  };

  const todayPct = todayTasks.length > 0
    ? Math.round((todayTasks.filter(t => t.status === 'completed').length / todayTasks.length) * 100)
    : 0;

  const handleChecklistToggle = async (task, itemId, checked) => {
    const { updatedChecklist } = await updateChecklistItem(task, itemId, checked, user?.id);
    const refreshed = { ...task, checklist: updatedChecklist };
    setTodayTasks(prev => prev.map(t => t.id === task.id ? refreshed : t));
    setDelegatedTasks(prev => prev.map(t => t.id === task.id ? refreshed : t));
  };

  const handleComplete = async (task) => {
    await completeTaskInstance(task, user?.id, '');
    const update = (list) => list.map(t => t.id === task.id ? { ...t, status: 'completed' } : t);
    setTodayTasks(update);
    setDelegatedTasks(update);
  };

  const handleDelegate = async (task, toUserId, reason) => {
    setDelegating(true);
    await delegateTask(task, toUserId, reason, user?.id, userProfile);
    setDelegating(false);
    setTaskToDelegate(null);
    await loadData();
  };

  const swipePanels = [
    {
      id: 'daily',
      title: 'My Daily Tasks',
      subtitle: `${todayTasks.filter(t => t.status === 'completed').length}/${todayTasks.length} done`,
      icon: ClipboardList,
      bgClass: 'bg-gradient-to-br from-blue-600 to-blue-700',
      headerClass: '',
      count: todayTasks.filter(t => t.status !== 'completed').length,
      completion: todayPct,
      emptyText: 'No tasks today!',
      items: todayTasks.map(t => ({
        ...t,
        meta: t.recurrence_type ? `${t.recurrence_type} · ${t.category || ''}` : t.category,
      })),
      onItemClick: (t) => setTaskToDelegate(null),
      onViewAll: () => {},
    },
    {
      id: 'delegated',
      title: 'Delegated Tasks',
      subtitle: 'Tasks assigned by others',
      icon: UserCheck,
      bgClass: 'bg-gradient-to-br from-violet-600 to-violet-700',
      headerClass: '',
      count: delegatedTasks.length,
      completion: delegatedTasks.length > 0
        ? Math.round((delegatedTasks.filter(t => t.status === 'completed').length / delegatedTasks.length) * 100)
        : 0,
      emptyText: 'No delegated tasks',
      items: delegatedTasks.map(t => ({
        ...t,
        meta: `from: ${allUsers.find(u => u.id === t.delegated_from)?.full_name || 'someone'}`,
      })),
      onItemClick: () => {},
      onViewAll: () => {},
    },
    {
      id: 'fms',
      title: 'FMS Tasks',
      subtitle: 'Active workflow instances',
      icon: GitBranch,
      bgClass: 'bg-gradient-to-br from-emerald-600 to-emerald-700',
      headerClass: '',
      count: workflowTasks.length,
      emptyText: 'No active workflows',
      items: workflowTasks.map(w => ({
        id: w.id,
        title: w.current_stage_name || 'In Progress',
        meta: `Ref: ${w.reference_number || w.id.slice(0, 8)}`,
        status: w.status,
        priority: w.priority,
        checklist_completion_pct: undefined,
      })),
      onItemClick: () => {},
      onViewAll: () => {},
    },
    {
      id: 'crm',
      title: 'CRM Follow-ups',
      subtitle: 'Customer interactions needed',
      icon: MessageSquare,
      bgClass: 'bg-gradient-to-br from-amber-600 to-amber-700',
      headerClass: '',
      count: crmFollowUps.length,
      emptyText: 'No follow-ups pending',
      items: crmFollowUps,
      onItemClick: () => {},
      onViewAll: () => {},
    },
    {
      id: 'alerts',
      title: 'Alerts',
      subtitle: `${alerts.length} unread notifications`,
      icon: Bell,
      bgClass: 'bg-gradient-to-br from-rose-600 to-rose-700',
      headerClass: '',
      count: alerts.length,
      emptyText: 'No alerts',
      items: alerts,
      onItemClick: () => {},
      onViewAll: () => {},
    },
  ];

  const greeting = () => {
    const h = new Date().getHours();
    if (h < 12) return 'Good Morning';
    if (h < 17) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-100">
      {/* Hero Header */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 pt-16 pb-10">
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="text-slate-400 text-sm">{greeting()},</p>
              <h1 className="text-white text-2xl font-bold mt-0.5">{user?.full_name?.split(' ')[0] || 'User'} 👋</h1>
              <div className="flex items-center gap-2 mt-2">
                <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
                  <Star className="h-3 w-3 mr-1 fill-amber-400" />
                  {userProfile?.role_level?.replace(/_/g, ' ') || 'Staff'}
                </Badge>
              </div>
            </div>
            <div className="relative">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
                <Gem className="h-7 w-7 text-white" />
              </div>
              {stats.notifications > 0 && (
                <div className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 rounded-full flex items-center justify-center">
                  <span className="text-white text-xs font-bold">{stats.notifications}</span>
                </div>
              )}
            </div>
          </div>

          {/* Today's completion ring */}
          <div className="bg-white/10 rounded-2xl p-4 mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-white font-medium text-sm">Today's Completion</span>
              <span className="text-white text-lg font-bold">{todayPct}%</span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <motion.div
                className={`h-full rounded-full transition-all ${
                  todayPct === 100 ? 'bg-emerald-400' : todayPct >= 60 ? 'bg-amber-400' : 'bg-blue-400'
                }`}
                initial={{ width: 0 }}
                animate={{ width: `${todayPct}%` }}
                transition={{ duration: 0.8, delay: 0.2 }}
              />
            </div>
            <div className="grid grid-cols-4 gap-3 mt-4">
              {[
                { label: 'Tasks', value: stats.tasks, color: 'text-blue-300' },
                { label: 'Done', value: todayTasks.filter(t => t.status === 'completed').length, color: 'text-emerald-300' },
                { label: 'Delegated', value: delegatedTasks.length, color: 'text-violet-300' },
                { label: 'Alerts', value: stats.notifications, color: 'text-rose-300' },
              ].map(s => (
                <div key={s.label} className="text-center">
                  <p className={`text-xl font-bold ${s.color}`}>{s.value}</p>
                  <p className="text-white/50 text-xs">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Swipe Panels Label */}
        <p className="text-slate-400 text-xs font-medium mb-3 uppercase tracking-wider">
          ← Swipe to explore panels →
        </p>

        {/* THE SWIPE PANELS */}
        {loading ? (
          <div className="flex gap-4 overflow-hidden">
            {[1,2,3].map(i => (
              <div key={i} className="flex-shrink-0 w-72 h-56 bg-white/10 animate-pulse rounded-2xl" />
            ))}
          </div>
        ) : (
          <TaskSwipePanel panels={swipePanels} />
        )}
      </div>

      {/* Main Content */}
      <div className="bg-slate-50 rounded-t-3xl -mt-4 px-6 pt-8 pb-24 min-h-screen">
        {/* Quick Actions */}
        <section className="mb-8">
          <h2 className="text-slate-800 font-bold text-lg mb-4">Quick Actions</h2>
          <QuickActions />
        </section>

        {/* Today's Priority Tasks */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-slate-800 font-bold text-lg">Priority Tasks Today</h2>
            <Link to={createPageUrl('MyTasks')}>
              <Button variant="ghost" size="sm" className="text-amber-600 hover:text-amber-700">
                View All <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </div>
          {loading ? (
            <div className="space-y-3">
              {[1,2].map(i => <div key={i} className="h-20 bg-slate-200 animate-pulse rounded-2xl" />)}
            </div>
          ) : todayTasks.filter(t => ['urgent', 'high'].includes(t.priority) && t.status !== 'completed').length === 0 ? (
            <div className="text-center py-8 bg-white rounded-2xl border border-slate-100">
              <span className="text-3xl">🎉</span>
              <p className="text-slate-500 mt-2 font-medium">No urgent tasks!</p>
            </div>
          ) : (
            <div className="space-y-3">
              {todayTasks
                .filter(t => ['urgent', 'high'].includes(t.priority) && t.status !== 'completed')
                .slice(0, 3)
                .map((task, i) => (
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
          )}
        </section>

        {/* Module Cards */}
        <section>
          <h2 className="text-slate-800 font-bold text-lg mb-4">Modules</h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { name: 'CRM', desc: 'Customer Relationships', icon: Users, color: 'from-blue-500 to-blue-600', page: 'CRM' },
              { name: 'My Tasks', desc: 'Recurring Task Manager', icon: Repeat, color: 'from-amber-500 to-amber-600', page: 'MyTasks' },
              { name: 'FMS Builder', desc: 'Flow Management System', icon: GitBranch, color: 'from-violet-500 to-violet-600', page: 'FMSBuilder' },
              { name: 'Forms', desc: 'Form Builder', icon: BarChart3, color: 'from-emerald-500 to-emerald-600', page: 'Forms' },
              { name: 'Alerts', desc: 'Notifications', icon: Bell, color: 'from-rose-500 to-rose-600', page: 'Notifications' },
              { name: 'Reports', desc: 'Performance Dashboard', icon: TrendingUp, color: 'from-slate-600 to-slate-700', page: 'Dashboard' },
            ].map((module, i) => (
              <motion.div
                key={module.page}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.05 }}
              >
                <Link to={createPageUrl(module.page)}>
                  <div className="bg-white rounded-2xl p-4 border border-slate-100 hover:shadow-lg hover:border-amber-200 transition-all group">
                    <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${module.color} flex items-center justify-center mb-3 group-hover:scale-110 transition-transform`}>
                      <module.icon className="h-6 w-6 text-white" />
                    </div>
                    <h3 className="font-semibold text-slate-800">{module.name}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{module.desc}</p>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </section>
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
    </div>
  );
}