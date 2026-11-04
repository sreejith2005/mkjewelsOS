import { handleRecorder, type RecorderBoundaryConfig } from '../_shared/recorder/boundary.ts';
const config: RecorderBoundaryConfig = {
 url:Deno.env.get('SUPABASE_URL')??'',anonKey:Deno.env.get('SUPABASE_ANON_KEY')??'',serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'',
 ingestSecret:Deno.env.get('RECORDER_INGEST_SECRET')??'',uploadUrl:'',streamUrl:'',allowedOrigins:[],
};
Deno.serve(req=>handleRecorder(req,'ingest',config));
