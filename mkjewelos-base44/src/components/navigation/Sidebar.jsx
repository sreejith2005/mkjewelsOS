const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Gem, LogOut, User, ChevronRight } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

import { getMenuForRole, ROLE_LABELS } from './roleMenuConfig';
import BranchSwitcher from './BranchSwitcher';

const GROUP_LABELS = {
  main: 'Overview',
  crm: 'CRM',
  tasks: 'Tasks',
  forms: 'Forms',
  system: 'System',
};

export default function Sidebar({ isOpen, onClose, user, userProfile, tenant, currentBranch, onBranchChange, unreadCount }) {
  const location = useLocation();
  const menuItems = getMenuForRole(userProfile);
  const roleInfo = ROLE_LABELS[userProfile?.role_level] || ROLE_LABELS.staff;

  // Group items
  const grouped = {};
  menuItems.forEach(item => {
    if (!grouped[item.group]) grouped[item.group] = [];
    grouped[item.group].push(item);
  });

  const isActive = (page) => location.pathname.includes(page.toLowerCase());

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onClose}
          />

          {/* Sidebar Panel */}
          <motion.aside
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 220 }}
            className="fixed left-0 top-0 bottom-0 w-72 bg-gradient-to-b from-slate-900 via-slate-900 to-slate-800 z-50 shadow-2xl flex flex-col"
          >
            {/* Header */}
            <div className="px-5 pt-6 pb-4 border-b border-slate-700/50 space-y-4">
              {/* Brand + Close */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
                    <Gem className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <h1 className="text-base font-bold text-white leading-tight">JewelOS</h1>
                    <p className="text-[10px] text-slate-400 truncate max-w-[130px]">{tenant?.name || 'Jewellery Retail'}</p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="text-slate-400 hover:text-white hover:bg-slate-700/50 h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Branch Switcher */}
              <BranchSwitcher
                userProfile={userProfile}
                currentBranch={currentBranch}
                onBranchChange={onBranchChange}
              />
            </div>

            {/* Navigation */}
            <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-5 scrollbar-hide">
              {Object.entries(grouped).map(([group, items]) => (
                <div key={group}>
                  <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider px-3 mb-1">
                    {GROUP_LABELS[group] || group}
                  </p>
                  <div className="space-y-0.5">
                    {items.map(item => {
                      const active = isActive(item.page);
                      const showBadge = item.id === 'Notifications' && unreadCount > 0;
                      return (
                        <Link
                          key={item.id}
                          to={createPageUrl(item.page)}
                          onClick={onClose}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group relative ${
                            active
                              ? 'bg-amber-500/15 text-amber-400'
                              : 'text-slate-400 hover:text-white hover:bg-slate-700/40'
                          }`}
                        >
                          <div className={`p-1 rounded-lg transition-all ${active ? 'bg-amber-500/20' : 'group-hover:bg-slate-600/50'}`}>
                            <item.icon className={`h-4 w-4 ${active ? 'text-amber-400' : 'text-slate-400 group-hover:text-slate-200'}`} />
                          </div>
                          <span className={`text-sm font-medium flex-1 ${active ? 'text-amber-300' : ''}`}>{item.name}</span>
                          {active && <ChevronRight className="h-3 w-3 text-amber-500" />}
                          {showBadge && (
                            <span className="min-w-[18px] h-[18px] bg-rose-500 rounded-full text-white text-[9px] font-bold flex items-center justify-center px-1">
                              {unreadCount > 9 ? '9+' : unreadCount}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </nav>

            {/* User Footer */}
            <div className="p-4 border-t border-slate-700/50">
              <div className="flex items-center gap-3 p-3 bg-slate-800/60 rounded-xl">
                <Avatar className="h-9 w-9 border-2 border-amber-400/30 flex-shrink-0">
                  <AvatarImage src={userProfile?.avatar_url} />
                  <AvatarFallback className="bg-slate-700 text-white text-sm">
                    {user?.full_name?.charAt(0) || <User className="h-4 w-4" />}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{user?.full_name || 'User'}</p>
                  <div className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium mt-0.5 ${roleInfo.color}`}>
                    {roleInfo.label}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => db.auth.logout()}
                  className="text-slate-400 hover:text-rose-400 hover:bg-rose-400/10 h-8 w-8 flex-shrink-0"
                  title="Logout"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}