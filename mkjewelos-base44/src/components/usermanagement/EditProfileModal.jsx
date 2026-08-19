import React, { useState } from 'react';
import { X, Save, Loader2, ChevronDown, AlertTriangle } from 'lucide-react';

const ROLE_LEVELS = [
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'tenant_admin', label: 'Tenant Admin' },
  { value: 'branch_manager', label: 'Branch Manager' },
  { value: 'department_head', label: 'Department Head' },
  { value: 'team_lead', label: 'Team Lead' },
  { value: 'staff', label: 'Staff' },
];

const ROLE_COLORS = {
  super_admin: 'bg-red-50 border-red-200 text-red-700',
  tenant_admin: 'bg-purple-50 border-purple-200 text-purple-700',
  branch_manager: 'bg-blue-50 border-blue-200 text-blue-700',
  department_head: 'bg-indigo-50 border-indigo-200 text-indigo-700',
  team_lead: 'bg-cyan-50 border-cyan-200 text-cyan-700',
  staff: 'bg-slate-50 border-slate-200 text-slate-600',
};

const WEEK_DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

const WEEK_OFF_PATTERNS = [
  { value: 'fixed', label: 'Fixed (same days each week)' },
  { value: 'alternate_2_1', label: 'Alternate (2 off week 1, 1 off week 2)' },
  { value: 'alternate_1_2', label: 'Alternate (1 off week 1, 2 off week 2)' },
];

const WORKING_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'probation', label: 'Probation' },
  { value: 'on_leave', label: 'On Leave' },
  { value: 'resigned', label: 'Resigned' },
  { value: 'terminated', label: 'Terminated' },
];

const RESIGNATION_REASONS = [
  { value: 'better_opportunity', label: 'Better Opportunity' },
  { value: 'personal_reasons', label: 'Personal Reasons' },
  { value: 'relocation', label: 'Relocation' },
  { value: 'higher_studies', label: 'Higher Studies' },
  { value: 'health', label: 'Health Reasons' },
  { value: 'family', label: 'Family Reasons' },
  { value: 'salary_dissatisfaction', label: 'Salary Dissatisfaction' },
  { value: 'work_culture', label: 'Work Culture' },
  { value: 'career_growth', label: 'Better Career Growth' },
  { value: 'other', label: 'Other' },
];

const SelectField = ({ label, value, onChange, children }) => (
  <div>
    <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">{label}</label>
    <div className="relative">
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full px-3 pr-8 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl appearance-none focus:outline-none focus:ring-2 focus:ring-yellow-400 transition"
      >
        {children}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
    </div>
  </div>
);

const TextField = ({ label, value, onChange, placeholder, type = 'text' }) => (
  <div>
    <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">{label}</label>
    <input
      type={type}
      placeholder={placeholder}
      value={value || ''}
      onChange={e => onChange(e.target.value)}
      className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-400 transition"
    />
  </div>
);

export default function EditProfileModal({ user, profile, tenants, branches, allProfiles = [], saving, onSave, onClose }) {
  const [form, setForm] = useState({ ...profile });
  const [tab, setTab] = useState('info'); // info | schedule | resignation

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));
  const filteredBranches = form.tenant_id ? branches.filter(b => b.tenant_id === form.tenant_id) : branches;
  const buddyCandidates = allProfiles.filter(p => p.user_id !== user.id && (p.branch_id === form.branch_id || !form.branch_id));
  const isResigning = ['resigned', 'terminated'].includes(form.working_status);

  const toggleWeekOff = (day) => {
    const current = form.week_off || [];
    set('week_off', current.includes(day) ? current.filter(d => d !== day) : [...current, day]);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  const initials = user.full_name
    ? user.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
    : user.email?.[0]?.toUpperCase() || '?';

  const TABS = [
    { id: 'info', label: 'Info' },
    { id: 'schedule', label: 'Schedule' },
    { id: 'resignation', label: 'Exit', alert: isResigning },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-lg bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-slate-200" />
        </div>

        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold text-white flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, #d4af37 0%, #b8860b 100%)' }}>
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-800 text-sm truncate">{user.full_name || user.email}</p>
            <p className="text-xs text-slate-400 truncate">{user.email}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
            <X className="h-4 w-4 text-slate-500" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 py-3 text-xs font-semibold flex items-center justify-center gap-1 transition-colors ${
                tab === t.id ? 'text-amber-600 border-b-2 border-amber-500' : 'text-slate-500'
              }`}
            >
              {t.alert && <AlertTriangle className="h-3 w-3 text-rose-500" />}
              {t.label}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-5 space-y-4">

          {/* ── TAB: INFO ── */}
          {tab === 'info' && (
            <>
              {/* Role */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wider">App Role</label>
                <div className="grid grid-cols-3 gap-2">
                  {ROLE_LEVELS.map(r => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => set('role_level', r.value)}
                      className={`py-2 px-2 rounded-xl border text-xs font-medium transition-all ${
                        form.role_level === r.value
                          ? ROLE_COLORS[r.value] + ' ring-2 ring-offset-1 ring-current'
                          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tenant + Branch */}
              <SelectField label="Tenant" value={form.tenant_id} onChange={v => { set('tenant_id', v); set('branch_id', ''); }}>
                <option value="">— No Tenant —</option>
                {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </SelectField>

              <SelectField label="Branch" value={form.branch_id} onChange={v => set('branch_id', v)}>
                <option value="">— No Branch —</option>
                {filteredBranches.map(b => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </SelectField>

              {/* Designation */}
              <TextField label="Designation" value={form.designation} onChange={v => set('designation', v)} placeholder="e.g. Sales Executive" />

              {/* Employee Code */}
              <TextField label="Employee Code" value={form.employee_code} onChange={v => set('employee_code', v)} placeholder="EMP001" />

              {/* Personal Phone */}
              <TextField label="Personal Mobile Number" value={form.personal_phone} onChange={v => set('personal_phone', v)} placeholder="+91 9876543210" type="tel" />

              {/* Official Phone */}
              <TextField label="Official Mobile Number" value={form.official_phone} onChange={v => set('official_phone', v)} placeholder="+91 9000000000" type="tel" />

              {/* Date of Joining */}
              <TextField label="Date of Joining" value={form.date_of_joining} onChange={v => set('date_of_joining', v)} type="date" />

              {/* Working Status */}
              <SelectField label="Working Status" value={form.working_status} onChange={v => { set('working_status', v); if (!['resigned','terminated'].includes(v)) setTab('info'); }}>
                {WORKING_STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </SelectField>

              {/* Active toggle */}
              <div className="flex items-center justify-between py-3 px-4 bg-slate-50 rounded-xl border border-slate-200">
                <div>
                  <p className="text-sm font-medium text-slate-700">Active Status</p>
                  <p className="text-xs text-slate-400">Whether this user is currently active</p>
                </div>
                <button
                  type="button"
                  onClick={() => set('is_active', !form.is_active)}
                  className={`relative w-11 h-6 rounded-full transition-colors ${form.is_active ? 'bg-green-500' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${form.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>
            </>
          )}

          {/* ── TAB: SCHEDULE ── */}
          {tab === 'schedule' && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2 uppercase tracking-wider">Week Off Days</label>
                <div className="grid grid-cols-4 gap-2">
                  {WEEK_DAYS.map(day => (
                    <button
                      key={day}
                      type="button"
                      onClick={() => toggleWeekOff(day)}
                      className={`py-2 rounded-xl border text-xs font-medium capitalize transition-all ${
                        (form.week_off || []).includes(day)
                          ? 'bg-amber-50 border-amber-400 text-amber-700'
                          : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                      }`}
                    >
                      {day.slice(0, 3)}
                    </button>
                  ))}
                </div>
              </div>

              <SelectField label="Week Off Pattern" value={form.week_off_pattern} onChange={v => set('week_off_pattern', v)}>
                {WEEK_OFF_PATTERNS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </SelectField>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">Buddy (Task Cover)</label>
                <div className="relative">
                  <select
                    value={form.buddy_id || ''}
                    onChange={e => set('buddy_id', e.target.value)}
                    className="w-full px-3 pr-8 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl appearance-none focus:outline-none focus:ring-2 focus:ring-yellow-400 transition"
                  >
                    <option value="">— No Buddy —</option>
                    {buddyCandidates.map(p => (
                      <option key={p.id} value={p.id}>{p.designation || p.user_id}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                </div>
                <p className="text-xs text-slate-400 mt-1">When this employee is absent, their buddy handles their tasks.</p>
              </div>
            </>
          )}

          {/* ── TAB: RESIGNATION / EXIT ── */}
          {tab === 'resignation' && (
            <>
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 flex gap-2">
                <AlertTriangle className="h-4 w-4 text-rose-500 flex-shrink-0 mt-0.5" />
                <p className="text-xs text-rose-700">Fill this section when processing an employee exit. All fields are optional but recommended.</p>
              </div>

              <TextField label="Resignation Date" value={form.resignation_date} onChange={v => set('resignation_date', v)} type="date" />
              <TextField label="Last Working Day" value={form.last_working_day} onChange={v => set('last_working_day', v)} type="date" />

              <SelectField label="Reason for Resignation" value={form.resignation_reason} onChange={v => set('resignation_reason', v)}>
                <option value="">— Select Reason —</option>
                {RESIGNATION_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </SelectField>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">Resignation Remarks</label>
                <textarea
                  value={form.resignation_remarks || ''}
                  onChange={e => set('resignation_remarks', e.target.value)}
                  placeholder="Additional notes about the exit..."
                  rows={3}
                  className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-400 transition resize-none"
                />
              </div>

              {/* Checklist */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-600 uppercase tracking-wider">Exit Checklist</label>
                {[
                  { key: 'exit_interview_done', label: 'Exit interview conducted' },
                  { key: 'assets_returned', label: 'Assets / ID card returned' },
                  { key: 'full_and_final_cleared', label: 'Full & Final settlement cleared' },
                  { key: 'rehire_eligible', label: 'Eligible for rehire' },
                ].map(item => (
                  <div key={item.key} className="flex items-center justify-between py-2.5 px-4 bg-slate-50 rounded-xl border border-slate-200">
                    <p className="text-sm text-slate-700">{item.label}</p>
                    <button
                      type="button"
                      onClick={() => set(item.key, !form[item.key])}
                      className={`relative w-11 h-6 rounded-full transition-colors ${form[item.key] ? 'bg-green-500' : 'bg-slate-300'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${form[item.key] ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-opacity disabled:opacity-70"
              style={{ background: 'linear-gradient(135deg, #d4af37 0%, #b8860b 100%)' }}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}