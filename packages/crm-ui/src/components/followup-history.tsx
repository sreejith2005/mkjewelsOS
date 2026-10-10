import { useEffect,useState } from 'react';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/client';
import { assertCrmRead } from '@/crm-port/read-results';
const historySchema=z.object({total:z.number().int().nonnegative(),rows:z.array(z.object({id:z.string(),text:z.string()}))});
export function FollowupHistory({kind,id}:{kind:'not_bought'|'referral';id:string}){
 const [page,setPage]=useState(0),[retry,setRetry]=useState(0);
 const [result,setResult]=useState<z.infer<typeof historySchema>|null>(null),[error,setError]=useState(false),[loading,setLoading]=useState(true);
 useEffect(()=>{let active=true;setLoading(true);setError(false);
 void (async()=>{try{const response=assertCrmRead(await createClient().rpc('read_crm_followup_history',{p_kind:kind,p_id:id,p_offset:page*100,p_limit:100}));const data=historySchema.parse(response.data);if(active)setResult(data);}catch{if(active)setError(true);}finally{if(active)setLoading(false);}})();
 return()=>{active=false;};},[kind,id,page,retry]);
 return <div className="mt-2 max-w-56 text-xs" aria-live="polite">
 {loading?<p>Loading history…</p>:error?<p role="alert">Could not load history. <button type="button" onClick={()=>setRetry(x=>x+1)}>Retry</button></p>:<>
 <p className="whitespace-pre-wrap">{result?.rows.map(row=>row.text).filter(Boolean).join('\n')||'No logged history.'}</p>
 {page>0&&<button type="button" className="rounded border px-2 py-1" onClick={()=>setPage(x=>x-1)}>NEWER HISTORY</button>}
 {result&&(page+1)*100<result.total&&<button type="button" className="rounded border px-2 py-1" onClick={()=>setPage(x=>x+1)}>OLDER HISTORY</button>}
 </>}
 </div>;
}
