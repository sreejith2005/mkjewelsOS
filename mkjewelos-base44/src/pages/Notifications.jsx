const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { motion } from 'framer-motion';
import {
  Bell, Plus, Settings, FileText, History, Search,
  RefreshCw, CheckCheck, Filter
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import NotificationItem from '@/components/notifications/NotificationItem';
import NotificationLogList from '@/components/notifications/NotificationLogList';
import RuleBuilder from '@/components/notifications/RuleBuilder';
import TemplateEditor from '@/components/notifications/TemplateEditor';
import { sendNotification, EVENT_META } from '@/components/notifications/notificationEngine';

export default function Notifications() {
  const [tab, setTab] = useState('inbox');
  const [notifications, setNotifications] = useState([]);
  const [rules, setRules] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [showRuleSheet, setShowRuleSheet] = useState(false);
  const [showTemplateSheet, setShowTemplateSheet] = useState(false);
  const [selectedRule, setSelectedRule] = useState(null);
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);

  useEffect(() => { init(); }, []);

  const init = async () => {
    try {
      const u = await db.auth.me();
      setUser(u);
      const profiles = await db.entities.UserProfile.filter({ user_id: u.id });
      if (profiles.length) setUserProfile(profiles[0]);
    } catch (_) {}
    await loadAll();
  };

  const loadAll = async () => {
    setLoading(true);
    const [notifs, r, t, l] = await Promise.all([
      db.entities.Notification.list('-created_date', 100),
      db.entities.NotificationRule.list('-created_date', 100),
      db.entities.NotificationTemplate.list('-created_date', 100),
      db.entities.NotificationLog.list('-created_date', 200),
    ]);
    setNotifications(notifs);
    setRules(r);
    setTemplates(t);
    setLogs(l);
    setLoading(false);
  };

  const markAllRead = async () => {
    const unread = notifications.filter(n => !n.is_read);
    await Promise.all(unread.map(n => db.entities.Notification.update(n.id, { is_read: true, read_at: new Date().toISOString() })));
    loadAll();
  };

  const saveRule = async (formData) => {
    setSaving(true);
    if (userProfile) formData.tenant_id = userProfile.tenant_id;
    if (selectedRule) {
      await db.entities.NotificationRule.update(selectedRule.id, formData);
    } else {
      await db.entities.NotificationRule.create(formData);
    }
    setSaving(false);
    setShowRuleSheet(false);
    setSelectedRule(null);
    await loadAll();
  };

  const saveTemplate = async (formData) => {
    setSaving(true);
    if (userProfile) formData.tenant_id = userProfile.tenant_id;
    if (selectedTemplate) {
      await db.entities.NotificationTemplate.update(selectedTemplate.id, formData);
    } else {
      await db.entities.NotificationTemplate.create(formData);
    }
    setSaving(false);
    setShowTemplateSheet(false);
    setSelectedTemplate(null);
    await loadAll();
  };

  const retryLog = async (log) => {
    const matchRules = log.rule_id ? rules.filter(r => r.id === log.rule_id) : [];
    await db.entities.NotificationLog.update(log.id, { status: 'queued', retry_count: 0, next_retry_at: null });
    const updatedLog = { ...log, status: 'queued', retry_count: 0 };
    await sendNotification(updatedLog, matchRules[0] || null);
    await loadAll();
  };

  const toggleRule = async (rule) => {
    await db.entities.NotificationRule.update(rule.id, { is_active: !rule.is_active });
    await loadAll();
  };

  const isManager = ['super_admin', 'tenant_admin', 'branch_manager', 'department_head'].includes(userProfile?.role_level);

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const filteredNotifs = notifications.filter(n =>
    !search || n.title?.toLowerCase().includes(search.toLowerCase()) || n.message?.toLowerCase().includes(search.toLowerCase())
  );
  const filteredLogs = logs.filter(n =>
    !search || n.subject?.toLowerCase().includes(search.toLowerCase()) || n.event_type?.toLowerCase().includes(search.toLowerCase())
  );

  const tabs = [
    { key: 'inbox', label: 'Inbox', icon: Bell, count: unreadCount },
    { key: 'rules', label: 'Rules', icon: Settings, count: rules.length },
    { key: 'templates', label: 'Templates', icon: FileText, count: templates.length },
    { key: 'logs', label: 'Logs', icon: History, count: logs.filter(l => l.status === 'failed').length },
  ];

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 pt-16 pb-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2">
              <Bell className="h-6 w-6 text-amber-400" />
              Notifications
            </h1>
            <p className="text-slate-400 text-sm mt-0.5">Event → Rule → Template → Provider → Log</p>
          </div>
          <div className="flex gap-2">
            {tab === 'inbox' && unreadCount > 0 && (
              <Button onClick={markAllRead} size="sm" variant="outline" className="text-white border-white/30 h-8 text-xs">
                <CheckCheck className="h-3 w-3 mr-1" /> Mark All Read
              </Button>
            )}
            {tab === 'rules' && isManager && (
              <Button onClick={() => { setSelectedRule(null); setShowRuleSheet(true); }} size="sm" className="bg-amber-500 hover:bg-amber-600 h-8 text-xs">
                <Plus className="h-3 w-3 mr-1" /> Rule
              </Button>
            )}
            {tab === 'templates' && isManager && (
              <Button onClick={() => { setSelectedTemplate(null); setShowTemplateSheet(true); }} size="sm" className="bg-amber-500 hover:bg-amber-600 h-8 text-xs">
                <Plus className="h-3 w-3 mr-1" /> Template
              </Button>
            )}
            <Button onClick={loadAll} size="icon" variant="ghost" className="text-white h-8 w-8">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-5">
          {[
            { label: 'Unread', value: unreadCount, color: 'bg-blue-500/20 text-blue-300' },
            { label: 'Rules', value: rules.filter(r => r.is_active).length, color: 'bg-emerald-500/20 text-emerald-300' },
            { label: 'Templates', value: templates.length, color: 'bg-violet-500/20 text-violet-300' },
            { label: 'Failed', value: logs.filter(l => l.status === 'failed').length, color: 'bg-rose-500/20 text-rose-300' },
          ].map(s => (
            <div key={s.label} className={`${s.color} rounded-xl p-2 text-center`}>
              <p className="text-xl font-bold">{s.value}</p>
              <p className="text-[10px] opacity-80">{s.label}</p>
            </div>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-slate-400 rounded-xl"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="px-6 pt-4">
        <div className="flex gap-2 mb-5 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all relative ${
                tab === t.key ? 'bg-amber-500 text-white shadow-sm' : 'bg-white text-slate-600 border border-slate-200'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
              {t.count > 0 && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  tab === t.key ? 'bg-white/30 text-white' : 'bg-slate-100 text-slate-600'
                }`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-slate-200 animate-pulse rounded-2xl" />)}</div>
        ) : tab === 'inbox' ? (
          <div className="space-y-2">
            {filteredNotifs.length === 0 ? (
              <div className="text-center py-16">
                <Bell className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500">No notifications</p>
              </div>
            ) : filteredNotifs.map((n, i) => (
              <NotificationItem key={n.id} notification={n} onRead={loadAll} index={i} />
            ))}
          </div>

        ) : tab === 'rules' ? (
          <div className="space-y-3">
            {rules.length === 0 ? (
              <div className="text-center py-16">
                <Settings className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 mb-4">No rules configured</p>
                {isManager && (
                  <Button onClick={() => setShowRuleSheet(true)} className="bg-amber-500 hover:bg-amber-600">
                    <Plus className="h-4 w-4 mr-2" /> Create First Rule
                  </Button>
                )}
              </div>
            ) : rules.map((rule, i) => {
              const meta = EVENT_META[rule.event_type];
              return (
                <motion.div
                  key={rule.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="bg-white rounded-2xl border border-slate-100 p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="text-2xl flex-shrink-0">{meta?.icon || '⚡'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-800 truncate">{rule.name}</h3>
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${rule.is_active ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{meta?.label || rule.event_type}</p>
                      <div className="flex gap-1 mt-2 flex-wrap">
                        {(rule.channels || []).map(ch => (
                          <Badge key={ch} variant="outline" className="text-[10px] capitalize">{ch}</Badge>
                        ))}
                        {rule.conditions?.length > 0 && (
                          <Badge variant="outline" className="text-[10px]">{rule.conditions.length} conditions</Badge>
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          {rule.fire_count || 0} fired
                        </Badge>
                      </div>
                    </div>
                    {isManager && (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => toggleRule(rule)}
                          className={`h-7 text-xs ${rule.is_active ? 'text-emerald-600' : 'text-slate-400'}`}>
                          {rule.is_active ? 'Active' : 'Off'}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-amber-500"
                          onClick={() => { setSelectedRule(rule); setShowRuleSheet(true); }}>
                          ✏️
                        </Button>
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

        ) : tab === 'templates' ? (
          <div className="space-y-3">
            {templates.length === 0 ? (
              <div className="text-center py-16">
                <FileText className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-slate-500 mb-4">No templates yet</p>
                {isManager && (
                  <Button onClick={() => setShowTemplateSheet(true)} className="bg-amber-500 hover:bg-amber-600">
                    <Plus className="h-4 w-4 mr-2" /> Create Template
                  </Button>
                )}
              </div>
            ) : templates.map((tmpl, i) => {
              const meta = EVENT_META[tmpl.event_type];
              const channelEmoji = { in_app: '🔔', email: '📧', sms: '📱', whatsapp: '💬' };
              return (
                <motion.div
                  key={tmpl.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="bg-white rounded-2xl border border-slate-100 p-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="text-2xl">{channelEmoji[tmpl.channel] || '📨'}</div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-800 truncate">{tmpl.name}</h3>
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${tmpl.is_active ? 'bg-emerald-400' : 'bg-slate-300'}`} />
                      </div>
                      {tmpl.subject && <p className="text-xs text-slate-600 mt-0.5 font-medium">{tmpl.subject}</p>}
                      <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{tmpl.body}</p>
                      <div className="flex gap-1 mt-2">
                        <Badge variant="outline" className="text-[10px] capitalize">{tmpl.channel}</Badge>
                        {meta && <Badge variant="outline" className="text-[10px]">{meta.icon} {meta.label}</Badge>}
                      </div>
                    </div>
                    {isManager && (
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-slate-400 hover:text-amber-500"
                        onClick={() => { setSelectedTemplate(tmpl); setShowTemplateSheet(true); }}>
                        ✏️
                      </Button>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>

        ) : (
          <NotificationLogList logs={filteredLogs} onRetry={retryLog} loading={loading} />
        )}
      </div>

      {/* Rule Builder Sheet */}
      <Sheet open={showRuleSheet} onOpenChange={setShowRuleSheet}>
        <SheetContent side="bottom" className="h-[92vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-5">
            <SheetTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-amber-500" />
              {selectedRule ? 'Edit Rule' : 'New Notification Rule'}
            </SheetTitle>
          </SheetHeader>
          <RuleBuilder
            rule={selectedRule}
            onSave={saveRule}
            onCancel={() => setShowRuleSheet(false)}
            loading={saving}
          />
        </SheetContent>
      </Sheet>

      {/* Template Editor Sheet */}
      <Sheet open={showTemplateSheet} onOpenChange={setShowTemplateSheet}>
        <SheetContent side="bottom" className="h-[90vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-5">
            <SheetTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-amber-500" />
              {selectedTemplate ? 'Edit Template' : 'New Notification Template'}
            </SheetTitle>
          </SheetHeader>
          <TemplateEditor
            template={selectedTemplate}
            onSave={saveTemplate}
            onCancel={() => setShowTemplateSheet(false)}
            loading={saving}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}