import { useState } from "react";
import { X, CheckCircle2, ChevronLeft } from "lucide-react";

/* Shared primitives. Everything visual that appears on more than one screen
   lives here so the design language stays in one place. */

export function Chip({ children, className = "" }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

export function Card({ children, className = "", onClick, ...rest }) {
  const base = "bg-white rounded-2xl border border-slate-100 shadow-sm";
  if (!onClick) return <div className={`${base} ${className}`} {...rest}>{children}</div>;
  return (
    <button
      onClick={onClick}
      className={`${base} w-full text-left transition-transform active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function SectionTitle({ children, action, onAction, className = "" }) {
  return (
    <div className={`flex items-center justify-between mb-3 ${className}`}>
      <h2 className="text-sm font-semibold text-slate-900 tracking-tight">{children}</h2>
      {action && (
        <button onClick={onAction} className="text-xs font-medium text-amber-700 hover:text-amber-900 focus-visible:underline">
          {action}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon = CheckCircle2, title, hint, cta, onCta }) {
  return (
    <div className="text-center py-10 px-6">
      <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
        <Icon className="w-6 h-6 text-slate-400" />
      </div>
      <p className="text-sm font-medium text-slate-800">{title}</p>
      {hint && <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">{hint}</p>}
      {cta && (
        <button onClick={onCta} className="mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-medium focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">
          {cta}
        </button>
      )}
    </div>
  );
}

export function Reveal({ children, delay = 0, className = "" }) {
  return (
    <div className={`animate-jos-up ${className}`} style={{ animationDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

export function Ring({ pct, size = 76 }) {
  const r = (size - 10) / 2;
  const c = 2 * Math.PI * r;
  const stroke = pct >= 80 ? "#10b981" : pct >= 40 ? "#f59e0b" : "#3b82f6";
  return (
    <svg width={size} height={size} role="img" aria-label={`${pct} percent of today's tasks done`}>
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth="7" fill="none" stroke="rgba(255,255,255,0.15)" />
      <circle
        cx={size / 2} cy={size / 2} r={r} strokeWidth="7" fill="none" stroke={stroke}
        strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-[stroke-dashoffset] duration-700 ease-out"
      />
      <text x="50%" y="50%" textAnchor="middle" dy="0.35em" fill="white" fontSize="18" fontWeight="700">
        {pct}%
      </text>
    </svg>
  );
}

export function Sheet({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-50 flex items-end">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/50" />
      <div className="relative w-full bg-white rounded-t-3xl max-h-full overflow-y-auto animate-jos-sheet" role="dialog" aria-modal="true">
        <div className="sticky top-0 bg-white px-5 pt-4 pb-3 border-b border-slate-100 flex items-center justify-between rounded-t-3xl">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center focus-visible:ring-2 focus-visible:ring-amber-500">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Toast({ msg }) {
  if (!msg) return null;
  return (
    <div className="absolute inset-x-0 bottom-24 z-50 flex justify-center px-6 pointer-events-none" role="status" aria-live="polite">
      <div className="bg-slate-900 text-white text-xs font-medium px-4 py-2.5 rounded-xl shadow-lg animate-jos-up flex items-center gap-2">
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
        {msg}
      </div>
    </div>
  );
}

export function Field({ label, required, children, hint }) {
  return (
    <div className="mb-4">
      <label className="block text-xs font-medium text-slate-700 mb-2">
        {label}
        {required && <span className="text-rose-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1.5">{hint}</p>}
    </div>
  );
}

export function Tabs({ value, onChange, items }) {
  return (
    <div className="bg-slate-100 rounded-xl p-1 flex gap-1" role="tablist">
      {items.map((it) => (
        <button
          key={it.id} role="tab" aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={`flex-1 py-2 rounded-lg text-xs font-medium focus-visible:ring-2 focus-visible:ring-amber-500 ${
            value === it.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function FilterRow({ value, onChange, options }) {
  return (
    <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1 -mx-6 px-6">
      {options.map(([id, label]) => (
        <button
          key={id} onClick={() => onChange(id)}
          className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium border capitalize focus-visible:ring-2 focus-visible:ring-amber-500 ${
            value === id ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function PageShell({ title, subtitle, children, back, backLabel }) {
  return (
    <div>
      <div className="bg-gradient-to-br from-slate-900 to-slate-800 px-6 pt-5 pb-9">
        {back && (
          <button onClick={back} className="flex items-center gap-1 text-slate-400 text-xs mb-3 focus-visible:underline">
            <ChevronLeft className="w-3.5 h-3.5" /> {backLabel}
          </button>
        )}
        <h1 className="text-xl font-bold text-white leading-tight">{title}</h1>
        {subtitle && <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{subtitle}</p>}
      </div>
      <div className="bg-slate-50 rounded-t-3xl -mt-4 px-6 pt-6 pb-8 min-h-[60vh]">{children}</div>
    </div>
  );
}

export function InfoRow({ icon: Icon, label }) {
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      <span className="text-xs text-slate-700 truncate">{label}</span>
    </div>
  );
}

export function MiniStat({ label, value }) {
  return (
    <div className="bg-white/10 rounded-xl px-3 py-2.5">
      <p className="text-xs text-slate-400 leading-none">{label}</p>
      <p className="text-sm font-semibold text-white mt-1.5 truncate capitalize">{value}</p>
    </div>
  );
}

export function HeroStat({ n, label, color }) {
  return (
    <div>
      <p className={`text-lg font-bold ${color} tabular-nums leading-none`}>{n}</p>
      <p className="text-xs text-slate-400 mt-1">{label}</p>
    </div>
  );
}

export const inputBase =
  "w-full px-3 py-2.5 rounded-xl border text-sm bg-white focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:border-transparent focus:outline-none";

export { useState };
