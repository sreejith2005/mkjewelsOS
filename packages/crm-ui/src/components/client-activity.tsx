import {useRef,useState,type FormEvent} from 'react';
import {useRouter} from '@/next-shim/navigation';
import {createClient} from '@/lib/supabase/client';
import type {Database,Json} from '@/lib/supabase/database.types';
export type ClientActivityRow=Database['public']['Views']['crm_client_activity']['Row'];
function answer(value:Json):string {return typeof value==='string' ? value : JSON.stringify(value);}
export function ClientActivity({clientId,activity,fieldLabels={},actorNames={},branchNames={},summary}:{clientId:string;activity:ClientActivityRow[];fieldLabels?:Record<string,string>;actorNames?:Record<string,string>;branchNames?:Record<string,string>;summary?:{first_recorded_at:string|null;latest_interaction_at:string|null}}) {
 const router=useRouter();const [saving,setSaving]=useState(false);const [message,setMessage]=useState('');
 const request=useRef<{key:string;fingerprint:string}|null>(null);
 async function save(event:FormEvent<HTMLFormElement>) {
  event.preventDefault();if(saving)return;
  const form=event.currentTarget;const fields=new FormData(form);setSaving(true);setMessage('');
  const fingerprint=JSON.stringify([fields.get('kind'),fields.get('channel'),String(fields.get('note')).trim()]);
  if(request.current?.fingerprint!==fingerprint)request.current={key:crypto.randomUUID(),fingerprint};
  try {
   const {error}=await createClient().rpc('record_crm_contact',{p_client:clientId,p_kind:String(fields.get('kind')),p_channel:String(fields.get('channel')),p_note:String(fields.get('note')),p_request:request.current.key});
   if(error)throw error;
   request.current=null;form.reset();setMessage('Contact recorded.');router.refresh();
  }catch{setMessage('Could not record contact. Check your branch access and try again.');}
  finally{setSaving(false);}
 }
 return <section className="mt-6 rounded border bg-white p-4">
  <h2 className="text-lg font-semibold">Complete contact history</h2>
  {summary?<p className="mt-2 text-sm text-stone-600">Latest interaction: {summary.latest_interaction_at?new Date(summary.latest_interaction_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'No contact recorded'} ? First recorded: {summary.first_recorded_at?new Date(summary.first_recorded_at).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'}):'Date not recorded'}</p>:null}
  <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-2">
   <label>Contact type<select aria-label="Contact type" name="kind" className="mt-1 w-full rounded border p-2">{['CALL','MESSAGE','THANK_YOU','NOTE'].map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>
   <label>Channel<select aria-label="Contact channel" name="channel" className="mt-1 w-full rounded border p-2">{['PHONE','WHATSAPP','INSTAGRAM','EMAIL','IN_PERSON','OTHER'].map(value=><option key={value} value={value}>{value.replaceAll('_',' ')}</option>)}</select></label>
   <label className="sm:col-span-2">Contact notes<textarea aria-label="Contact notes" name="note" required maxLength={4000} className="mt-1 w-full rounded border p-2"/></label>
   <p className="text-sm text-stone-600 sm:col-span-2">Record the contact and its outcome after it happens.</p>
   <button disabled={saving} className="rounded bg-amber-800 px-4 py-2 text-white">{saving?'Saving...':'Record contact'}</button>
   {message?<p role="status">{message}</p>:null}
  </form>
  <ol className="mt-5 space-y-3">{activity.map(item=><li key={item.activity_id} className="rounded border p-3">
   <p className="font-semibold">{item.kind?.replaceAll('_',' ')} {item.channel?`· ${item.channel}`:''}</p>
   <time className="text-sm text-stone-600">{item.occurred_at?new Date(item.occurred_at).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'Date not recorded'}</time>
   <p className="text-sm text-stone-600">{item.actor_id?(actorNames[item.actor_id] ?? 'Former staff member'):'Staff not recorded'}{item.branch_id?` ? ${branchNames[item.branch_id] ?? 'Former branch'}`:''}</p>
   {item.note?<p className="mt-1 whitespace-pre-wrap">{item.note}</p>:null}
   {item.details && typeof item.details==='object' && !Array.isArray(item.details)?<details className="mt-2"><summary>Saved details</summary><dl className="mt-2 grid gap-2 sm:grid-cols-2">{Object.entries(item.details).filter(([,value])=>value!==null && value!==undefined).map(([key,value])=><div key={key} className="min-w-0"><dt className="text-sm text-stone-600">{fieldLabels[key] ?? key.replaceAll('_',' ')}</dt><dd className="break-words whitespace-pre-wrap">{answer(value!)}</dd></div>)}</dl></details>:null}
  </li>)}</ol>
  {!activity.length?<p className="mt-4 text-stone-600">No recorded contacts yet.</p>:null}
 </section>;
}
