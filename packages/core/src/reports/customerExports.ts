export const CUSTOMER_EXPORTS = {
  customer_master: "Master Customer Database",
  customer_enquiries: "Leads / Enquiries",
  customer_stages: "FMS Stage History",
  customer_answers: "Form Answers by Stage",
  customer_activity: "Customer Activity Timeline",
  customer_followups: "Follow-ups",
  customer_commercial: "Purchase / Repair History",
  customer_exceptions: "Synchronization Exceptions",
} as const;
export type CustomerExportKey = keyof typeof CUSTOMER_EXPORTS;
export type CustomerExportColumn = Readonly<{key:string;label:string;phone?:boolean;instant?:boolean}>;
export const CUSTOMER_EXPORT_COLUMNS: readonly CustomerExportColumn[] = [
  {key:"source_id",label:"Source record ID"},{key:"client_id",label:"CRM customer ID"},
  {key:"name",label:"Customer name"},{key:"phone",label:"Customer phone",phone:true},
  {key:"occurred_at",label:"Business time (Asia/Kolkata)",instant:true},
  {key:"branch_id",label:"Branch ID"},{key:"channel",label:"Channel"},
  {key:"workflow_id",label:"Workflow ID"},{key:"stage_id",label:"Stage visit ID"},
  {key:"actor_id",label:"Performed by ID"},{key:"assigned_to",label:"Assigned employees"},
  {key:"status",label:"Original outcome / status"},{key:"details",label:"Original evidence"},
];
export function customerExportValue(value:unknown,column:CustomerExportColumn):string {
  if(value===null||value===undefined)return "";
  if(column.instant&&typeof value==="string"){
    const date=new Date(value);
    if(Number.isNaN(date.valueOf()))throw new Error("Invalid export business instant");
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Kolkata",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(date);
    const part=(name:string)=>parts.find(item=>item.type===name)?.value??"";
    return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")} IST`;
  }
  const text=typeof value==="object"?JSON.stringify(value):String(value);
  return column.phone?`'${text}`:text;
}
