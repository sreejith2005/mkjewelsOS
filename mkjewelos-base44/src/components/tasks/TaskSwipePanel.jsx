import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';

/**
 * Horizontal swipe container for task panels on Home Screen
 */
export default function TaskSwipePanel({ panels }) {
  return (
    <div className="relative">
      <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-3 px-1 scrollbar-hide">
        {panels.map((panel, i) => (
          <motion.div
            key={panel.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.08 }}
            className="flex-shrink-0 w-[88vw] max-w-sm snap-center"
          >
            <div className={`rounded-2xl overflow-hidden shadow-lg ${panel.bgClass}`}>
              {/* Panel Header */}
              <div className={`px-5 pt-5 pb-3 ${panel.headerClass}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 bg-white/20 rounded-xl">
                      <panel.icon className="h-4 w-4 text-white" />
                    </div>
                    <div>
                      <h3 className="text-white font-bold text-sm">{panel.title}</h3>
                      <p className="text-white/70 text-xs">{panel.subtitle}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="bg-white/20 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      {panel.count}
                    </span>
                    <ChevronRight className="h-4 w-4 text-white/60" />
                  </div>
                </div>
                {/* Progress Bar */}
                {panel.completion !== undefined && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-white/70 mb-1">
                      <span>Completion</span>
                      <span>{panel.completion}%</span>
                    </div>
                    <div className="h-1.5 bg-white/20 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-white rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${panel.completion}%` }}
                        transition={{ delay: i * 0.1 + 0.3, duration: 0.6 }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Task Items */}
              <div className="bg-white/95 backdrop-blur-sm px-4 py-3 max-h-64 overflow-y-auto">
                {panel.items.length === 0 ? (
                  <div className="text-center py-6">
                    <panel.icon className="h-8 w-8 text-slate-300 mx-auto mb-2" />
                    <p className="text-slate-400 text-sm">{panel.emptyText || 'All clear!'}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {panel.items.slice(0, 5).map((item) => (
                      <button
                        key={item.id}
                        onClick={() => panel.onItemClick?.(item)}
                        className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-slate-50 transition-colors text-left"
                      >
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          item.status === 'completed' ? 'bg-emerald-400' :
                          item.priority === 'urgent' ? 'bg-rose-500' :
                          item.priority === 'high' ? 'bg-amber-400' :
                          'bg-blue-400'
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium truncate ${
                            item.status === 'completed' ? 'text-slate-400 line-through' : 'text-slate-700'
                          }`}>
                            {item.title}
                          </p>
                          {item.meta && (
                            <p className="text-xs text-slate-400 truncate">{item.meta}</p>
                          )}
                        </div>
                        {item.checklist_completion_pct !== undefined && item.checklist_completion_pct < 100 && (
                          <span className="text-xs text-slate-400 font-mono flex-shrink-0">
                            {item.checklist_completion_pct}%
                          </span>
                        )}
                        {item.is_delegated && (
                          <span className="text-[10px] bg-violet-100 text-violet-600 px-1.5 py-0.5 rounded-full flex-shrink-0">
                            delegated
                          </span>
                        )}
                      </button>
                    ))}
                    {panel.items.length > 5 && (
                      <button
                        onClick={panel.onViewAll}
                        className="w-full text-center text-xs text-slate-400 py-2 hover:text-amber-500 transition-colors"
                      >
                        +{panel.items.length - 5} more
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Scroll indicator dots */}
      <div className="flex justify-center gap-1.5 mt-2">
        {panels.map((_, i) => (
          <div key={i} className="w-1.5 h-1.5 rounded-full bg-slate-300" />
        ))}
      </div>
    </div>
  );
}