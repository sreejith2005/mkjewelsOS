const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect, useCallback } from 'react';

import { motion } from 'framer-motion';
import { RefreshCw, ChevronDown, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { getDashboardData, startAnalyticsCron, getDateRange } from '@/components/dashboard/analyticsEngine';
import { makeOwnerProfile } from '@/components/auth/ownerUtils';
import SalespersonDashboard from '@/components/dashboard/SalespersonDashboard';
import CRMDashboard from '@/components/dashboard/CRMDashboard';
import ManagerDashboard from '@/components/dashboard/ManagerDashboard';

const PERIOD_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'last7', label: 'Last 7 Days' },
  { value: 'last30', label: 'Last 30 Days' },
  { value: 'custom', label: 'Custom Range' },
];

function getRoleDashboardLabel(roleLevel) {
  if (['super_admin', 'tenant_admin', 'branch_manager', 'department_head'].includes(roleLevel)) return { label: 'Manager View', emoji: '📊' };
  if (roleLevel === 'team_lead') return { label: 'CRM Analytics', emoji: '👥' };
  return { label: 'My Performance', emoji: '🎯' };
}

export default function Dashboard() {
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [dashData, setDashData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('today');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [isCached, setIsCached] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);

  useEffect(() => {
    init();
  }, []);

  const init = async () => {
    try {
      const u = await db.auth.me();
      setUser(u);
      const profiles = await db.entities.UserProfile.filter({ user_id: u.id });
      let profile = profiles[0] || null;
      if (!profile && u.role === 'admin') {
        profile = makeOwnerProfile(u);
      }
      if (profile) {
        setUserProfile(profile);
        await fetchDashboard(profile, 'today');
        if (profile.tenant_id) startAnalyticsCron(profile);
      }
    } catch (_) {
      setLoading(false);
    }
  };

  const fetchDashboard = useCallback(async (profile, p, cFrom = null, cTo = null) => {
    setLoading(true);
    const data = await getDashboardData(profile, p, cFrom, cTo);
    setDashData(data);
    setIsCached(data._cached || false);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  const handlePeriodChange = (p) => {
    setPeriod(p);
    if (p !== 'custom') {
      fetchDashboard(userProfile, p);
    }
  };

  const handleCustomApply = () => {
    if (customFrom && customTo) {
      fetchDashboard(userProfile, 'custom', customFrom, customTo);
    }
  };

  const roleInfo = userProfile ? getRoleDashboardLabel(userProfile.role_level) : { label: 'Dashboard', emoji: '📊' };
  const dateRange = dashData ? `${dashData.from} → ${dashData.to}` : '';

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 pt-16 pb-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{roleInfo.emoji}</span>
              <h1 className="text-2xl font-bold text-white">{roleInfo.label}</h1>
            </div>
            <p className="text-slate-400 text-xs mt-1">
              {user?.full_name} · {userProfile?.designation || userProfile?.role_level || 'Staff'}
            </p>
            {dateRange && (
              <p className="text-slate-500 text-xs mt-0.5">{dateRange}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isCached && (
              <span className="text-[10px] text-slate-500 bg-slate-700/50 px-2 py-1 rounded-full">Cached</span>
            )}
            <Button
              onClick={() => fetchDashboard(userProfile, period, customFrom || null, customTo || null)}
              size="icon"
              variant="ghost"
              className="text-white h-9 w-9"
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </div>

        {/* Period Selector */}
        <div className="space-y-2">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {PERIOD_OPTIONS.filter(o => o.value !== 'custom').map(opt => (
              <button
                key={opt.value}
                onClick={() => handlePeriodChange(opt.value)}
                className={`px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                  period === opt.value
                    ? 'bg-amber-500 text-white'
                    : 'bg-white/10 text-slate-300 hover:bg-white/20'
                }`}
              >
                {opt.label}
              </button>
            ))}
            <button
              onClick={() => setPeriod('custom')}
              className={`px-4 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all ${
                period === 'custom' ? 'bg-amber-500 text-white' : 'bg-white/10 text-slate-300 hover:bg-white/20'
              }`}
            >
              Custom
            </button>
          </div>

          {period === 'custom' && (
            <div className="flex gap-2 items-center">
              <Input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="bg-white/10 border-white/20 text-white text-xs h-8 flex-1"
              />
              <span className="text-slate-400 text-xs">to</span>
              <Input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="bg-white/10 border-white/20 text-white text-xs h-8 flex-1"
              />
              <Button
                onClick={handleCustomApply}
                disabled={!customFrom || !customTo}
                size="sm"
                className="bg-amber-500 hover:bg-amber-600 h-8 text-xs"
              >
                Apply
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Dashboard Content */}
      <div className="px-6 pt-5">
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="h-24 bg-slate-200 animate-pulse rounded-2xl" />
            ))}
          </div>
        ) : !dashData ? (
          <div className="text-center py-20">
            <Zap className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No data available</p>
            <p className="text-slate-400 text-sm mt-1">Complete your profile setup to see analytics</p>
          </div>
        ) : (
          <motion.div
            key={`${period}-${dashData.role}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.2 }}
          >
            {dashData.role === 'salesperson' && <SalespersonDashboard data={dashData} />}
            {dashData.role === 'crm' && <CRMDashboard data={dashData} />}
            {dashData.role === 'manager' && <ManagerDashboard data={dashData} />}
          </motion.div>
        )}

        {lastUpdated && !loading && (
          <p className="text-center text-[10px] text-slate-400 mt-6">
            {isCached ? 'Cached · ' : 'Live · '}Updated {lastUpdated.toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}