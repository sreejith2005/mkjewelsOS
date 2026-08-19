import React, { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { UserCheck, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

const roleColors = {
  super_admin: 'bg-rose-100 text-rose-600',
  tenant_admin: 'bg-violet-100 text-violet-600',
  branch_manager: 'bg-blue-100 text-blue-600',
  department_head: 'bg-amber-100 text-amber-600',
  team_lead: 'bg-emerald-100 text-emerald-600',
  staff: 'bg-slate-100 text-slate-500',
};

export default function DelegateTaskSheet({ 
  open, 
  onClose, 
  task, 
  users = [], 
  userProfiles = [],
  onDelegate,
  loading 
}) {
  const [selectedUser, setSelectedUser] = useState(null);
  const [reason, setReason] = useState('');
  const [search, setSearch] = useState('');

  const filteredUsers = users.filter(u =>
    u.id !== task?.assigned_to &&
    (u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
     u.email?.toLowerCase().includes(search.toLowerCase()))
  );

  const getProfile = (userId) => userProfiles.find(p => p.user_id === userId);

  const handleDelegate = () => {
    if (!selectedUser) return;
    onDelegate?.(task, selectedUser.id, reason);
    setSelectedUser(null);
    setReason('');
    setSearch('');
  };

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent side="bottom" className="h-[80vh] rounded-t-3xl overflow-hidden flex flex-col">
        <SheetHeader className="pb-4">
          <SheetTitle className="flex items-center gap-2">
            <UserCheck className="h-5 w-5 text-violet-500" />
            Delegate Task
          </SheetTitle>
          {task && (
            <p className="text-sm text-slate-500 text-left">{task.title}</p>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-4">
          {/* Search users */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search users..."
              className="pl-10"
            />
          </div>

          {/* User list */}
          <div className="space-y-2">
            {filteredUsers.map(user => {
              const profile = getProfile(user.id);
              const isSelected = selectedUser?.id === user.id;
              return (
                <button
                  key={user.id}
                  onClick={() => setSelectedUser(isSelected ? null : user)}
                  className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 transition-all text-left ${
                    isSelected
                      ? 'border-violet-500 bg-violet-50'
                      : 'border-slate-100 bg-white hover:border-slate-200'
                  }`}
                >
                  <Avatar className="h-10 w-10">
                    <AvatarFallback className="bg-slate-200 text-slate-600 text-sm font-bold">
                      {user.full_name?.charAt(0) || user.email?.charAt(0) || '?'}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-slate-800 truncate">{user.full_name || user.email}</p>
                    {profile && (
                      <p className="text-xs text-slate-500 truncate">{profile.designation || profile.role_level}</p>
                    )}
                  </div>
                  {profile?.role_level && (
                    <Badge className={`text-[10px] ${roleColors[profile.role_level] || roleColors.staff}`}>
                      {profile.role_level.replace('_', ' ')}
                    </Badge>
                  )}
                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-violet-500 flex items-center justify-center flex-shrink-0">
                      <span className="text-white text-xs">✓</span>
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Reason */}
          <div>
            <Label>Reason (optional)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why are you delegating this task?"
              className="h-20 mt-1"
            />
          </div>
        </div>

        <div className="flex gap-3 pt-4 border-t border-slate-100">
          <Button variant="outline" onClick={onClose} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleDelegate}
            disabled={!selectedUser || loading}
            className="flex-1 bg-violet-500 hover:bg-violet-600"
          >
            <UserCheck className="h-4 w-4 mr-2" />
            {loading ? 'Delegating...' : 'Delegate Task'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}