import { expect,it,vi } from 'vitest';
import ClientPage from '@/app/(crm)/clients/[clientId]/page';
const observed=vi.hoisted(()=>({ranges:[] as [string,number,number][],documentIds:[] as string[]}));
vi.mock('@/components/client-profile',()=>({ClientProfile:()=>null}));
vi.mock('@/lib/supabase/server',()=>({createClient:async()=>({
 auth:{getUser:async()=>({data:{user:null}})},
 rpc:async(name:string)=>({data:name==='get_crm_master_options'?{}:[{role:'salesperson'}],error:null}),
 from:(table:string)=>{
  const timeline=Array.from({length:201},(_,n)=>({id:`t${n}`,created_at:'2026-10-09',event_date:'2026-10-09',branch_id:null,salesperson_id:null,seen_categories:[],bought_categories:[],order_categories:[]}));
  let data:unknown=table==='clients'?{client_id:'c1',last_branch_id:null,last_salesperson_id:null}:table==='client_identity'?{household_id:null}:table==='client_timeline'?timeline:table==='crm_client_activity'?Array.from({length:202},(_,n)=>({activity_id:`a${n}`,branch_id:null})):table==='client_edit_log'?Array.from({length:303},(_,n)=>({id:n,edited_by:null})):[];
  const q={select:()=>q,eq:()=>q,neq:()=>q,order:()=>q,in:(_key:string,ids:string[])=>{if(table==='documents')observed.documentIds=ids;return q;},
   range:(from:number,to:number)=>{observed.ranges.push([table,from,to]);if(Array.isArray(data))data=data.slice(from,to+1);return q;},
   limit:(n:number)=>{if(Array.isArray(data))data=data.slice(0,n);return q;},single:()=>q,maybeSingle:()=>q,
   then:(resolve:(v:unknown)=>unknown)=>Promise.resolve({data,error:null}).then(resolve)};
  return q;
 }
})}));
it('bounds independently paged visits, activity and edits without dropping older evidence',async()=>{
 const result=await ClientPage({params:Promise.resolve({clientId:'c1'}),searchParams:Promise.resolve({visits_page:'2',activity_page:'2',audit_page:'3'})});
 expect(observed.ranges).toContainEqual(['client_timeline',100,200]);
 expect(observed.ranges).toContainEqual(['crm_client_activity',100,200]);
 expect(observed.ranges).toContainEqual(['client_edit_log',200,300]);
 expect(result.props.timeline).toHaveLength(100);expect(result.props.activity).toHaveLength(100);expect(result.props.audit).toHaveLength(100);
 expect(result.props.historyPaging).toMatchObject({visits:2,activity:2,audit:3,hasMoreVisits:true,hasMoreActivity:true,hasMoreAudit:true});
 expect(observed.documentIds).toHaveLength(101);
 expect(observed.documentIds).toContain('t0'); // Latest visit's salesperson still resolved on older pages.
});
