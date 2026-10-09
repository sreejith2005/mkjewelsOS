import {describe,expect,it,vi} from "vitest";
const rpc=vi.hoisted(()=>vi.fn());
vi.mock("@jewelos/api-client/client",()=>({getSupabase:()=>({rpc})}));
import {fetchManagementInsightRecords} from "./insightsApi";
describe("insight detail API",()=>{
 it("sends exact scoped selector and bounded pagination",async()=>{rpc.mockResolvedValue({data:{rows:[],total:0,offset:0,limit:25},error:null});expect(await fetchManagementInsightRecords({filter:{version:1,tab:"tasks",preset:"today",groupBy:"department"},metricKey:"overdue"})).toEqual({rows:[],total:0,offset:0,limit:25});expect(rpc.mock.calls[0]?.[1]).toMatchObject({p_metric:"overdue",p_limit:25,p_offset:0});});
 it("rejects malformed payloads and passes server denial",async()=>{rpc.mockResolvedValue({data:{rows:"bad"},error:null});await expect(fetchManagementInsightRecords({filter:{version:1,tab:"tasks",preset:"today",groupBy:"department"},metricKey:"overdue"})).rejects.toThrow();rpc.mockResolvedValue({data:null,error:new Error("denied")});await expect(fetchManagementInsightRecords({filter:{version:1,tab:"tasks",preset:"today",groupBy:"department"},metricKey:"overdue"})).rejects.toThrow("denied");});
});
