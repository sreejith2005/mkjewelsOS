import {describe,expect,it} from "vitest";
import {classifyCrmVisitOutcome,crmPurchaseRate} from "./crmInsights";
describe("CRM truthful outcome measures",()=>{
  it("keeps overlapping service flags separate from exact outcome categories",()=>{
    expect(classifyCrmVisitOutcome("YES_AND_ORDER_PLACED")).toEqual({category:"Purchase and order",purchase:true,order:true,repair:false,known:true});
    expect(classifyCrmVisitOutcome(null).known).toBe(false);
    expect(classifyCrmVisitOutcome("SOMETHING_NEW").category).toBe("Unknown");
    expect(classifyCrmVisitOutcome("NO").purchase).toBe(false);
  });
  it("makes zero and missing denominators explicit",()=>{
    expect(crmPurchaseRate({purchased:0,eligible:0,unknown:3}).value).toBeNull();
    expect(crmPurchaseRate({purchased:2,eligible:4,unknown:1})).toEqual({value:50,numerator:2,denominator:4,unknown:1});
  });
});
