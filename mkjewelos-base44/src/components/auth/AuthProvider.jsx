const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [currentBranch, setCurrentBranch] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadUserContext();
  }, []);

  const loadUserContext = async () => {
    try {
      const currentUser = await db.auth.me();
      setUser(currentUser);

      // Load user profile with tenant/branch info
      const profiles = await db.entities.UserProfile.filter({ user_id: currentUser.id });
      if (profiles.length > 0) {
        const profile = profiles[0];
        setUserProfile(profile);

        // Load tenant
        if (profile.tenant_id) {
          const tenants = await db.entities.Tenant.filter({ id: profile.tenant_id });
          if (tenants.length > 0) setTenant(tenants[0]);
        }

        // Load current branch
        if (profile.branch_id) {
          const branches = await db.entities.Branch.filter({ id: profile.branch_id });
          if (branches.length > 0) setCurrentBranch(branches[0]);
        }
      }
    } catch (error) {
      console.log('Not authenticated');
    } finally {
      setLoading(false);
    }
  };

  const switchBranch = async (branchId) => {
    const branches = await db.entities.Branch.filter({ id: branchId });
    if (branches.length > 0) {
      setCurrentBranch(branches[0]);
    }
  };

  const hasPermission = (permission) => {
    if (!userProfile) return false;
    if (userProfile.role_level === 'super_admin' || userProfile.role_level === 'tenant_admin') return true;
    return userProfile.permissions?.includes(permission);
  };

  const canAccessBranch = (branchId) => {
    if (!userProfile) return false;
    if (userProfile.role_level === 'super_admin' || userProfile.role_level === 'tenant_admin') return true;
    if (userProfile.branch_id === branchId) return true;
    return userProfile.accessible_branches?.includes(branchId);
  };

  const value = {
    user,
    userProfile,
    tenant,
    currentBranch,
    loading,
    switchBranch,
    hasPermission,
    canAccessBranch,
    refresh: loadUserContext
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

export default AuthProvider;