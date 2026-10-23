import { useState, type ReactNode } from 'react';
import type { Json } from '@/lib/supabase/database.types';

const labels: Record<string, string> = {
 dob: 'Date of birth', crm_name: 'CRM', pincode: 'Pincode', id: 'Record ID',
 client_timeline_id: 'Visit ID', additional_fields: 'Additional saved answers',
 submitted_fields: 'Original submitted answers', engagement_answers: 'Engagement answers',
 category_details: 'Product details', did_buy: 'Purchased', bridal_or_non_bridal: 'Bridal / non-bridal',
};
export function historyLabel(key: string) {
 return labels[key] ?? key.replaceAll('_', ' ').replace(/^./, letter => letter.toUpperCase());
}
export function historyDate(value: string | null | undefined, includeSeconds = false) {
 if (!value) return 'Date not recorded';
 const date = new Date(value);
 if (Number.isNaN(date.getTime())) return value;
 return new Intl.DateTimeFormat('en-IN', {timeZone:'Asia/Kolkata', dateStyle:'medium', ...(value.includes('T') ? {timeStyle:includeSeconds ? 'medium' as const : 'short' as const} : {})}).format(date);
}

/** Render arbitrary saved answers without lossy JSON/string coercion. */
export function HistoryValue({ value }: {value: Json | undefined}) {
 if (value === null || value === undefined || value === '') return <span className="crm-history-muted">Not recorded</span>;
 if (typeof value === 'boolean') return <>{value ? 'Yes' : 'No'}</>;
 if (Array.isArray(value)) return value.length ? <ul className="crm-history-values">{value.map((item,index) => <li key={index}><HistoryValue value={item}/></li>)}</ul> : <span className="crm-history-muted">None recorded</span>;
 if (typeof value === 'object') return Object.keys(value).length ? <HistoryFields fields={value}/> : <span className="crm-history-muted">None recorded</span>;
 return <>{String(value)}</>;
}
export function HistoryFields({ fields, fieldLabels = {} }: {fields: Record<string, Json | undefined>; fieldLabels?:Record<string,string>}) {
 return <dl className="crm-history-fields">{Object.entries(fields).map(([key,value]) => <div className="crm-history-field" key={key}>
  <dt>{fieldLabels[key] ?? historyLabel(key)}</dt>
  <dd>{value && typeof value === 'object' && !Array.isArray(value) ? <details className="crm-history-nested"><summary>View {fieldLabels[key] ?? historyLabel(key)}</summary><HistoryValue value={value}/></details> : <HistoryValue value={value}/>}</dd>
 </div>)}</dl>;
}

/** Reset this component's key when the client or server page changes. */
export function RecentHistory({ children, noun }: {children: ReactNode[]; noun: string}) {
 const [visible,setVisible] = useState(5);
 return <>
  <div className="crm-history-list">{children.slice(0,visible)}</div>
  {children.length > 5 ? <div className="crm-history-pagination">
   <span role="status">Showing {Math.min(visible,children.length)} of {children.length} {noun} on this page</span>
   {visible < children.length ? <button type="button" onClick={() => setVisible(count => count+5)}>Show more</button> : null}
   {visible > 5 ? <button type="button" onClick={() => setVisible(5)}>Show less</button> : null}
  </div> : null}
 </>;
}
