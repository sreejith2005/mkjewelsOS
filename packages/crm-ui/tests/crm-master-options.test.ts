import {expect,it,vi} from 'vitest';
import {loadCrmMasterOptions} from '@/crm-port/master-options';
it('loads Sugar and custom lead choices from the authorized master projection',async()=>{
 const rpc=vi.fn().mockResolvedValue({data:{lookup_sugar_options:['NO SUGAR'],type_of_calling:['FOLLOWUP']},error:null});
 expect(await loadCrmMasterOptions({rpc})).toEqual({lookup_sugar_options:['NO SUGAR'],type_of_calling:['FOLLOWUP']});
});
it('propagates master failures instead of falling back to hardcoded choices',async()=>{
 const error={code:'55000',message:'Master sync not ready'};
 await expect(loadCrmMasterOptions({rpc:async()=>({data:null,error})})).rejects.toBe(error);
});
