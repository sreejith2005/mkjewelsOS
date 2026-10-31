import { useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { Json } from '@/lib/supabase/database.types';

export type SavedWalkin = {
  timelineId: string;
  reference: string | null;
  form: Record<string, Json | undefined> | null;
  documents: Array<{ id: string; file_name: string; storage_path: string; mime_type: string | null; purpose: string | null }>;
};

function savedValue(value: Json | undefined): ReactNode {
  if (value === null || value === undefined || value === '') return 'NA';
  if (typeof value === 'boolean') return value ? 'YES' : 'NO';
  if (Array.isArray(value)) return value.length ? <ul>{value.map((item,index)=><li key={index}>{savedValue(item)}</li>)}</ul> : 'NA';
  if (typeof value === 'object') return <dl>{Object.entries(value).map(([key,item])=><div className="legacy-client-row" key={key}><dt>{key.replaceAll('_',' ').toUpperCase()}</dt><dd>{savedValue(item)}</dd></div>)}</dl>;
  return String(value);
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
  return <div className="my-3">
    <button type="button" className="underline" disabled={loading} onClick={()=>void open()}>{loading ? 'Opening…' : `${document.purpose?.replaceAll('_',' ') ?? 'Visit attachment'}: ${document.file_name}`}</button>
    {error ? <p role="alert">Could not open this saved file. Try again.</p> : null}
    {url ? <div>{document.mime_type?.startsWith('video/') ? <video className="max-w-full" controls src={url} /> : document.mime_type?.startsWith('image/') ? <img className="max-w-full" src={url} alt={document.purpose ?? document.file_name} /> : null}<a className="underline" href={url} target="_blank" rel="noreferrer">Open {document.file_name}</a></div> : null}
  </div>;
}

export function WalkinHistory({ visits }: { visits: SavedWalkin[] }) {
  return <section className="legacy-timeline-card"><h2>SAVED WALK-IN DETAILS & MEDIA</h2>
    {visits.length ? visits.map(visit=><details className="my-3" key={visit.timelineId} open={visits.length===1}>
      <summary>{visit.reference ?? 'Visit details'}</summary>
      {visit.form ? savedValue(visit.form) : <p>No saved walk-in form for this timeline entry.</p>}
      {visit.documents.map(document=><SavedMedia document={document} key={document.id} />)}
    </details>) : <p>No saved walk-in details.</p>}
  </section>;
}
