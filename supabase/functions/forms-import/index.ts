import {createClient} from '@supabase/supabase-js';
import {handleFormsImport,readFormsImportBody} from './handler.ts';
import {formsImportModel} from './model.ts';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, accept, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
Deno.serve(async(request:Request)=>{
  const respond=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
  if(request.method==='OPTIONS')return new Response('ok',{headers});
  if(request.method!=='POST')return respond(405,{schemaVersion:1,code:'invalid_request',error:'Method not allowed'});
  const url=Deno.env.get('SUPABASE_URL'),anon=Deno.env.get('SUPABASE_ANON_KEY'),key=Deno.env.get('ANTHROPIC_API_KEY');
  if(!url||!anon)return respond(503,{schemaVersion:1,code:'unavailable',error:'AI form import is not configured.'});
  const token=request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]??null;
  let body:string;try{body=await readFormsImportBody(request);}catch{return respond(413,{schemaVersion:1,code:'too_large',error:'The import is too large.'});}
  const caller=(jwt:string)=>createClient(url,anon,{auth:{autoRefreshToken:false,persistSession:false},global:{headers:{Authorization:`Bearer ${jwt}`}}});
  const result=await handleFormsImport(token,body,{
    disabled:Deno.env.get('FORMS_IMPORT_DISABLED')==='true',model:key?formsImportModel(key,Deno.env.get('FORMS_IMPORT_MODEL')?.trim()||'claude-opus-5-5'):null,
    authenticate:async(jwt)=>{const {data,error}=await caller(jwt).auth.getUser(jwt);return data.user&&!error?'ok':error&&(!error.status||error.status>=500)?'unavailable':'invalid';},
    rpc:async(jwt,name,args)=>{const {data,error}=await caller(jwt).rpc(name,args);return {data,error:error?{code:error.code,message:error.message}:null};},
    log:(event)=>console.log(JSON.stringify(event)),
  });
  return respond(result.status,result.body);
});
