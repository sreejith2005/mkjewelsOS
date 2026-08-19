const db = globalThis.__B44_DB__ || { auth:{ isAuthenticated: async()=>false, me: async()=>null }, entities:new Proxy({}, { get:()=>({ filter:async()=>[], get:async()=>null, create:async()=>({}), update:async()=>({}), delete:async()=>({}) }) }), integrations:{ Core:{ UploadFile:async()=>({ file_url:'' }) } } };

import React, { useState, useEffect } from 'react';

import { motion, AnimatePresence } from 'framer-motion';
import { 
  Search, Plus, Filter, Users, Star, Phone,
  X, SlidersHorizontal, ChevronDown, UserCheck,
  MessageSquare, Calendar, TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import CustomerCard from '@/components/crm/CustomerCard';
import CustomerForm from '@/components/crm/CustomerForm';
import { makeOwnerProfile, ownerFilter } from '@/components/auth/ownerUtils';
import { format } from 'date-fns';

export default function CRM() {
  const [customers, setCustomers] = useState([]);
  const [filtered, setFiltered] = useState([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [viewCustomer, setViewCustomer] = useState(null);
  const [interactions, setInteractions] = useState([]);
  const [user, setUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);

  useEffect(() => {
    init();
  }, []);

  useEffect(() => {
    filterCustomers();
  }, [search, typeFilter, customers]);

  const init = async () => {
    try {
      const currentUser = await db.auth.me();
      setUser(currentUser);
      const profiles = await db.entities.UserProfile.filter({ user_id: currentUser.id });
      if (profiles.length > 0) setUserProfile(profiles[0]);
      else if (currentUser.role === 'admin') setUserProfile(makeOwnerProfile(currentUser));
    } catch (e) {}
    await loadCustomers();
  };

  const loadCustomers = async () => {
    setLoading(true);
    // Owner (platform admin) lists ALL customers; others filtered by branch
    const data = await db.entities.Customer.list('-created_date', 200);
    setCustomers(data);
    setLoading(false);
  };

  const filterCustomers = () => {
    let result = [...customers];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.first_name?.toLowerCase().includes(q) ||
        c.last_name?.toLowerCase().includes(q) ||
        c.phone?.includes(q) ||
        c.email?.toLowerCase().includes(q)
      );
    }
    if (typeFilter !== 'all') {
      result = result.filter(c => c.customer_type === typeFilter);
    }
    setFiltered(result);
  };

  const handleSave = async (formData) => {
    setSaving(true);
    if (userProfile) {
      formData.tenant_id = userProfile.tenant_id;
      formData.branch_id = userProfile.branch_id;
    }
    if (selectedCustomer) {
      await db.entities.Customer.update(selectedCustomer.id, formData);
    } else {
      await db.entities.Customer.create(formData);
    }
    await loadCustomers();
    setSaving(false);
    setShowForm(false);
    setSelectedCustomer(null);
  };

  const openCustomer = async (customer) => {
    setViewCustomer(customer);
    const data = await db.entities.CustomerInteraction.filter({ customer_id: customer.id });
    setInteractions(data);
  };

  const stats = {
    total: customers.length,
    vip: customers.filter(c => c.customer_type === 'vip').length,
    newThisMonth: customers.filter(c => {
      const d = new Date(c.created_date);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length,
  };

  return (
    <div className="min-h-screen bg-slate-50 pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 pt-16 pb-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">CRM</h1>
            <p className="text-slate-400 text-sm mt-1">Customer Relationship Management</p>
          </div>
          <Button
            onClick={() => { setSelectedCustomer(null); setShowForm(true); }}
            className="bg-amber-500 hover:bg-amber-600 text-white rounded-xl"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add
          </Button>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Total', value: stats.total, color: 'bg-blue-500/20 text-blue-300' },
            { label: 'VIP', value: stats.vip, color: 'bg-amber-500/20 text-amber-300' },
            { label: 'New', value: stats.newThisMonth, color: 'bg-emerald-500/20 text-emerald-300' },
          ].map(stat => (
            <div key={stat.label} className={`${stat.color} rounded-xl p-3 text-center`}>
              <p className="text-2xl font-bold">{stat.value}</p>
              <p className="text-xs opacity-80 mt-0.5">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customers..."
            className="pl-10 bg-white/10 border-white/20 text-white placeholder:text-slate-400 rounded-xl"
          />
        </div>
      </div>

      {/* Filters */}
      <div className="px-6 py-4 flex gap-2 overflow-x-auto">
        {['all', 'regular', 'vip', 'wholesale', 'corporate'].map(type => (
          <button
            key={type}
            onClick={() => setTypeFilter(type)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-all ${
              typeFilter === type
                ? 'bg-amber-500 text-white shadow-sm'
                : 'bg-white text-slate-600 border border-slate-200 hover:border-amber-300'
            }`}
          >
            {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Customer List */}
      <div className="px-6 space-y-3">
        {loading ? (
          [1,2,3,4].map(i => (
            <div key={i} className="h-24 bg-slate-200 animate-pulse rounded-xl" />
          ))
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Users className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">No customers found</p>
            <p className="text-slate-400 text-sm mt-1">Add your first customer to get started</p>
            <Button
              onClick={() => setShowForm(true)}
              className="mt-4 bg-amber-500 hover:bg-amber-600"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Customer
            </Button>
          </div>
        ) : (
          filtered.map((customer, i) => (
            <CustomerCard
              key={customer.id}
              customer={customer}
              index={i}
              onClick={openCustomer}
            />
          ))
        )}
      </div>

      {/* Add/Edit Customer Sheet */}
      <Sheet open={showForm} onOpenChange={setShowForm}>
        <SheetContent side="bottom" className="h-[90vh] overflow-y-auto rounded-t-3xl">
          <SheetHeader className="mb-6">
            <SheetTitle>{selectedCustomer ? 'Edit Customer' : 'New Customer'}</SheetTitle>
          </SheetHeader>
          <CustomerForm
            customer={selectedCustomer}
            onSave={handleSave}
            onCancel={() => setShowForm(false)}
            loading={saving}
          />
        </SheetContent>
      </Sheet>

      {/* View Customer Sheet */}
      <Sheet open={!!viewCustomer} onOpenChange={(open) => !open && setViewCustomer(null)}>
        <SheetContent side="bottom" className="h-[85vh] overflow-y-auto rounded-t-3xl">
          {viewCustomer && (
            <>
              <SheetHeader className="mb-6">
                <div className="flex items-start justify-between">
                  <div>
                    <SheetTitle className="text-xl">
                      {viewCustomer.first_name} {viewCustomer.last_name}
                    </SheetTitle>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge className={viewCustomer.customer_type === 'vip' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-600'}>
                        {viewCustomer.customer_type === 'vip' && <Star className="h-3 w-3 mr-1 fill-amber-500" />}
                        {viewCustomer.customer_type}
                      </Badge>
                    </div>
                  </div>
                </div>
              </SheetHeader>

              <div className="space-y-6">
                {/* Contact Info */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-slate-500 mb-1">
                      <Phone className="h-4 w-4" />
                      <span className="text-xs">Phone</span>
                    </div>
                    <p className="font-medium">{viewCustomer.phone}</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-slate-500 mb-1">
                      <TrendingUp className="h-4 w-4" />
                      <span className="text-xs">Total Purchases</span>
                    </div>
                    <p className="font-medium">₹{(viewCustomer.total_purchases || 0).toLocaleString()}</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-slate-500 mb-1">
                      <Star className="h-4 w-4" />
                      <span className="text-xs">Loyalty Points</span>
                    </div>
                    <p className="font-medium">{viewCustomer.loyalty_points || 0} pts</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4">
                    <div className="flex items-center gap-2 text-slate-500 mb-1">
                      <UserCheck className="h-4 w-4" />
                      <span className="text-xs">Source</span>
                    </div>
                    <p className="font-medium capitalize">{viewCustomer.source?.replace('_', ' ')}</p>
                  </div>
                </div>

                {/* Interactions */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-slate-800">Interactions ({interactions.length})</h3>
                  </div>
                  {interactions.length === 0 ? (
                    <div className="text-center py-8 bg-slate-50 rounded-xl">
                      <MessageSquare className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-slate-500 text-sm">No interactions yet</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {interactions.map(interaction => (
                        <div key={interaction.id} className="bg-slate-50 rounded-xl p-4">
                          <div className="flex items-center justify-between">
                            <Badge variant="outline" className="capitalize">
                              {interaction.type}
                            </Badge>
                            <span className="text-xs text-slate-400">
                              {format(new Date(interaction.created_date), 'MMM d, h:mm a')}
                            </span>
                          </div>
                          {interaction.description && (
                            <p className="text-sm text-slate-600 mt-2">{interaction.description}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Edit Button */}
                <Button
                  onClick={() => {
                    setSelectedCustomer(viewCustomer);
                    setViewCustomer(null);
                    setShowForm(true);
                  }}
                  className="w-full bg-amber-500 hover:bg-amber-600"
                >
                  Edit Customer
                </Button>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}