import { supabase } from "@jewelos/api-client";
import { CUSTOMER_DESTINATIONS,CUSTOMER_CONTACT_KINDS,CUSTOMER_CONTACT_CHANNELS, type CustomerFormMapping, type CustomerFieldMapping, type Json } from "@jewelos/core";

export type SavedCustomerMapping = { id: string; version: number; digest: string; mapping: CustomerFormMapping };
function object(value: unknown): Record<string, unknown> { return value!==null&&typeof value==="object"&&!Array.isArray(value) ? value as Record<string,unknown> : {}; }
function read(value: unknown): SavedCustomerMapping | null {
 if(value===null)return null;
 const row=object(value),descriptor=object(row.descriptor);
 const fields: CustomerFieldMapping[]=[];
 if(!Array.isArray(descriptor.fields)||typeof row.id!=="string"||typeof row.version!=="number"||typeof row.digest!=="string"||typeof descriptor.channel!=="string"||typeof descriptor.identityScope!=="string")throw new Error("Invalid saved customer mapping");
 for(const raw of descriptor.fields) {
  const item=object(raw);const destination=CUSTOMER_DESTINATIONS.find(value=>value===item.destination);
  if(typeof item.fieldKey!=="string"||!destination||!["operational","profile","history","both"].some(value=>value===item.mode))throw new Error("Invalid question mapping");
  const mode=item.mode;if(mode!=="operational"&&mode!=="profile"&&mode!=="history"&&mode!=="both")throw new Error("Invalid mapping mode");
  fields.push({fieldKey:item.fieldKey,mode,destination,...(Array.isArray(item.contactConfirmedValues)&&item.contactConfirmedValues.every((v):v is string=>typeof v==="string")?{contactConfirmedValues:item.contactConfirmedValues}:{}),contactKind:CUSTOMER_CONTACT_KINDS.find(v=>v===item.contactKind),contactChannel:CUSTOMER_CONTACT_CHANNELS.find(v=>v===item.contactChannel)});
 }
 return {id:row.id,version:row.version,digest:row.digest,mapping:{schemaVersion:1,enabled:descriptor.enabled===true,channel:descriptor.channel,identityScope:descriptor.identityScope,fields}};
}
export async function loadCustomerMapping(templateId: string): Promise<SavedCustomerMapping|null> {
 const {data,error}=await supabase.rpc("get_form_customer_mapping",{p_template_id:templateId});
 if(error)throw new Error(error.message);return read(data);
}
export async function saveCustomerMapping(templateId: string,mapping: CustomerFormMapping): Promise<SavedCustomerMapping> {
 const config:Json={schemaVersion:1,enabled:mapping.enabled,channel:mapping.channel,identityScope:mapping.identityScope,
  fields:mapping.fields.map(field=>({fieldKey:field.fieldKey,mode:field.mode,destination:field.destination,...(field.contactConfirmedValues?{contactConfirmedValues:[...field.contactConfirmedValues]}:{}),...(field.contactKind?{contactKind:field.contactKind}:{}),...(field.contactChannel?{contactChannel:field.contactChannel}:{})}))};
 const {data,error}=await supabase.rpc("save_form_customer_mapping",{p_template_id:templateId,p_config:config});
 if(error)throw new Error(error.message);const result=read(data);if(!result)throw new Error("Mapping was not saved");return result;
}
