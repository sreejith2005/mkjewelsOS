import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Json } from '@/lib/supabase/database.types';
import { HistoryFields, RecentHistory, historyDate, historyLabel } from '@/components/profile-history-display';

export type SavedWalkin = {
  timelineId: string;
  reference: string | null;
  date?: string | null;
  outcome?: string | null;
  form: Record<string, Json | undefined> | null;
  documents: Array<{ id: string; file_name: string; storage_path: string; mime_type: string | null; purpose: string | null }>;
};

function answerGroup(key: string): string {
 if (/^(primary_|secondary_|billing_|other_known_|name$|gender$|dob$|anniversary$|country$|state$|city|pincode$|address$|community|reference_|companions$|client_type$)/.test(key)) return 'Personal & contact';
 if (/^(occupation|bridal_|wedding_|communication_|beverage|sugar|snack|gift)/.test(key)) return 'Preferences & planning';
 if (/^(category_|did_buy$|not_bought|repair_or_order|product_|seen_|bought_|order_|buy_status$|remark$|event_|source_of_lead)/.test(key)) return 'Products & visit';
 if (/^(instagram_|google_review_|testimonial_|referrals_|feedback_|thank_you_|marketing_|next_visit|engagement_)/.test(key)) return 'Follow-up';
 return 'Other saved details';
}
function SavedAnswers({form}:{form:Record<string,Json|undefined>}) {
 const groups = new Map<string,Record<string,Json|undefined>>();
 const fieldLabels: Record<string,string> = {};
 const original: Array<{key:string;value:Record<string,Json|undefined>}> = [];
 function collect(fields:Record<string,Json|undefined>,path:string[]=[]) {
 for (const [key,value] of Object.entries(fields)) {
  const answerPath=[...path,key];
  const identity=JSON.stringify(answerPath);
  if ((key==='additional_fields' || key==='submitted_fields') && value && typeof value==='object' && !Array.isArray(value)) {
   if (key==='submitted_fields') original.push({key:identity,value});
   else collect(value,answerPath);
   continue;
  }
  const name=answerGroup(key);
  const group=groups.get(name) ?? {};
  group[identity]=value;
  fieldLabels[identity]=[historyLabel(key),...path.map(historyLabel)].join(' · ');
  groups.set(name,group);
 }
 }
 collect(form);
 return <div className="crm-walkin-groups">{['Personal & contact','Preferences & planning','Products & visit','Follow-up','Other saved details'].filter(name=>groups.has(name)).map(name=><details className="crm-history-group" key={name}>
  <summary>{name}</summary><HistoryFields fields={groups.get(name)!} fieldLabels={fieldLabels}/>
 </details>)}{original.map(source=><details className="crm-history-group" key={source.key}><summary>Original submitted answers</summary><SavedAnswers form={source.value}/></details>)}</div>;
}

function SavedMedia({ document }: { document: SavedWalkin['documents'][number] }) {
  const [url,setUrl] = useState<string | null>(null);
  const [error,setError] = useState(false);
  const [loading,setLoading] = useState(false);
  async function open() {
    setLoading(true); setError(false);
    try {
      const result = await createClient().storage.from('crm-documents').createSignedUrl(document.storage_path,300);
      if (result.error || !result.data?.signedUrl) { setError(true); return; }
      setUrl(result.data.signedUrl);
    } catch { setError(true); } finally { setLoading(false); }
  }
  return <div className="crm-history-media">
    <button type="button" className="underline" disabled={loading} onClick={()=>void open()}>{loading ? 'Opening…' : `${document.purpose?.replaceAll('_',' ') ?? 'Visit attachment'}: ${document.file_name}`}</button>
    {error ? <p role="alert">Could not open this saved file. Try again.</p> : null}
    {url ? <div>{document.mime_type?.startsWith('video/') ? <video className="max-w-full" controls src={url} /> : document.mime_type?.startsWith('image/') ? <img className="max-w-full" src={url} alt={document.purpose ?? document.file_name} /> : null}<a className="underline" href={url} target="_blank" rel="noreferrer">Open {document.file_name}</a></div> : null}
  </div>;
}

export function WalkinHistory({ visits }: { visits: SavedWalkin[] }) {
  return <section className="legacy-timeline-card crm-history-section"><h2>SAVED WALK-IN DETAILS & MEDIA</h2>
    <p className="crm-history-intro">Open a visit to browse grouped answers and its saved photos, videos and files.</p>
    {visits.length ? <RecentHistory key={visits[0]?.timelineId} noun="visits">{visits.map(visit=><details className="crm-history-entry" data-testid="walkin-history-entry" key={visit.timelineId}>
      <summary><span className="crm-history-summary"><strong>{visit.reference ?? 'Visit details'}</strong><span className="crm-history-meta">{historyDate(visit.date)}{visit.outcome ? ` · ${visit.outcome.replaceAll('_',' ')}` : ''} · {visit.documents.length} {visit.documents.length===1?'attachment':'attachments'}</span></span></summary>
      <div className="crm-history-body">{visit.form ? <SavedAnswers form={visit.form}/> : <p>No saved walk-in form for this timeline entry.</p>}
      <section className="crm-history-media-section"><h3>Media</h3>{visit.documents.length ? visit.documents.map(document=><SavedMedia document={document} key={document.id} />) : <p className="crm-history-muted">No saved media for this visit.</p>}</section></div>
    </details>)}</RecentHistory> : <p>No saved walk-in details.</p>}
  </section>;
}
