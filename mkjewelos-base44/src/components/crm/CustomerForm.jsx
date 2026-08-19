import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format } from 'date-fns';
import { CalendarIcon, Save, X } from 'lucide-react';

export default function CustomerForm({ customer, onSave, onCancel, loading }) {
  const [formData, setFormData] = useState(customer || {
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    alt_phone: '',
    gender: '',
    customer_type: 'regular',
    source: 'walk_in',
    date_of_birth: '',
    anniversary_date: '',
    address: { line1: '', line2: '', city: '', state: '', pincode: '' },
    notes: '',
  });

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleAddressChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      address: { ...prev.address, [field]: value }
    }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>First Name *</Label>
          <Input
            value={formData.first_name}
            onChange={(e) => handleChange('first_name', e.target.value)}
            placeholder="Enter first name"
            required
          />
        </div>
        <div>
          <Label>Last Name</Label>
          <Input
            value={formData.last_name}
            onChange={(e) => handleChange('last_name', e.target.value)}
            placeholder="Enter last name"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Phone *</Label>
          <Input
            value={formData.phone}
            onChange={(e) => handleChange('phone', e.target.value)}
            placeholder="+91 98765 43210"
            required
          />
        </div>
        <div>
          <Label>Alt Phone</Label>
          <Input
            value={formData.alt_phone}
            onChange={(e) => handleChange('alt_phone', e.target.value)}
            placeholder="Alternative number"
          />
        </div>
      </div>

      <div>
        <Label>Email</Label>
        <Input
          type="email"
          value={formData.email}
          onChange={(e) => handleChange('email', e.target.value)}
          placeholder="customer@email.com"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Customer Type</Label>
          <Select value={formData.customer_type} onValueChange={(v) => handleChange('customer_type', v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="regular">Regular</SelectItem>
              <SelectItem value="vip">VIP</SelectItem>
              <SelectItem value="wholesale">Wholesale</SelectItem>
              <SelectItem value="corporate">Corporate</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Source</Label>
          <Select value={formData.source} onValueChange={(v) => handleChange('source', v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="walk_in">Walk-in</SelectItem>
              <SelectItem value="referral">Referral</SelectItem>
              <SelectItem value="online">Online</SelectItem>
              <SelectItem value="social_media">Social Media</SelectItem>
              <SelectItem value="advertisement">Advertisement</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>Gender</Label>
          <Select value={formData.gender} onValueChange={(v) => handleChange('gender', v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select gender" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="male">Male</SelectItem>
              <SelectItem value="female">Female</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Date of Birth</Label>
          <Input
            type="date"
            value={formData.date_of_birth}
            onChange={(e) => handleChange('date_of_birth', e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label>Address</Label>
        <div className="space-y-2 mt-1">
          <Input
            value={formData.address?.line1 || ''}
            onChange={(e) => handleAddressChange('line1', e.target.value)}
            placeholder="Address line 1"
          />
          <div className="grid grid-cols-3 gap-2">
            <Input
              value={formData.address?.city || ''}
              onChange={(e) => handleAddressChange('city', e.target.value)}
              placeholder="City"
            />
            <Input
              value={formData.address?.state || ''}
              onChange={(e) => handleAddressChange('state', e.target.value)}
              placeholder="State"
            />
            <Input
              value={formData.address?.pincode || ''}
              onChange={(e) => handleAddressChange('pincode', e.target.value)}
              placeholder="Pincode"
            />
          </div>
        </div>
      </div>

      <div>
        <Label>Notes</Label>
        <Textarea
          value={formData.notes}
          onChange={(e) => handleChange('notes', e.target.value)}
          placeholder="Any special notes about the customer..."
          className="h-20"
        />
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1">
          <X className="h-4 w-4 mr-2" />
          Cancel
        </Button>
        <Button type="submit" disabled={loading} className="flex-1 bg-amber-500 hover:bg-amber-600">
          <Save className="h-4 w-4 mr-2" />
          {loading ? 'Saving...' : 'Save Customer'}
        </Button>
      </div>
    </form>
  );
}