const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { motion } from 'framer-motion';
import { 
  Settings2, User, Building2, Users, 
  Shield, Bell, ChevronRight, Edit2,
  Save, LogOut, Plus, Gem, CheckCircle2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';

export default function Settings() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [branches, setBranches] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSheet, setActiveSheet] = useState(null);
  const [editProfile, setEditProfile] = useState({});

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    try {
      const currentUser = await db.auth.me();
      setUser(currentUser);
      
      const profiles = await db.entities.UserProfile.filter({ user_id: currentUser.id });
      if (profiles.length > 0) {
        setUserProfile(profiles[0]);
        setEditProfile({ ...profiles[0] });
        
        const [tenants, brs, depts] = await Promise.all([
          profiles[0].tenant_id ? db.entities.Tenant.filter({ id: profiles[0].tenant_id }) : [],
          db.entities.Branch.list(),
          db.entities.Department.list(),
        ]);
        if (tenants.length > 0) setTenant(tenants[0]);
        setBranches(brs);
        setDepartments(depts);
      }
    } catch (e) {}
    setLoading(false);
  };

  const saveProfile = async () => {
    setSaving(true);
    if (userProfile) {
      await db.entities.UserProfile.update(userProfile.id, editProfile);
      setUserProfile(editProfile);
    }
    setSaving(false);
    setActiveSheet(null);
  };

  const handleLogout = () => {
    db.auth.logout();
  };

  const roleColor = {
    super_admin: 'bg-rose-100 text-rose-700',
    tenant_admin: 'bg-violet-100 text-violet-700',
    branch_manager: 'bg-blue-100 text-blue-700',
    department_head: 'bg-amber-100 text-amber-700',
    team_lead: 'bg-emerald-100 text-emerald-700',
    staff: 'bg-slate-100 text-slate-600',
  };

  const settingsSections = [
    {
      title: 'Account',
      items: [
        { label: 'Edit Profile', icon: User, action: () => setActiveSheet('profile'), description: 'Name, designation, contact' },
        { label: 'My Branch', icon: Building2, action: null, description: branches.find(b => b.id === userProfile?.branch_id)?.name || 'Not assigned' },
        { label: 'My Department', icon: Users, action: null, description: departments.find(d => d.id === userProfile?.department_id)?.name || 'Not assigned' },
      ]
    },
    {
      title: 'Organization',
      items: [
        { label: 'Tenant Info', icon: Gem, action: () => setActiveSheet('tenant'), description: tenant?.name || 'Loading...' },
        { label: 'Branches', icon: Building2, action: () => setActiveSheet('branches'), description: `${branches.length} branches` },
        { label: 'Departments', icon: Users, action: () => setActiveSheet('departments'), description: `${departments.length} departments` },
      ]
    },
    {
      title: 'Security',
      items: [
        { label: 'Role & Permissions', icon: Shield, action: null, description: userProfile?.role_level?.replace('_', ' ') || 'Staff' },
      ]
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 pt-16 pb-8">
        <h1 className="text-2xl font-bold text-white mb-6">Settings</h1>

        {/* Profile Card */}
        <div className="bg-white/10 backdrop-blur-sm border border-white/20 rounded-2xl p-5">
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16 border-2 border-amber-400/50">
              <AvatarImage src={userProfile?.avatar_url} />
              <AvatarFallback className="bg-gradient-to-br from-amber-400 to-amber-600 text-white text-xl font-bold">
                {user?.full_name?.charAt(0) || '?'}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h2 className="text-white text-lg font-bold">{user?.full_name || 'User'}</h2>
              <p className="text-slate-300 text-sm">{user?.email}</p>
              <div className="flex items-center gap-2 mt-2">
                <Badge className={roleColor[userProfile?.role_level] || 'bg-slate-100 text-slate-600'}>
                  <Shield className="h-3 w-3 mr-1" />
                  {userProfile?.role_level?.replace('_', ' ') || 'Staff'}
                </Badge>
              </div>
            </div>
          </div>
          {userProfile?.designation && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <p className="text-slate-300 text-sm">{userProfile.designation}</p>
              {userProfile.employee_code && (
                <p className="text-slate-400 text-xs font-mono mt-0.5">{userProfile.employee_code}</p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="px-6 pt-6 space-y-6">
        {settingsSections.map(section => (
          <div key={section.title}>
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
              {section.title}
            </h2>
            <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
              {section.items.map((item, i) => (
                <div key={item.label}>
                  {i > 0 && <Separator />}
                  <button
                    onClick={item.action}
                    className={`w-full flex items-center gap-4 p-4 text-left transition-colors ${
                      item.action ? 'hover:bg-slate-50 cursor-pointer' : 'cursor-default'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
                      <item.icon className="h-5 w-5 text-slate-600" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-slate-800">{item.label}</p>
                      <p className="text-sm text-slate-400 mt-0.5">{item.description}</p>
                    </div>
                    {item.action && <ChevronRight className="h-5 w-5 text-slate-300" />}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Logout */}
        <Button
          onClick={handleLogout}
          variant="outline"
          className="w-full border-rose-200 text-rose-600 hover:bg-rose-50 hover:border-rose-300 rounded-xl py-5"
        >
          <LogOut className="h-5 w-5 mr-2" />
          Sign Out
        </Button>

        <div className="text-center pb-4">
          <div className="flex items-center justify-center gap-2 mb-1">
            <Gem className="h-4 w-4 text-amber-500" />
            <span className="font-bold text-slate-700">JewelOS</span>
          </div>
          <p className="text-xs text-slate-400">v1.0.0 · Production Ready SaaS</p>
        </div>
      </div>

      {/* Edit Profile Sheet */}
      <Sheet open={activeSheet === 'profile'} onOpenChange={(open) => !open && setActiveSheet(null)}>
        <SheetContent side="bottom" className="h-[80vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-6">
            <SheetTitle>Edit Profile</SheetTitle>
          </SheetHeader>
          <div className="space-y-4">
            <div>
              <Label>Designation</Label>
              <Input
                value={editProfile.designation || ''}
                onChange={(e) => setEditProfile(p => ({ ...p, designation: e.target.value }))}
                placeholder="e.g. Senior Sales Executive"
              />
            </div>
            <div>
              <Label>Employee Code</Label>
              <Input
                value={editProfile.employee_code || ''}
                onChange={(e) => setEditProfile(p => ({ ...p, employee_code: e.target.value }))}
                placeholder="EMP001"
              />
            </div>
            <div>
              <Label>Phone</Label>
              <Input
                value={editProfile.phone || ''}
                onChange={(e) => setEditProfile(p => ({ ...p, phone: e.target.value }))}
                placeholder="+91 98765 43210"
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setActiveSheet(null)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={saveProfile} disabled={saving} className="flex-1 bg-amber-500 hover:bg-amber-600">
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Branches Sheet */}
      <Sheet open={activeSheet === 'branches'} onOpenChange={(open) => !open && setActiveSheet(null)}>
        <SheetContent side="bottom" className="h-[70vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-6">
            <SheetTitle>All Branches</SheetTitle>
          </SheetHeader>
          <div className="space-y-3">
            {branches.map(branch => (
              <div key={branch.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-4">
                <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                  <Building2 className="h-5 w-5 text-blue-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-800">{branch.name}</p>
                  <p className="text-sm text-slate-500">{branch.code} · {branch.city}</p>
                </div>
                <Badge className={branch.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}>
                  {branch.is_active ? 'Active' : 'Inactive'}
                </Badge>
              </div>
            ))}
            {branches.length === 0 && (
              <p className="text-center text-slate-400 py-8">No branches configured</p>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Departments Sheet */}
      <Sheet open={activeSheet === 'departments'} onOpenChange={(open) => !open && setActiveSheet(null)}>
        <SheetContent side="bottom" className="h-[70vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-6">
            <SheetTitle>All Departments</SheetTitle>
          </SheetHeader>
          <div className="space-y-3">
            {departments.map(dept => (
              <div key={dept.id} className="flex items-center gap-3 bg-slate-50 rounded-xl p-4">
                <div className="w-10 h-10 rounded-xl bg-violet-100 flex items-center justify-center">
                  <Users className="h-5 w-5 text-violet-600" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-slate-800">{dept.name}</p>
                  <p className="text-sm text-slate-500">{dept.code} · {dept.type}</p>
                </div>
              </div>
            ))}
            {departments.length === 0 && (
              <p className="text-center text-slate-400 py-8">No departments configured</p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}