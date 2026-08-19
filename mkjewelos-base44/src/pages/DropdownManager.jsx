const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { Plus, Pencil, Trash2, Save, X, ChevronDown, Settings2, Shield } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const DROPDOWN_CATEGORIES = [
  { value: 'branch_types', label: 'Branch Types' },
  { value: 'department_types', label: 'Department Types' },
  { value: 'designation_list', label: 'Designations' },
  { value: 'role_levels', label: 'App Roles' },
  { value: 'task_priorities', label: 'Task Priorities' },
  { value: 'task_types', label: 'Task Types' },
  { value: 'customer_types', label: 'Customer Types' },
  { value: 'working_status', label: 'Working Status' },
  { value: 'resignation_reasons', label: 'Resignation Reasons' },
  { value: 'week_off_patterns', label: 'Week Off Patterns' },
  { value: 'fms_stages', label: 'FMS Stage Names' },
  { value: 'form_categories', label: 'Form Categories' },
  { value: 'interaction_types', label: 'Interaction Types' },
  { value: 'lead_sources', label: 'Lead Sources' },
  { value: 'custom', label: 'Custom / Other' },
];

export default function DropdownManager() {
  const [user, setUser] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCat, setSelectedCat] = useState('designation_list');
  const [editingItem, setEditingItem] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ category: 'designation_list', label: '', value: '', order: 0, is_active: true });
  const [saving, setSaving] = useState(false);

  useEffect(() => { init(); }, []);

  const init = async () => {
    const currentUser = await db.auth.me();
    setUser(currentUser);
    await load();
  };

  const load = async () => {
    setLoading(true);
    const data = await db.entities.DropdownConfig.list('order', 500);
    setItems(data);
    setLoading(false);
  };

  const catItems = items.filter(i => i.category === selectedCat).sort((a, b) => (a.order || 0) - (b.order || 0));

  const openAdd = () => {
    setEditingItem(null);
    setForm({ category: selectedCat, label: '', value: '', order: catItems.length, is_active: true });
    setShowForm(true);
  };

  const openEdit = (item) => {
    setEditingItem(item);
    setForm({ ...item });
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const payload = { ...form, value: form.value || form.label.toLowerCase().replace(/\s+/g, '_') };
    if (editingItem) {
      await db.entities.DropdownConfig.update(editingItem.id, payload);
    } else {
      await db.entities.DropdownConfig.create(payload);
    }
    await load();
    setSaving(false);
    setShowForm(false);
  };

  const handleDelete = async (item) => {
    if (!confirm(`Delete "${item.label}"?`)) return;
    await db.entities.DropdownConfig.delete(item.id);
    await load();
  };

  const toggleActive = async (item) => {
    await db.entities.DropdownConfig.update(item.id, { is_active: !item.is_active });
    await load();
  };

  if (user && user.role !== 'admin') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-8 text-center">
        <Shield className="h-12 w-12 text-rose-400 mb-4" />
        <h2 className="text-xl font-bold text-slate-800 mb-2">Super Admin Only</h2>
        <p className="text-slate-500 text-sm">Only platform administrators can manage dropdown options.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 pt-16 pb-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #d4af37 0%, #b8860b 100%)' }}>
              <Settings2 className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Dropdown Manager</h1>
              <p className="text-slate-400 text-xs">Edit all dropdown options across the app</p>
            </div>
          </div>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-slate-900"
            style={{ background: 'linear-gradient(135deg, #d4af37 0%, #b8860b 100%)' }}
          >
            <Plus className="h-4 w-4" />
            Add
          </button>
        </div>
      </div>

      {/* Category selector */}
      <div className="px-4 pt-4">
        <div className="relative mb-4">
          <select
            value={selectedCat}
            onChange={e => setSelectedCat(e.target.value)}
            className="w-full px-4 pr-10 py-3 text-sm font-medium bg-white border border-slate-200 rounded-2xl appearance-none shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
          >
            {DROPDOWN_CATEGORIES.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
          <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        </div>

        {/* Category pills */}
        <div className="flex gap-2 overflow-x-auto pb-3 mb-2 scrollbar-hide">
          {DROPDOWN_CATEGORIES.map(c => (
            <button
              key={c.value}
              onClick={() => setSelectedCat(c.value)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                selectedCat === c.value ? 'bg-amber-500 text-white shadow' : 'bg-white text-slate-600 border border-slate-200'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        {/* Stats */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 bg-white rounded-xl border border-slate-100 p-3 text-center">
            <p className="text-xl font-bold text-slate-800">{catItems.length}</p>
            <p className="text-xs text-slate-500">Total</p>
          </div>
          <div className="flex-1 bg-white rounded-xl border border-slate-100 p-3 text-center">
            <p className="text-xl font-bold text-emerald-600">{catItems.filter(i => i.is_active).length}</p>
            <p className="text-xs text-slate-500">Active</p>
          </div>
          <div className="flex-1 bg-white rounded-xl border border-slate-100 p-3 text-center">
            <p className="text-xl font-bold text-slate-400">{catItems.filter(i => !i.is_active).length}</p>
            <p className="text-xs text-slate-500">Inactive</p>
          </div>
        </div>

        {/* Items list */}
        {loading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => <div key={i} className="h-16 bg-slate-200 animate-pulse rounded-2xl" />)}
          </div>
        ) : catItems.length === 0 ? (
          <div className="text-center py-16">
            <Settings2 className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No options in this category</p>
            <button onClick={openAdd} className="mt-4 px-4 py-2 rounded-xl text-sm font-medium text-white" style={{ background: 'linear-gradient(135deg, #d4af37 0%, #b8860b 100%)' }}>
              <Plus className="h-4 w-4 inline mr-1" />
              Add First Option
            </button>
          </div>
        ) : (
          <AnimatePresence>
            <div className="space-y-2">
              {catItems.map((item, i) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={`bg-white rounded-2xl border p-4 flex items-center gap-3 transition-all ${item.is_active ? 'border-slate-100' : 'border-slate-100 opacity-50'}`}
                >
                  <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">
                    {item.order ?? i}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-800 text-sm">{item.label}</p>
                    <p className="text-xs text-slate-400 font-mono">{item.value}</p>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => toggleActive(item)}
                      className={`relative w-9 h-5 rounded-full transition-colors ${item.is_active ? 'bg-green-400' : 'bg-slate-200'}`}
                    >
                      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${item.is_active ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                    <button onClick={() => openEdit(item)} className="w-8 h-8 rounded-xl hover:bg-amber-50 flex items-center justify-center text-slate-400 hover:text-amber-600 transition-colors">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => handleDelete(item)} className="w-8 h-8 rounded-xl hover:bg-rose-50 flex items-center justify-center text-slate-400 hover:text-rose-500 transition-colors">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </AnimatePresence>
        )}
      </div>

      {/* Add/Edit Sheet */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setShowForm(false)} />
          <div className="relative w-full sm:max-w-md bg-white sm:rounded-3xl rounded-t-3xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-slate-800">{editingItem ? 'Edit Option' : 'Add New Option'}</h3>
              <button onClick={() => setShowForm(false)} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center">
                <X className="h-4 w-4 text-slate-500" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">Category</label>
                <div className="relative">
                  <select
                    value={form.category}
                    onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full px-3 pr-8 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl appearance-none focus:outline-none focus:ring-2 focus:ring-yellow-400"
                  >
                    {DROPDOWN_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                  <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">Display Label *</label>
                <input
                  type="text"
                  value={form.label}
                  onChange={e => setForm(f => ({ ...f, label: e.target.value, value: e.target.value.toLowerCase().replace(/\s+/g,'_') }))}
                  placeholder="e.g. Sales Executive"
                  className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">Internal Value</label>
                <input
                  type="text"
                  value={form.value}
                  onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                  placeholder="auto-generated from label"
                  className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-400 font-mono"
                />
                <p className="text-xs text-slate-400 mt-1">Leave blank to auto-generate from label</p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5 uppercase tracking-wider">Sort Order</label>
                <input
                  type="number"
                  value={form.order}
                  onChange={e => setForm(f => ({ ...f, order: Number(e.target.value) }))}
                  className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>

              <div className="flex items-center justify-between py-2.5 px-3 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-sm text-slate-700">Active</p>
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                  className={`relative w-11 h-6 rounded-full transition-colors ${form.is_active ? 'bg-green-500' : 'bg-slate-300'}`}
                >
                  <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow-sm transition-transform ${form.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
                </button>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setShowForm(false)} className="flex-1 py-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !form.label}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
                  style={{ background: 'linear-gradient(135deg, #d4af37 0%, #b8860b 100%)' }}
                >
                  {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Save className="h-4 w-4" />}
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}