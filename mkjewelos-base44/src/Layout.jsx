const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import Sidebar from '@/components/navigation/Sidebar';
import TopBar from '@/components/navigation/TopBar';
import BottomNav from '@/components/navigation/BottomNav';
import { canAccessPage } from '@/components/navigation/roleMenuConfig';
import { makeOwnerProfile } from '@/components/auth/ownerUtils';
import { ShieldOff } from 'lucide-react';

export default function Layout({ children, currentPageName }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [currentBranch, setCurrentBranch] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [authLoaded, setAuthLoaded] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const currentUser = await db.auth.me();
      setUser(currentUser);

      const [profiles, notifications] = await Promise.all([
        db.entities.UserProfile.filter({ user_id: currentUser.id }),
        db.entities.Notification.filter({ is_read: false }),
      ]);

      setUnreadCount(notifications.length);

      // Platform admin (owner) → synthetic super_admin profile so layout works
      if (currentUser.role === 'admin' && profiles.length === 0) {
        setUserProfile(makeOwnerProfile(currentUser));
        setAuthLoaded(true);
        return;
      }

      if (profiles.length > 0) {
        const profile = profiles[0];
        setUserProfile(profile);

        const [tenants, branches] = await Promise.all([
          profile.tenant_id ? db.entities.Tenant.filter({ id: profile.tenant_id }) : Promise.resolve([]),
          profile.branch_id ? db.entities.Branch.filter({ id: profile.branch_id }) : Promise.resolve([]),
        ]);

        if (tenants.length) setTenant(tenants[0]);
        if (branches.length) setCurrentBranch(branches[0]);
      }
    } catch (_) {}
    setAuthLoaded(true);
  };

  const handleBranchChange = (branch) => {
    setCurrentBranch(branch);
    // Reload page data after branch switch
    window.location.reload();
  };

  // Pages that skip the layout shell (full-screen pages)
  const BARE_PAGES = ['Login', 'Register'];
  if (BARE_PAGES.includes(currentPageName)) {
    return <>{children}</>;
  }

  // Route Protection: platform admins (owners) always have full access
  const isOwner = userProfile?.permissions?.includes('*');
  const isPublicPage = ['Home'].includes(currentPageName);
  const hasAccess = !authLoaded || isPublicPage || isOwner || !userProfile || canAccessPage(currentPageName, userProfile);

  return (
    <div className="relative min-h-screen bg-slate-50">
      <style>{`
        :root {
          --jewel-gold: #d4af37;
          --jewel-dark: #1e293b;
        }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>

      {/* Top Bar */}
      <TopBar
        onMenuOpen={() => setSidebarOpen(true)}
        userProfile={userProfile}
        currentBranch={currentBranch}
        onBranchChange={handleBranchChange}
        unreadCount={unreadCount}
      />

      {/* Collapsible Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        user={user}
        userProfile={userProfile}
        tenant={tenant}
        currentBranch={currentBranch}
        onBranchChange={handleBranchChange}
        unreadCount={unreadCount}
      />

      {/* Main Content */}
      <main className="pt-16 pb-20 min-h-screen">
        {hasAccess ? (
          children
        ) : (
          <div className="flex flex-col items-center justify-center min-h-[70vh] px-8 text-center">
            <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center mb-4">
              <ShieldOff className="h-8 w-8 text-rose-500" />
            </div>
            <h2 className="text-xl font-bold text-slate-800 mb-2">Access Restricted</h2>
            <p className="text-slate-500 text-sm">
              Your role doesn't have permission to view this page.
            </p>
            <p className="text-slate-400 text-xs mt-1 capitalize">
              Role: {userProfile?.role_level?.replace('_', ' ')}
            </p>
          </div>
        )}
      </main>

      {/* Bottom Navigation */}
      <BottomNav
        userProfile={userProfile}
        currentPageName={currentPageName}
        unreadCount={unreadCount}
      />
    </div>
  );
}