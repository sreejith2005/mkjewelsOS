const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { Building2, ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export default function BranchSwitcher({ userProfile, currentBranch, onBranchChange }) {
  const [branches, setBranches] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!userProfile?.tenant_id) return;
    loadBranches();
  }, [userProfile]);

  const loadBranches = async () => {
    const allBranches = await db.entities.Branch.filter({ tenant_id: userProfile.tenant_id, is_active: true });

    // Super admin / tenant admin → all branches
    // Others → only accessible branches
    if (['super_admin', 'tenant_admin'].includes(userProfile.role_level)) {
      setBranches(allBranches);
    } else if (userProfile.accessible_branches?.length) {
      setBranches(allBranches.filter(b => userProfile.accessible_branches.includes(b.id)));
    } else {
      setBranches(allBranches.filter(b => b.id === userProfile.branch_id));
    }
  };

  const handleSelect = async (branch) => {
    setOpen(false);
    if (branch.id === currentBranch?.id) return;
    // Update profile branch
    await db.entities.UserProfile.update(userProfile.id, { branch_id: branch.id });
    onBranchChange(branch);
  };

  // Single branch — no switcher needed
  if (branches.length <= 1) {
    return (
      <div className="flex items-center gap-1.5 bg-slate-800/50 rounded-xl px-3 py-2">
        <Building2 className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
        <span className="text-sm font-medium text-white truncate max-w-[120px]">
          {currentBranch?.name || 'Branch'}
        </span>
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 bg-slate-800/50 rounded-xl px-3 py-2 hover:bg-slate-700/50 transition-all"
      >
        <Building2 className="h-3.5 w-3.5 text-amber-400 flex-shrink-0" />
        <span className="text-sm font-medium text-white truncate max-w-[110px]">
          {currentBranch?.name || 'Select Branch'}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute top-full left-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden z-50"
            >
              <div className="p-1.5">
                {branches.map(branch => (
                  <button
                    key={branch.id}
                    onClick={() => handleSelect(branch)}
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-all text-left"
                  >
                    <Building2 className="h-4 w-4 text-slate-400 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 truncate">{branch.name}</p>
                      <p className="text-[10px] text-slate-400">{branch.code} · {branch.city}</p>
                    </div>
                    {branch.id === currentBranch?.id && (
                      <Check className="h-4 w-4 text-amber-500 flex-shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}