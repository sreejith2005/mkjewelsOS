import {useState} from "react";
import {humanizeReportValue,type ReportColumn} from "@jewelos/core";
import {Modal} from "@/components/ui";
import {StatusDot} from "@/features/analytics/components";
import {ChevronRight} from "lucide-react";
import type {ReportAnswer,ReportCell,ReportRow,ReportServerColumn} from "./api";

const IST_DATE_TIME=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",day:"numeric",month:"short",year:"numeric",hour:"numeric",minute:"2-digit"});
const DATE_ONLY=new Intl.DateTimeFormat("en-IN",{timeZone:"UTC",day:"numeric",month:"short",year:"numeric"});

/** Server question columns (one chosen form) as display columns. */
export function serverColumns(columns:readonly ReportServerColumn[]):ReportColumn[]{
  return columns.map((column)=>({key:column.key,label:column.label,...(column.phone?{format:"phone" as const}:column.instant?{format:"instant" as const}:{})}));
}

function minutes(value:number):string{if(value<=0)return "On time";const h=Math.floor(value/60),m=Math.round(value%60);if(h>=48)return `${Math.round(h/24)} days`;return h?`${h} h ${m} m`:`${m} m`;}
function tone(value:string):"success"|"warning"|"danger"|"neutral"{
  if(/^(completed|approved|on_time|won|present|done|running|available)$/.test(value))return "success";
  if(/^(overdue|rejected|failed|lost|cancelled|delayed|absent|blocked|do_not_contact|stopped|expired)$/.test(value))return "danger";
  if(/^(pending|in_progress|in_review|queued|processing|not_due|on_hold|submitted|open|due_today|half_day)$/.test(value))return "warning";
  return "neutral";
}

/** Text for one cell, following the column's format. Instants are shown in Asia/Kolkata. */
export function reportCellText(value:ReportCell|ReportAnswer[]|undefined,format:ReportColumn["format"]):string{
  if(value===null||value===undefined||value==="")return "—";
  if(Array.isArray(value))return value.map((answer)=>`${answer.label}: ${answer.value}`).join(" | ");
  if(typeof value==="boolean")return value?"Yes":"No";
  if(typeof value==="number"){
    if(format==="percent")return `${value.toLocaleString("en-IN",{maximumFractionDigits:1})}%`;
    if(format==="minutes")return minutes(value);
    if(format==="hours")return `${value.toLocaleString("en-IN",{maximumFractionDigits:1})} h`;
    return value.toLocaleString("en-IN",{maximumFractionDigits:1});
  }
  const text=String(value);
  if(format==="instant"||(!format&&/^\d{4}-\d{2}-\d{2}T/.test(text))){const date=new Date(text);if(!Number.isNaN(date.valueOf()))return IST_DATE_TIME.format(date);}
  if(format==="date"&&/^\d{4}-\d{2}-\d{2}$/.test(text))return DATE_ONLY.format(new Date(`${text}T00:00:00Z`));
  if(format==="status")return humanizeReportValue(text);
  return text;
}

function Cell({column,value}:{column:ReportColumn;value:ReportCell|ReportAnswer[]|undefined}){
  if(column.format==="status"&&typeof value==="string"&&value)return <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-task-muted px-2 py-0.5 text-xs font-medium"><StatusDot tone={tone(value)}/>{humanizeReportValue(value)}</span>;
  const text=reportCellText(value,column.format);
  if(column.format==="phone"&&typeof value==="string"&&value)return <a className="whitespace-nowrap text-task-text underline-offset-2 hover:underline" href={`tel:${value.replace(/\s+/g,"")}`}>{text}</a>;
  return <span title={text.length>60?text:undefined}>{text}</span>;
}

function rowKey(row:ReportRow,index:number):string{
  for(const key of ["submission_id","visit_id","instance_id","work_id","profile_id","client_id","record_id","activity_id","employee_key","stage_key","source","export_id"]){const value=row[key];if(typeof value==="string"||typeof value==="number")return `${key}:${value}:${index}`;}
  return String(index);
}

function answers(row:ReportRow):ReportAnswer[]|null{const value=row.answer_list;return Array.isArray(value)?value:null;}

/** Natural-height desktop table and phone rows; long answers open in a full view. */
export function ReportTable({columns,rows}:{columns:readonly ReportColumn[];rows:readonly ReportRow[]}){
  const [open,setOpen]=useState<{title:string;answers:ReportAnswer[]}|null>(null);
  const [record,setRecord]=useState<ReportRow|null>(null);
  const [lead,...rest]=columns;
  const viewAnswers=(row:ReportRow)=>{const list=answers(row);if(list)setOpen({title:String(row.form_name??"Form answers"),answers:list});};
  return <>
    <div className="-mx-4 hidden overflow-x-auto border-y border-task-border sm:-mx-6 sm:block"><table className="w-full min-w-[48rem] border-separate border-spacing-0 text-left text-sm">
      <thead className="text-xs uppercase tracking-wide text-task-text-muted"><tr>{columns.map((column)=><th className="whitespace-nowrap border-b border-task-border bg-task-muted px-3 py-2.5 font-semibold first:pl-4 sm:first:pl-6" key={column.key} scope="col">{column.label}</th>)}</tr></thead>
      <tbody>{rows.map((row,index)=><tr className="hover:bg-gold/5 even:bg-task-muted/30" key={rowKey(row,index)}>{columns.map((column)=><td className="max-w-80 truncate border-b border-task-border px-3 py-2 first:pl-4 sm:first:pl-6" key={column.key}>
        {column.key==="answers"&&answers(row)?.length?<button className="max-w-72 truncate text-left underline-offset-2 hover:underline" onClick={()=>viewAnswers(row)} type="button"><Cell column={column} value={row[column.key]}/></button>:<Cell column={column} value={row[column.key]}/>}
      </td>)}</tr>)}</tbody>
    </table></div>
    <ul className="-mx-4 divide-y divide-task-border border-y border-task-border sm:hidden">{rows.map((row,index)=><li key={rowKey(row,index)}><button className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-task-muted" onClick={()=>setRecord(row)} type="button">
      <span className="min-w-0 flex-1">{lead?<span className="block truncate text-[15px] font-semibold"><Cell column={lead} value={row[lead.key]}/></span>:null}
        <span className="mt-0.5 block truncate text-xs text-task-text-muted">{rest.slice(0,3).map((column)=>reportCellText(row[column.key],column.format)).filter((text)=>text!=="—").join(" · ")||"Open for details"}</span></span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-task-text-muted"/>
    </button></li>)}</ul>
    {record?<Modal mobileFullscreen onClose={()=>setRecord(null)} title={lead?reportCellText(record[lead.key],lead.format):"Record"} tone="light"><dl className="divide-y divide-task-border">{columns.map((column)=><div className="flex justify-between gap-3 py-2.5" key={column.key}><dt className="shrink-0 text-xs text-task-text-muted">{column.label}</dt><dd className="min-w-0 max-w-[65%] break-words text-right text-sm font-medium">{column.key==="answers"&&answers(record)?.length?<button className="text-left underline underline-offset-2" onClick={()=>{viewAnswers(record);setRecord(null);}} type="button">View all answers</button>:<Cell column={column} value={record[column.key]}/>}</dd></div>)}</dl></Modal>:null}
    {open?<Modal onClose={()=>setOpen(null)} title={open.title} tone="light"><dl className="flex flex-col gap-3 text-sm">{open.answers.map((answer,index)=><div className="border-b border-task-border pb-2 last:border-0" key={`${answer.label}:${index}`}><dt className="text-xs text-task-text-muted">{answer.label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words font-medium">{answer.value}</dd></div>)}</dl></Modal>:null}
  </>;
}
