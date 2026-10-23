import type { Json } from '@/lib/supabase/database.types';
import { HistoryValue, RecentHistory, historyDate, historyLabel } from '@/components/profile-history-display';

export type ProfileEdit = {id:number;field_name:string;old_value:Json|null;new_value:Json|null;created_at:string;editor:string|null;edited_by?:string|null};

export function ProfileEditLog({ edits }: {edits:ProfileEdit[]}) {
 const groups = new Map<string,ProfileEdit[]>();
 for (const edit of edits) {
  // The log has no transaction ID. Never merge different timestamps or actor IDs.
  const key = JSON.stringify([edit.created_at,edit.edited_by ?? edit.editor]);
  const group = groups.get(key);
  if (group) group.push(edit); else groups.set(key,[edit]);
 }
 return <section className="legacy-audit-card crm-history-section">
  <h2>PROFILE EDIT LOG</h2>
  <p className="crm-history-intro">See what changed, who updated it and when. Open an entry to compare values.</p>
  {groups.size ? <RecentHistory key={edits[0]?.id} noun="updates">{Array.from(groups.values(), group => <details className="crm-history-entry" data-testid="profile-edit-entry" key={group[0].id}>
   <summary><span className="crm-history-summary"><strong>{group.length === 1 ? historyLabel(group[0].field_name) : `${group.length} fields changed`}</strong><span className="crm-history-meta">{group[0].editor ?? 'System'} · {historyDate(group[0].created_at, true)}</span><span className="crm-history-preview">{group.length > 1 ? group.map(edit=>historyLabel(edit.field_name)).join(', ') : 'Compare before and after'}</span></span></summary>
   <div className="crm-history-body">{group.map(edit => <article className="crm-history-change" key={edit.id}>
    <h3>{historyLabel(edit.field_name)}</h3>
    <div className="crm-history-comparison"><div><h4>Before</h4><div className="crm-history-answer"><HistoryValue value={edit.old_value}/></div></div><div><h4>After</h4><div className="crm-history-answer"><HistoryValue value={edit.new_value}/></div></div></div>
   </article>)}</div>
  </details>)}</RecentHistory> : <p>No profile edits yet.</p>}
 </section>;
}
