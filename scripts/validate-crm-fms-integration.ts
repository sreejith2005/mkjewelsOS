/** Synthetic local two-database contract test. Never connects to a hosted project.
 * deno run --allow-run=docker --allow-read --allow-env=CRM_WORKTREE_DIRECTORY scripts/validate-crm-fms-integration.ts
 * Requires the schema-only crm_fms_final_20261028 schema-only validation databases.
 */
import {PERMISSION_CATALOG} from "../packages/core/src/permissions/catalog.ts";
import { handleCustomerSync,type CustomerDeliveryEvent } from "../supabase/functions/crm-customer-sync/worker.ts";
const crmDirectory=(Deno.env.get("CRM_WORKTREE_DIRECTORY")??"C:/crm").replaceAll("\\","/");
const {handleSyncReceive}=await import(`file:///${crmDirectory}/supabase-crm/supabase/functions/sync-receive/worker.ts`);
const sourceContainer="supabase_db_jewelos-fms-workspace",crmContainer="supabase_db_mkcrm";
const template="crm_fms_final_20261028",database=`crm_fms_e2e_${Date.now()}`;
if(!/^crm_fms_e2e_[0-9]+$/.test(database))throw new Error("Invalid local test database name");
const decoder=new TextDecoder();
function quote(value:string):string{return `'${value.replaceAll("'","''")}'`;}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("Expected object");return value as Record<string,unknown>;}
function string(value:unknown):string{if(typeof value!=="string")throw new Error("Expected string");return value;}
function check(condition:unknown,message:string):asserts condition{if(!condition)throw new Error(message);}
async function sql(container:string,db:string,query:string):Promise<string>{
 const child=new Deno.Command("docker",{args:["exec","-i",container,"psql","-U","supabase_admin","-d",db,"-v","ON_ERROR_STOP=1","-qAt"],stdin:"piped",stdout:"piped",stderr:"piped"}).spawn();
 const writer=child.stdin.getWriter();await writer.write(new TextEncoder().encode(query));await writer.close();const output=await child.output();
 const text=decoder.decode(output.stdout);if(!output.success||/^not ok /m.test(text))throw new Error(`Local contract failed (${container}/${db}): ${decoder.decode(output.stderr).slice(0,1200)} ${text.slice(-1500)}`);return text;
}
async function json(container:string,query:string,role?:{role:"authenticated"|"service_role";sub?:string}):Promise<unknown>{
 const setting=role?`begin;select set_config('request.jwt.claim.role',${quote(role.role)},true);${role.sub?`select set_config('request.jwt.claim.sub',${quote(role.sub)},true);`:""}set local role ${role.role};`:"";
 const result=await sql(container,database,`${setting}${query}${role?"commit;":""}`);
 return JSON.parse(result.trim().split(/\r?\n/).at(-1)??"null");
}
const created:string[]=[];
try{
 for(const container of [sourceContainer,crmContainer]){
  const count=await sql(container,template,container===sourceContainer?"select count(*) from public.tenants;":"select count(*) from public.clients;");
  check(count.trim()==="0","Refusing to clone a validation template containing business rows");
  await sql(container,"postgres",`create database ${database} template ${template};`);created.push(container);
 }
 console.log("Created two isolated local synthetic databases.");
 const permissionRows=PERMISSION_CATALOG.map((entry,index)=>`(${quote(entry.key)},${quote(entry.kind)},${entry.pageId?quote(entry.pageId):"null"},${quote(`{${entry.defaultRoles.join(",")}}`)}::public.user_role[],${1000+index})`);
 await sql(sourceContainer,database,`insert into public.permission_catalog(key,kind,page_id,default_roles,sort_order) values ${permissionRows.join(",")} on conflict(key) do nothing;`);
 const countryMigration=await Deno.readTextFile("supabase-crm/supabase/migrations/20261007001100_crm_phone_country_code.sql");
 const countrySeed=countryMigration.match(/INSERT INTO crm_private.phone_country_codes[\s\S]+?;/)?.[0];check(countrySeed,"Missing maintained country-code reference seed");
 await sql(crmContainer,database,countrySeed.replace(/;\s*$/, " on conflict(code) do nothing;"));
 let fixture=await Deno.readTextFile("supabase/tests/0350_customer_fms_workflow.test.sql");
 // This runner uses the real CRM receipt, rather than the standalone unit test's opaque acknowledgement.
 fixture=fixture.replace(/-- BEGIN standalone acknowledgement assertions[\s\S]*?-- END standalone acknowledgement assertions/,"")
  .replace(/-- Private export extension[\s\S]*?(?=select \* from finish\(\);)/,"")
  .replace("\\ir helpers/fms_visit_assignment_fixture.psql","\\ir /tmp/helpers/fms_visit_assignment_fixture.psql").replace("rollback;","commit;");
 await sql(sourceContainer,database,fixture);
 const people=await json(sourceContainer,"select jsonb_agg(jsonb_build_object('id',id,'auth',auth_user_id,'name',employee_name,'email',email,'tenant',tenant_id,'branch',branch_id) order by employee_name) from user_profiles;");
 check(Array.isArray(people)&&people.length===5,"Expected exactly five synthetic employees");
 const employees=people.map(object),first=employees[0]!,third=employees[2]!,fourth=employees[3]!;
 const tenant=string(first.tenant),branch=string(first.branch),adminAuth=string(first.auth);
 const metadata=object(await json(sourceContainer,"select jsonb_build_object('instance',i.id,'form',s.form_template_id,'demo',w.id) from fms_instances i join fms_instance_stages w on w.fms_instance_id=i.id join fms_stages s on s.id=w.fms_stage_id where s.stage_key='demo';"));
 const salesAnswers={next_employee:string(fourth.id),client_name:"Synthetic enquiry",budget:120000,requirement:"Synthetic revised necklace preference",contact_status:"not_connected"};
 await json(sourceContainer,`select submit_fms_form_and_progress_with_audit(${quote(string(metadata.form))}::uuid,${quote(JSON.stringify(salesAnswers))}::jsonb,'fms_stage',${quote(string(metadata.demo))}::uuid,gen_random_uuid());`,{role:"authenticated",sub:string(third.auth)});
 let setup=`begin;insert into public.branches(id,name,jewelos_branch_id) values(${quote(branch)},'Synthetic integration branch',${quote(branch)});`;
 for(const [index,person] of employees.entries()){
  setup+=`insert into public.users(id,name,email,role,branch_id,active) values(${quote(string(person.id))},${quote(string(person.name))},${quote(string(person.email))},'${index===0?"super_admin":"salesperson"}',${index===0?"null":quote(branch)},true);`;
  setup+=`insert into public.crm_sso_access_grants(jewelos_user_id,legacy_crm_user_id,crm_auth_user_id,work_email) values(${quote(string(person.id))},${quote(string(person.id))},${quote(string(person.id))},${quote(string(person.email))});`;
  setup+=`insert into crm_private.master_members(jewelos_user_id,tenant_id,snapshot_at,active) values(${quote(string(person.id))},${quote(tenant)},now(),true);`;
 }
 await sql(crmContainer,database,setup+"commit;");
 await json(crmContainer,`select to_jsonb(configure_customer_source(${quote(tenant)}::uuid,true));`,{role:"authenticated",sub:string(first.id)});
 await sql(sourceContainer,database,"insert into public.permission_catalog(key,kind,page_id,default_roles,sort_order) values('settings.manage_organization','action',null,'{super_admin,admin}',250) on conflict do nothing;");
 const service={role:"service_role" as const};let timeoutAfterCommit=false;
 const gateway={
  async claim(limit:number):Promise<CustomerDeliveryEvent[]>{
   const result=await json(sourceContainer,`select coalesce(jsonb_agg(to_jsonb(e)),'[]') from public.crm_sync_claim_customer_events(${limit}) e;`,service);check(Array.isArray(result),"Invalid claim response");
   return result.map(value=>{const event=object(value),payload=object(event.payload);return{id:string(event.id),lease_token:string(event.lease_token),mapping_id:string(event.mapping_id),mapping_digest:string(event.mapping_digest),descriptor:object(event.descriptor),payload:{...payload,eventId:string(payload.eventId)}};});
  },
  async finish(id:string,lease:string,result:Record<string,unknown>|null,error:string|null){
   const state=await json(sourceContainer,`select to_jsonb(public.crm_sync_finish_customer_event(${quote(id)}::uuid,${quote(lease)}::uuid,${result?quote(JSON.stringify(result))+"::jsonb":"null"},${error?quote(error):"null"}));`,service);
   check(state==="delivered"||state==="review"||state==="retry"||state==="dead"||state==="rejected","Invalid finish state");return state;
  }
 };
 const receiverGateway={
  applyStaff:()=>Promise.reject(new Error("Not used by customer integration test")),reconcileStaff:()=>Promise.resolve({}),
  async applyCustomer(id:string,payload:Record<string,unknown>){return object(await json(crmContainer,`select crm_apply_customer_event(${quote(id)},${quote(JSON.stringify(payload))}::jsonb);`,service));},
  async registerCustomerMapping(id:string,descriptor:Record<string,unknown>,digest:string){return object(await json(crmContainer,`select crm_register_customer_mapping(${quote(id)}::uuid,${quote(JSON.stringify(descriptor))}::jsonb,${quote(digest)});`,service));}
 };
 const receiver={async post(body:Record<string,unknown>){
  const ordered={...body,...(body.kind==="customer.events"&&Array.isArray(body.events)?{events:[...body.events].reverse()}: {})};
  const response=await handleSyncReceive(new Request("https://synthetic.invalid/receive",{method:"POST",headers:{"x-crm-sync-secret":"synthetic-only"},body:JSON.stringify(ordered)}),{secret:"synthetic-only",gateway:receiverGateway});
  const parsed=await response.json();if(timeoutAfterCommit&&body.kind==="customer.events"){timeoutAfterCommit=false;throw new Error("Synthetic timeout after receiver committed");}return{status:response.status,body:parsed};
 }};
 const deliver=()=>handleCustomerSync(new Request("https://synthetic.invalid/deliver",{method:"POST",headers:{"x-cron-secret":"synthetic-only"}}),{secret:"synthetic-only",gateway,receiver});
 check((await deliver()).status===200,"Initial delivery failed");
 check(await json(crmContainer,"select count(*) from public.clients;")===0,"Unapproved mappings must not create customers");
 const mapping=object(await json(sourceContainer,"select to_jsonb(m) from public.form_customer_mapping_versions m limit 1;"));
 await json(crmContainer,`select to_jsonb(approve_customer_mapping(${quote(string(mapping.id))}::uuid,${quote(string(mapping.digest))}));`,{role:"authenticated",sub:string(first.id)});
 const starter=object(await json(sourceContainer,"select payload from crm_sync.customer_events where source_type='form.submitted' order by created_at,id limit 1;"));
 await Promise.all([receiverGateway.applyCustomer(string(starter.eventId),starter),receiverGateway.applyCustomer(string(starter.eventId),starter)]);
 check(await json(crmContainer,"select count(*) from public.clients;")===1,"Concurrent first deliveries created duplicate identities");

 async function retryPending(){const ids=await json(sourceContainer,"select coalesce(jsonb_agg(id),'[]') from crm_sync.customer_events where delivered_at is null and rejected_at is null;");check(Array.isArray(ids),"Invalid pending IDs");if(ids.length)await json(sourceContainer,`select to_jsonb(retry_customer_events(array[${ids.map(id=>quote(string(id))+"::uuid").join(",")}]));`,{role:"authenticated",sub:adminAuth});return ids.length;}
 await retryPending();timeoutAfterCommit=true;await deliver();
 check(await json(crmContainer,"select count(*) from public.clients;")===1,"Receiver must create one identity despite reversed stage order");
 for(let pass=0;pass<3;pass++){if(!await retryPending())break;check((await deliver()).status===200,"Replay delivery failed");}
 const proof=object(await json(crmContainer,"select jsonb_build_object('clients',(select count(*) from public.clients),'events',(select count(*) from public.crm_customer_workflow_events),'contacts',(select count(*) from public.crm_contacts),'budget',(select value from crm_private.customer_attribute_projection where destination='budget'),'purchases',(select sum(total_purchase_visits) from public.clients),'operationalLeaks',(select count(*) from public.crm_customer_workflow_events e cross join lateral jsonb_array_elements(e.answers) a where a->>'fieldKey' in ('private_notes','next_employee')));"));
 const sourceProof=object(await json(sourceContainer,"select jsonb_build_object('events',(select count(*) from crm_sync.customer_events),'delivered',(select count(*) from crm_sync.customer_events where delivered_at is not null),'submissions',(select count(*) from public.form_submissions),'workflowLinks',(select count(*) from crm_sync.customer_workflow_links));"));
 check(proof.clients===1&&proof.events===sourceProof.events,"Source/receiver count reconciliation failed");
 check(sourceProof.delivered===sourceProof.events&&sourceProof.submissions===3&&sourceProof.workflowLinks===1,"Source durability/linkage assertion failed");
 check(proof.contacts===1&&proof.budget===120000&&proof.purchases===0&&proof.operationalLeaks===0,"Contact, projection, purchase or privacy regression");
 // Pending review racing another accepted source uses the same durable journey lock.
 const raceJourney=crypto.randomUUID(),raceId=`synthetic.review.${raceJourney}`,bindId=`synthetic.bind.${raceJourney}`;
 const family=string(await json(crmContainer,`insert into public.clients(primary_name,primary_phone,last_branch_id,lifecycle_stage) values('Synthetic race family','+919876543210',${quote(branch)},'lead') returning to_jsonb(client_id);`));
 const racePayload:Record<string,unknown>={...starter,eventId:raceId,journeyKey:raceJourney,workflow:{...object(starter.workflow),instanceId:raceJourney},isStartingForm:true};
 check((await receiverGateway.applyCustomer(raceId,racePayload)).reason==="ambiguous_phone","Expected pending shared-phone review");
 const raceAnswers=racePayload.answers;check(Array.isArray(raceAnswers),"Expected original source answers");
 const bindPayload={...racePayload,eventId:bindId,answers:raceAnswers.filter(value=>object(value).destination!=="primary_phone")};
 // Also remove other aliases so this independent synthetic bind creates its own customer.
 bindPayload.answers=bindPayload.answers.filter(value=>!["instagram","email","whatsapp","website_chat","external_reference"].includes(string(object(value).destination)));
 const raced=await Promise.allSettled([
  json(crmContainer,`select to_jsonb(review_customer_identity(${quote(raceId)},${quote(family)}::uuid,'Synthetic concurrent review'));`,{role:"authenticated",sub:string(first.id)}),
  receiverGateway.applyCustomer(bindId,bindPayload),
 ]);
 check(raced[1]!.status==="fulfilled","Concurrent independent source failed");
 await receiverGateway.applyCustomer(raceId,racePayload);
 const raceProof=object(await json(crmContainer,`select jsonb_build_object('wrongEvents',(select count(*) from public.crm_customer_workflow_events where event_id in(${quote(raceId)},${quote(bindId)}) and client_id=${quote(family)}::uuid),'wrongAliases',(select count(*) from crm_private.customer_source_identities where source_event_id=${quote(raceId)} and client_id=${quote(family)}::uuid),'journeys',(select count(*) from crm_private.customer_journeys where tenant_id=${quote(tenant)} and journey_key=${quote(raceJourney)}::uuid));`));
 check(raceProof.wrongEvents===0&&raceProof.wrongAliases===0&&raceProof.journeys===1,"Concurrent review split accepted journey identity");
 console.log(JSON.stringify({result:"passed",source:sourceProof,crm:proof,reviewRace:raceProof,scenarios:["starter retry","introduction call","sales handoff","sales follow-up","mapping approval","out-of-order events","timeout after commit","idempotent replay","operational answer exclusion","no fabricated purchase","concurrent first delivery","phone and Instagram identity","pending identity review versus first acceptance"]}));
} finally {
 // Only databases created by THIS invocation, under the validated fixed prefix.
 for(const container of created)await sql(container,"postgres",`drop database ${database};`);
}
