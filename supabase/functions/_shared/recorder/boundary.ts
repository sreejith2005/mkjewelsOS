export interface RecorderBoundaryConfig {
 url: string; anonKey: string; serviceKey: string; ingestSecret: string;
 uploadUrl: string; streamUrl: string; allowedOrigins: string[];
}
const actions = new Set(['redeem','check_chunk','chunk','commit','event','alert','heartbeat','claim_job','finish_job','health','reconcile']);
// Store Intelligence analysis (migration 0379): routed to recording_analysis_ingest.
const analysisActions = new Set(['transcript_finalize','analysis_claim','analysis_submit','analysis_fail','analysis_reconcile','analysis_health']);
// Only these two carry a whole transcript or analysis; everything else keeps the small limit.
const largeBodyActions = new Set(['transcript_finalize','analysis_submit']);
const SMALL_BODY = 40000;
const LARGE_BODY = 4 * 1024 * 1024;
const json = (body: unknown, status = 200, headers: Record<string,string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type':'application/json','cache-control':'no-store',...headers } });
export async function secretEquals(a: string, b: string): Promise<boolean> {
 if (!a || !b) return false;
 const digest = async (s:string) => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
 const [x,y] = await Promise.all([digest(a),digest(b)]); let d=0; for(let i=0;i<x.length;i++) d|=x[i]!^y[i]!; return d===0;
}
async function readBody(req:Request,limit:number):Promise<Record<string,unknown>|null> {
 const reader=req.body?.getReader(); if(!reader) return null;
 const chunks:Uint8Array[]=[]; let size=0;
 while(true) { const r=await reader.read(); if(r.done) break; size+=r.value.byteLength; if(size>limit){await reader.cancel();return null;} chunks.push(r.value); }
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 try {const v:unknown=JSON.parse(new TextDecoder().decode(bytes));return v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;}catch{return null;}
}
export async function handleRecorder(req:Request,kind:'session'|'ingest',c:RecorderBoundaryConfig,fetcher:typeof fetch=fetch):Promise<Response> {
 const origin=req.headers.get('origin');const cors:Record<string,string>={};
 if(kind==='session'&&origin){if(!c.allowedOrigins.includes(origin)) return json({error:'origin_denied'},403);cors['access-control-allow-origin']=origin;cors['vary']='Origin';}
 if(req.method==='OPTIONS'&&kind==='session') return new Response(null,{status:204,headers:{...cors,'access-control-allow-methods':'POST','access-control-allow-headers':'authorization,apikey,content-type,x-client-info'}});
 if(req.method!=='POST') return json({error:'method_not_allowed'},405,cors);
 if(!c.url||!c.anonKey||(kind==='ingest'&&!c.serviceKey)) return json({error:'recorder_not_configured'},503,cors);
 const bearer=req.headers.get('authorization')??'';
 if(kind==='ingest') {if(!await secretEquals(req.headers.get('x-recorder-secret')??'',c.ingestSecret)) return json({error:'unauthorized'},401);}
 else if(!/^Bearer [^\s]+$/.test(bearer)) return json({error:'unauthorized'},401,cors);
 // The ingest secret was verified above, so only the boundary may send a large body.
 const requested=kind==='ingest'?new URL(req.url).searchParams.get('action'):null;
 const body=await readBody(req,kind==='ingest'&&requested!==null&&largeBodyActions.has(requested)?LARGE_BODY:SMALL_BODY);if(!body) return json({error:'invalid_body'},400,cors);
 let rpc:string;let args:Record<string,unknown>;
 if(kind==='session') {
  if(body.action!=='start'&&body.action!=='ticket') return json({error:'invalid_action'},400,cors);
  try {const u=new URL(c.uploadUrl);const w=new URL(c.streamUrl);if(u.protocol!=='https:'||w.protocol!=='wss:'||u.username||u.password||u.search||u.hash||u.pathname!=='/'||w.username||w.password||w.search||w.hash||w.pathname!=='/') throw new Error();}catch{return json({error:'recorder_not_configured'},503,cors);}
  rpc='recorder_issue_ticket';args={p_device_id:body.device_id,p_request_id:body.action==='start'?body.request_id:null,p_session_id:body.action==='ticket'?body.session_id:null,p_consent:body.action==='start'&&body.consent===true,p_consent_version:body.consent_version??null};
 }else{
  if(typeof body.action!=='string'||!(actions.has(body.action)||analysisActions.has(body.action))||!body.payload||typeof body.payload!=='object'||Array.isArray(body.payload)) return json({error:'invalid_action'},400);
  if(requested!==null&&requested!==body.action) return json({error:'invalid_action'},400);
  rpc=analysisActions.has(body.action)?'recording_analysis_ingest':'recorder_ingest';args={p_action:body.action,p_payload:body.payload};
 }
 try {
  const key=kind==='session'?c.anonKey:c.serviceKey;
  const response=await fetcher(`${c.url}/rest/v1/rpc/${rpc}`,{method:'POST',headers:{apikey:key,authorization:kind==='session'?bearer:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
  if(!response.ok){const status=response.status===401||response.status===403?403:response.status===409?409:400;return json({error:'recorder_request_denied'},status,cors);}
  const data:unknown=await response.json();if(!data||typeof data!=='object'||Array.isArray(data)) return json({error:'recorder_boundary_failed'},502,cors);
  return json(kind==='session'?{...data,upload_url:c.uploadUrl,stream_url:c.streamUrl}:data,200,cors);
 }catch{return json({error:'recorder_boundary_unavailable'},503,cors);}
}
