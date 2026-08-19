import React from 'react';
import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import NotificationBell from './NotificationBell';
import BranchSwitcher from './BranchSwitcher';

export default function TopBar({ onMenuOpen, userProfile, currentBranch, onBranchChange, unreadCount, title }) {
  return (
    <div className="fixed top-0 left-0 right-0 z-40 bg-slate-900/95 backdrop-blur-md border-b border-slate-700/50 safe-area-inset-top">
      <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto">
        {/* Hamburger */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onMenuOpen}
          className="text-slate-300 hover:text-white hover:bg-slate-700/50 h-9 w-9 flex-shrink-0"
        >
          <Menu className="h-5 w-5" />
        </Button>

        {/* Branch Switcher */}
        <div className="flex-1">
          <BranchSwitcher
            userProfile={userProfile}
            currentBranch={currentBranch}
            onBranchChange={onBranchChange}
          />
        </div>

        {/* Notification Bell */}
        <NotificationBell unreadCount={unreadCount} />
      </div>
    </div>
  );
}