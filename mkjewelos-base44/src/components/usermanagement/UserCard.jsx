import React from 'react';
import { Pencil, Building2, GitBranch, Shield, CheckCircle, XCircle } from 'lucide-react';
import { ROLE_LABELS } from '@/components/navigation/roleMenuConfig';

export default function UserCard({ user, profile, tenants, branches, onEdit }) {
  const tenant = tenants.find(t => t.id === profile?.tenant_id);
  const branch = branches.find(b => b.id === profile?.branch_id);
  const roleInfo = profile?.role_level ? ROLE_LABELS[profile.role_level] : null;

  const initials = user.full_name
    ? user.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : user.email?.[0]?.toUpperCase() || '?';

  return (
    <div className="bg-white rounded-2xl border border-slate-100 shadow-sm px-4 py-4 flex items-start gap-4 hover:shadow-md transition-shadow">
      {/* Avatar */}
      <div className="flex-shrink-0">
        {profile?.avatar_url ? (
          <img src={profile.avatar_url} alt={user.full_name} className="w-11 h-11 rounded-xl object-cover" />
        ) : (
          <div className="w-11 h-11 rounded-xl flex items-center justify-center text-sm font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #d4af37 0%, #b8860b 100%)' }}>
            {initials}
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-slate-800 text-sm truncate">{user.full_name || '—'}</p>
          {user.role === 'admin' && (
            <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-100 text-amber-700 uppercase tracking-wide">
              Platform Admin
            </span>
          )}
          {roleInfo && (
            <span className={`flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${roleInfo.color}`}>
              {roleInfo.label}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-0.5 truncate">{user.email}</p>

        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2">
          {tenant && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Building2 className="h-3 w-3 text-slate-400" />
              {tenant.name}
            </span>
          )}
          {branch && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <GitBranch className="h-3 w-3 text-slate-400" />
              {branch.name}
            </span>
          )}
          {profile?.designation && (
            <span className="flex items-center gap-1 text-xs text-slate-500">
              <Shield className="h-3 w-3 text-slate-400" />
              {profile.designation}
            </span>
          )}
        </div>

        {profile && (
          <div className="flex items-center gap-1 mt-1.5">
            {profile.is_active ? (
              <span className="flex items-center gap-0.5 text-[10px] text-green-600">
                <CheckCircle className="h-3 w-3" /> Active
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                <XCircle className="h-3 w-3" /> Inactive
              </span>
            )}
          </div>
        )}
      </div>

      {/* Edit */}
      <button
        onClick={onEdit}
        className="flex-shrink-0 w-8 h-8 rounded-xl bg-slate-50 hover:bg-amber-50 border border-slate-200 hover:border-amber-200 flex items-center justify-center transition-colors"
      >
        <Pencil className="h-3.5 w-3.5 text-slate-500 hover:text-amber-600" />
      </button>
    </div>
  );
}