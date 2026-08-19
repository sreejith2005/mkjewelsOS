import React from 'react';
import { motion } from 'framer-motion';
import { User, Phone, Mail, Calendar, Star, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';

const typeColors = {
  regular: 'bg-slate-100 text-slate-700',
  vip: 'bg-amber-100 text-amber-700',
  wholesale: 'bg-blue-100 text-blue-700',
  corporate: 'bg-violet-100 text-violet-700',
};

export default function CustomerCard({ customer, onClick, index = 0 }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={() => onClick?.(customer)}
      className="bg-white rounded-xl border border-slate-100 p-4 hover:shadow-lg hover:border-amber-200 transition-all cursor-pointer group"
    >
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center flex-shrink-0">
          <User className="h-5 w-5 text-slate-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-800 truncate">
              {customer.first_name} {customer.last_name}
            </h3>
            {customer.customer_type === 'vip' && (
              <Star className="h-4 w-4 text-amber-400 fill-amber-400" />
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
            <span className="flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {customer.phone}
            </span>
          </div>
        </div>
        <Badge className={typeColors[customer.customer_type || 'regular']}>
          {customer.customer_type || 'Regular'}
        </Badge>
      </div>
      
      <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span>₹{(customer.total_purchases || 0).toLocaleString()}</span>
          <span>•</span>
          <span>{customer.loyalty_points || 0} pts</span>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-amber-500 transition-colors" />
      </div>
    </motion.div>
  );
}