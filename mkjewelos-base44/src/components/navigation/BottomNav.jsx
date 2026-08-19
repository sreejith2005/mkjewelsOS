import React from 'react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';
import { getBottomNavForRole } from './roleMenuConfig';

export default function BottomNav({ userProfile, currentPageName, unreadCount }) {
  const navItems = getBottomNavForRole(userProfile);

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur-xl border-t border-slate-200 z-40">
      <div className="flex items-center justify-around px-2 py-2 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = currentPageName === item.page;
          const showBadge = item.id === 'Notifications' && unreadCount > 0;
          return (
            <Link
              key={item.id}
              to={createPageUrl(item.page)}
              className="flex flex-col items-center gap-1 px-3 py-1 rounded-xl transition-all relative"
            >
              <div className={`p-1.5 rounded-xl transition-all ${
                isActive ? 'bg-amber-500 shadow-lg shadow-amber-500/30' : 'bg-transparent'
              }`}>
                <item.icon className={`h-5 w-5 transition-colors ${isActive ? 'text-white' : 'text-slate-400'}`} />
              </div>
              <span className={`text-xs font-medium transition-colors ${isActive ? 'text-amber-500' : 'text-slate-400'}`}>
                {item.name}
              </span>
              {showBadge && (
                <div className="absolute top-0 right-1 min-w-[16px] h-4 bg-rose-500 rounded-full flex items-center justify-center px-1">
                  <span className="text-white text-[9px] font-bold">{unreadCount > 9 ? '9+' : unreadCount}</span>
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}