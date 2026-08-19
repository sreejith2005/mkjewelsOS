import React from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createPageUrl } from '@/utils';

export default function SwipeCard({ 
  title, 
  subtitle, 
  icon: Icon, 
  value, 
  trend,
  trendUp,
  color = 'blue',
  page,
  index 
}) {
  const colorClasses = {
    blue: 'from-blue-500 to-blue-600',
    amber: 'from-amber-500 to-amber-600',
    emerald: 'from-emerald-500 to-emerald-600',
    violet: 'from-violet-500 to-violet-600',
    rose: 'from-rose-500 to-rose-600',
    slate: 'from-slate-600 to-slate-700',
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: index * 0.1 }}
      className="flex-shrink-0 w-72 snap-center"
    >
      <Link to={createPageUrl(page)}>
        <div className={`bg-gradient-to-br ${colorClasses[color]} rounded-2xl p-6 h-40 shadow-lg hover:shadow-xl transition-shadow`}>
          <div className="flex items-start justify-between">
            <div className="p-2 bg-white/20 rounded-xl backdrop-blur-sm">
              <Icon className="h-5 w-5 text-white" />
            </div>
            <ChevronRight className="h-5 w-5 text-white/60" />
          </div>
          <div className="mt-4">
            <p className="text-white/80 text-sm">{subtitle}</p>
            <p className="text-white text-2xl font-bold mt-1">{value}</p>
            <p className="text-xs font-medium mt-2">
              <span className={trendUp ? 'text-emerald-200' : 'text-rose-200'}>
                {trend}
              </span>
              <span className="text-white/60 ml-1">{title}</span>
            </p>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}