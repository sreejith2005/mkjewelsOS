import type { ReactNode } from 'react';

/** Native disclosure keeps filters available without occupying the results viewport. */
export function FilterPanel({ children, activeCount = 0, onClear }: { children: ReactNode; activeCount?: number; onClear?: () => void }) {
  return <details className="crm-filter-panel">
    <summary><span>Filters</span>{activeCount > 0 ? <span className="crm-filter-count">{activeCount} active</span> : null}<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" /></svg></summary>
    <div className="crm-filter-content">{children}{onClear ? <button type="button" className="crm-filter-clear" onClick={onClear}>Clear filters</button> : null}</div>
  </details>;
}
