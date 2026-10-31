export type CustomerApplyResult = { outcome?: string; reason?: string | null; duplicate?: boolean; client_id?: string };
export type CustomerReceiveGateway = {
 exportCustomer?: (body:Record<string,unknown>)=>Promise<Record<string,unknown>>;
 applyCustomer?: (eventId: string, payload: Record<string, unknown>) => Promise<CustomerApplyResult>;
 registerCustomerMapping?: (id: string, descriptor: Record<string, unknown>, digest: string) => Promise<CustomerApplyResult>;
};
function object(value: unknown): value is Record<string, unknown> { return value!==null && typeof value==="object" && !Array.isArray(value); }
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const eventId=/^[A-Za-z0-9_.:-]{1,160}$/;
const json=(status:number,body:Record<string,unknown>)=>Response.json(body,{status,headers:{"Cache-Control":"no-store"}});

/** Called only AFTER the existing secret, method and total-body-size checks. */
export async function receiveCustomerBatch(body: Record<string,unknown>,gateway: CustomerReceiveGateway): Promise<Response> {
 if(body.kind==="customer.export") {
  if(![body.tenantId,body.actorId,body.exportId].every(value=>typeof value==="string"&&uuid.test(value))||typeof body.key!=="string"||!/^customer_(master|enquiries|stages|activity|followups|commercial|exceptions)$/.test(body.key)||!object(body.filters)||typeof body.before!=="string"||Number.isNaN(Date.parse(body.before))||!Number.isInteger(body.offset)||Number(body.offset)<0||!Number.isInteger(body.limit)||Number(body.limit)<1||Number(body.limit)>500)return json(400,{error:"Invalid customer export"});
  if(!gateway.exportCustomer)return json(503,{error:"Customer exports are not configured"});
  try{return json(200,await gateway.exportCustomer(body));}catch{return json(403,{error:"Customer export authorization or batch failed"});}
 }
 if(body.kind==="customer.mappings") {
  if(!gateway.registerCustomerMapping)return json(503,{error:"Customer mapping receiver is not configured"});
  if(!Array.isArray(body.mappings)||!body.mappings.length||body.mappings.length>10)return json(400,{error:"Invalid mapping batch"});
  const results=[];
  for(const item of body.mappings) {
   if(!object(item)||typeof item.mapping_id!=="string"||!uuid.test(item.mapping_id)||!object(item.descriptor)||typeof item.digest!=="string"||!/^[0-9a-f]{64}$/.test(item.digest))return json(400,{error:"Invalid mapping descriptor"});
  }
  for(const item of body.mappings) {
   // Shape was checked before applying any member; no partial invalid-envelope write.
   if(!object(item)||typeof item.mapping_id!=="string"||!object(item.descriptor)||typeof item.digest!=="string")continue;
   try {const result=await gateway.registerCustomerMapping(item.mapping_id,item.descriptor,item.digest);results.push({mapping_id:item.mapping_id,ok:true,...result});}
   catch {results.push({mapping_id:item.mapping_id,ok:false,error:"apply_failed"});}
  }
  return json(200,{results});
 }
 if(!gateway.applyCustomer)return json(503,{error:"Customer event receiver is not configured"});
 if(!Array.isArray(body.events)||!body.events.length||body.events.length>10)return json(400,{error:"Invalid customer batch"});
 for(const item of body.events) {
  if(!object(item)||typeof item.event_id!=="string"||!eventId.test(item.event_id)||!object(item.payload)||item.payload.eventId!==item.event_id)return json(400,{error:"Invalid customer event"});
 }
 const results=[];
 for(const item of body.events) {
  if(!object(item)||typeof item.event_id!=="string"||!object(item.payload))continue;
  try {const result=await gateway.applyCustomer(item.event_id,item.payload);results.push({event_id:item.event_id,ok:true,...result});}
  catch {results.push({event_id:item.event_id,ok:false,error:"apply_failed"});}
 }
 return json(200,{results});
}
