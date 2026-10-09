import {expect,it} from "vitest";
import {insightRecordPath} from "./InsightsRecords";
it("preserves selected submission and employee identities",()=>{expect(insightRecordPath({id:"submission",title:"Form",status:"submitted",module:"forms",due:null,completed:null})).toBe("/forms?submission_id=submission");expect(insightRecordPath({id:"employee",employee_id:"employee",title:"Employee",status:"available",module:"people",due:null,completed:null})).toBe("/availability?employee_id=employee");});
