import { describe,it,expect,vi } from 'vitest';
import { readAllCrmRows } from '@/crm-port/read-all-rows';
describe('complete persisted history reads',()=>{
  it('reads beyond the server page size without losing older visits',async()=>{
    const page=vi.fn().mockResolvedValueOnce({data:Array.from({length:500},(_,id)=>({id})),error:null}).mockResolvedValueOnce({data:[{id:500}],error:null});
    const result=await readAllCrmRows<{id:number}>(page);
    expect(result.data).toHaveLength(501);
    expect(page.mock.calls).toEqual([[0,499],[500,999]]);
  });
  it('fails the complete read if a later page fails',async()=>{
    const failure={code:'offline'};
    const page=vi.fn().mockResolvedValueOnce({data:Array(500).fill(1),error:null}).mockResolvedValueOnce({data:null,error:failure});
    await expect(readAllCrmRows<number>(page)).rejects.toBe(failure);
  });
});
