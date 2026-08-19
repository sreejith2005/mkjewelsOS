const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Menu, X, Home, Users, ClipboardList, GitBranch, 
  FileText, Bell, BarChart3, Settings, Building2,
  LogOut, ChevronRight, Gem, User
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

const menuItems = [
  { name: 'Home', icon: Home, page: 'Home' },
  { name: 'CRM', icon: Users, page: 'CRM' },
  { name: 'My Tasks', icon: ClipboardList, page: 'MyTasks' },
  { name: 'Workflows', icon: GitBranch, page: 'Workflows' },
  { name: 'Forms', icon: FileText, page: 'Forms' },
  { name: 'Notifications', icon: Bell, page: 'Notifications' },
  { name: 'Dashboard', icon: BarChart3, page: 'Dashboard' },
  { name: 'Settings', icon: Settings, page: 'Settings' },
];

export default function HamburgerMenu({ user, userProfile, tenant, currentBranch }) {
  const [isOpen, setIsOpen] = useState(false);

  const handleLogout = () => {
    db.auth.logout();
  };

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="fixed top-4 left-4 z-50 bg-white/90 backdrop-blur-sm shadow-lg rounded-xl hover:bg-white"
        onClick={() => setIsOpen(true)}
      >
        <Menu className="h-5 w-5 text-slate-700" />
      </Button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
              onClick={() => setIsOpen(false)}
            />
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed left-0 top-0 bottom-0 w-80 bg-gradient-to-b from-slate-900 to-slate-800 z-50 shadow-2xl"
            >
              <div className="flex flex-col h-full">
                {/* Header */}
                <div className="p-6 border-b border-slate-700/50">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                        <Gem className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <h1 className="text-lg font-bold text-white">JewelOS</h1>
                        <p className="text-xs text-slate-400">{tenant?.name || 'Jewellery Retail'}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setIsOpen(false)}
                      className="text-slate-400 hover:text-white hover:bg-slate-700/50"
                    >
                      <X className="h-5 w-5" />
                    </Button>
                  </div>

                  {/* Current Branch */}
                  {currentBranch && (
                    <div className="bg-slate-800/50 rounded-xl p-3 flex items-center gap-3">
                      <Building2 className="h-4 w-4 text-amber-400" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{currentBranch.name}</p>
                        <p className="text-xs text-slate-400">{currentBranch.code}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-slate-500" />
                    </div>
                  )}
                </div>

                {/* Menu Items */}
                <nav className="flex-1 overflow-y-auto py-4 px-3">
                  {menuItems.map((item) => (
                    <Link
                      key={item.page}
                      to={createPageUrl(item.page)}
                      onClick={() => setIsOpen(false)}
                      className="flex items-center gap-3 px-4 py-3 rounded-xl text-slate-300 hover:text-white hover:bg-slate-700/50 transition-all group"
                    >
                      <item.icon className="h-5 w-5 text-slate-400 group-hover:text-amber-400 transition-colors" />
                      <span className="font-medium">{item.name}</span>
                    </Link>
                  ))}
                </nav>

                {/* User Profile */}
                <div className="p-4 border-t border-slate-700/50">
                  <div className="flex items-center gap-3 p-3 bg-slate-800/50 rounded-xl">
                    <Avatar className="h-10 w-10 border-2 border-amber-400/30">
                      <AvatarImage src={userProfile?.avatar_url} />
                      <AvatarFallback className="bg-slate-700 text-white">
                        {user?.full_name?.charAt(0) || <User className="h-4 w-4" />}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-white truncate">{user?.full_name || 'User'}</p>
                      <p className="text-xs text-slate-400 truncate">{userProfile?.designation || userProfile?.role_level}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={handleLogout}
                      className="text-slate-400 hover:text-red-400 hover:bg-red-400/10"
                    >
                      <LogOut className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}