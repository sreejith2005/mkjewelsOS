import {describe,expect,it} from "vitest";
import {insightDestination} from "./dashboardModel";
describe("analytics destinations",()=>{it("preserves persisted work identities",()=>{expect(insightDestination({id:"t",title:"Task",status:"pending",module:"tasks",due:null,completed:null,task_id:"t"})).toEqual({kind:"task",taskId:"t"});expect(insightDestination({id:"s",title:"Stage",status:"pending",module:"workflows",due:null,completed:null,instance_id:"i",stage_id:"s"})).toEqual({kind:"fms",target:{kind:"stage",instanceId:"i",instanceStageId:"s"}});});});

it("keeps form submissions and employee records addressable",()=>{expect(insightDestination({id:"submission",title:"Form",status:"submitted",module:"forms",due:null,completed:null})).toEqual({kind:"submission",submissionId:"submission"});expect(insightDestination({id:"employee",employee_id:"employee",title:"Employee",status:"available",module:"people",due:null,completed:null})).toEqual({kind:"employee",employeeId:"employee"});});
