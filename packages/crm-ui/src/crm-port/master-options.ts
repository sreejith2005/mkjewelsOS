import {z} from 'zod';
import {assertCrmRead} from './read-results';
const optionsSchema=z.record(z.string(),z.array(z.string()));
type MasterReader={rpc:(name:'get_crm_master_options')=>PromiseLike<{data:unknown;error?:unknown}>};
/** One reader for desktop and native's embedded CRM session. The database resolves
 * active access and the caller's tenant; neither the UI nor a URL supplies it. */
export async function loadCrmMasterOptions(db:MasterReader):Promise<Record<string,string[]>> {
 const {data}=assertCrmRead(await db.rpc('get_crm_master_options'));
 return optionsSchema.parse(data);
}
