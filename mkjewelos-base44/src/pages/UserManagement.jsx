const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { Search, Filter, UserCog, ChevronDown, Shield, Plus } from 'lucide-react';
import UserCard from '@/components/usermanagement/UserCard';
import EditProfileModal from '@/components/usermanagement/EditProfileModal';

const ROLE_FILTER_OPTIONS = [
  { value: 'all', label: 'All Roles' },
  { value: 'admin', label: 'Platform Admin' },
  { value: 'user', label: 'Platform User' },
];

export default function UserManagement() {
  const [currentUser, setCurrentUser] = useState(null);
  const [users, setUsers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [jewelRoleFilter, setJewelRoleFilter] = useState('all');
  const [editingUser, setEditingUser] = useState(null);
  const [editingProfile, setEditingProfile] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    const me = await db.auth.me();
    setCurrentUser(me);
    const [allUsers, allProfiles, allTenants, allBranches] = await Promise.all([
      db.entities.User.list(),
      db.entities.UserProfile.list(),
      db.entities.Tenant.list(),
      db.entities.Branch.list(),
    ]);
    setUsers(allUsers);
    setProfiles(allProfiles);
    setTenants(allTenants);
    setBranches(allBranches);
    setLoading(false);
  };

  // Guard: only admins
  if (!loading && currentUser?.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-8 text-center">
        <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center mb-4">
          <Shield className="h-8 w-8 text-rose-500" />
        </div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">Access Restricted</h2>
        <p className="text-slate-500 text-sm">Only platform administrators can access User Management.</p>
      </div>
    );
  }

  const getProfile = (userId) => profiles.find(p => p.user_id === userId);

  const filtered = users.filter(u => {
    const matchSearch =
      !search ||
      u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
      u.email?.toLowerCase().includes(search.toLowerCase());
    const matchRole = roleFilter === 'all' || u.role === roleFilter;
    const profile = getProfile(u.id);
    const matchJewelRole = jewelRoleFilter === 'all' || profile?.role_level === jewelRoleFilter;
    return matchSearch && matchRole && matchJewelRole;
  });

  const openEdit = (user) => {
    setEditingUser(user);
    const existing = getProfile(user.id);
    setEditingProfile(existing
      ? { ...existing }
      : { user_id: user.id, tenant_id: '', branch_id: '', department_id: '', designation: '', role_level: 'staff', is_active: true }
    );
  };

  const handleSave = async (formData) => {
    setSaving(true);
    const existing = getProfile(editingUser.id);
    if (existing?.id) {
      await db.entities.UserProfile.update(existing.id, formData);
    } else {
      await db.entities.UserProfile.create({ ...formData, user_id: editingUser.id });
    }
    await loadAll();
    setSaving(false);
    setEditingUser(null);
    setEditingProfile(null);
  };

  const JEWEL_ROLE_OPTIONS = [
    { value: 'all', label: 'All JewelOS Roles' },
    { value: 'super_admin', label: 'Super Admin' },
    { value: 'tenant_admin', label: 'Tenant Admin' },
    { value: 'branch_manager', label: 'Branch Manager' },
    { value: 'department_head', label: 'Department Head' },
    { value: 'team_lead', label: 'Team Lead' },
    { value: 'staff', label: 'Staff' },
  ];

  return (
    <div className="px-4 py-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #d4af37 0%, #b8860b 100%)' }}>
          <UserCog className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">User Management</h1>
          <p className="text-xs text-slate-500">{users.length} platform users</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-5 space-y-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:border-transparent transition"
          />
        </div>

        {/* Role filters */}
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[140px]">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <select
              value={roleFilter}
              onChange={e => setRoleFilter(e.target.value)}
              className="w-full pl-8 pr-7 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl appearance-none focus:outline-none focus:ring-2 focus:ring-yellow-400 transition"
            >
              {ROLE_FILTER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
          </div>

          <div className="relative flex-1 min-w-[160px]">
            <Shield className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <select
              value={jewelRoleFilter}
              onChange={e => setJewelRoleFilter(e.target.value)}
              className="w-full pl-8 pr-7 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl appearance-none focus:outline-none focus:ring-2 focus:ring-yellow-400 transition"
            >
              {JEWEL_ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex gap-3 mb-5 overflow-x-auto pb-1 scrollbar-hide">
        {[
          { label: 'Total', count: users.length, color: 'bg-slate-100 text-slate-700' },
          { label: 'Admins', count: users.filter(u => u.role === 'admin').length, color: 'bg-amber-50 text-amber-700' },
          { label: 'With Profile', count: profiles.length, color: 'bg-green-50 text-green-700' },
          { label: 'Showing', count: filtered.length, color: 'bg-blue-50 text-blue-700' },
        ].map(s => (
          <div key={s.label} className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium ${s.color}`}>
            <span className="font-bold">{s.count}</span>
            <span className="opacity-70">{s.label}</span>
          </div>
        ))}
      </div>

      {/* User list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="bg-white rounded-2xl h-24 animate-pulse border border-slate-100" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <UserCog className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No users found</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(user => (
            <UserCard
              key={user.id}
              user={user}
              profile={getProfile(user.id)}
              tenants={tenants}
              branches={branches}
              onEdit={() => openEdit(user)}
            />
          ))}
        </div>
      )}

      {/* Edit Modal */}
      {editingUser && editingProfile && (
        <EditProfileModal
          user={editingUser}
          profile={editingProfile}
          tenants={tenants}
          branches={branches}
          allProfiles={profiles}
          saving={saving}
          onSave={handleSave}
          onClose={() => { setEditingUser(null); setEditingProfile(null); }}
        />
      )}
    </div>
  );
}