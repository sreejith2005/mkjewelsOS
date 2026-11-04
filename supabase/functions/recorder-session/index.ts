import { handleRecorder, type RecorderBoundaryConfig } from '../_shared/recorder/boundary.ts';
const config: RecorderBoundaryConfig = {
 url:Deno.env.get('SUPABASE_URL')??'',anonKey:Deno.env.get('SUPABASE_ANON_KEY')??'',serviceKey:'',ingestSecret:'',
 uploadUrl:Deno.env.get('RECORDER_UPLOAD_URL')??'',streamUrl:Deno.env.get('RECORDER_STREAM_URL')??'',
 allowedOrigins:(Deno.env.get('RECORDER_ALLOWED_ORIGINS')??'').split(',').map(x=>x.trim()).filter(Boolean),
};
Deno.serve(req=>handleRecorder(req,'session',config));
