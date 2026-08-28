import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Download, Upload } from "lucide-react";
import { kolkataDateKey, type TaskImportDraftRow } from "@jewelos/core";
import { Button, Notice } from "@/components/ui";
import {
  beginCurrentSheetTaskImport, commitCurrentSheetTaskImportChunk, loadTaskImportBatches,
  loadTaskImportIdentityCandidates, submitTaskBulkImport, validateTaskBulkImport,
  type TaskImportBatch, type TaskImportIdentityCandidate, type TaskImportValidation,
} from "@/features/tasks/import/api";
import { runTaskImportChunks } from "@/features/tasks/import/chunkRunner";
import { createCorrectionReportCsv } from "@/features/tasks/import/correctionReport";
import { applyIdentityMappings } from "@/features/tasks/import/identityMappings";
import { ImportReadinessSummary } from "@/features/tasks/import/ImportReadinessSummary";
import { taskImportOutcomeMessage } from "@/features/tasks/import/outcomeMessage";
import { createTaskImportTemplate, hashTaskImportPayload, parseTaskImportFile, type TaskBulkImportIssue, type TaskBulkImportPayload } from "@/features/tasks/import/workbook";

function downloadBlob(contents: BlobPart, name: string, type: string) { const url=URL.createObjectURL(new Blob([contents],{type})); const anchor=document.createElement("a"); anchor.href=url; anchor.download=name; anchor.click(); URL.revokeObjectURL(url); }
async function hashRows(rows: readonly unknown[]) { const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify(rows))); return [...new Uint8Array(digest)].map((item)=>item.toString(16).padStart(2,"0")).join(""); }
function navigate(path: string) { window.history.pushState({},"",path); window.dispatchEvent(new PopStateEvent("popstate")); }

export function TaskBulkImportPage({ onBack }: { onBack: () => void }) {
  const [payload,setPayload]=useState<TaskBulkImportPayload|null>(null);
  const [sourceFile,setSourceFile]=useState<File|null>(null);
  const [draftRows,setDraftRows]=useState<readonly TaskImportDraftRow[]>([]);
  const [candidates,setCandidates]=useState<TaskImportIdentityCandidate[]>([]);
  const [issues,setIssues]=useState<readonly TaskBulkImportIssue[]>([]);
  const [fileLabel,setFileLabel]=useState("");
  const [startDate,setStartDate]=useState(()=>kolkataDateKey(new Date()));
  const [error,setError]=useState<string|null>(null);
  const [validation,setValidation]=useState<TaskImportValidation|null>(null);
  const [history,setHistory]=useState<TaskImportBatch[]>([]);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState(0);
  const [result,setResult]=useState<{tone:"success"|"danger";text:string}|null>(null);
  const refreshHistory=useCallback(async()=>{try{setHistory(await loadTaskImportBatches());}catch(caught){setError(caught instanceof Error?caught.message:"Unable to load import history");}},[]);
  useEffect(()=>{void refreshHistory();void loadTaskImportIdentityCandidates().then(setCandidates).catch(()=>setCandidates([]));},[refreshHistory]);

  const mapped=useMemo(()=>applyIdentityMappings(draftRows,candidates),[draftRows,candidates]);
  const readyRows=issues.length===0?mapped.rows:[];
  const assigned=mapped.rows.filter((row)=>row.assignment_status==="assigned").length;
  const assigningLeft=mapped.rows.length-assigned;
  const recurring=mapped.rows.filter((row)=>row.destination==="recurring_todo").length;
  const issueGroups=useMemo(()=>{
    const groups=new Map<string,{field:string;reason:string;guidance:string;rows:number[]}>();
    for(const item of issues){const key=`${item.field}\u0000${item.reason}\u0000${item.guidance}`;const current=groups.get(key);if(current)current.rows.push(item.row);else groups.set(key,{field:item.field,reason:item.reason,guidance:item.guidance,rows:[item.row]});}
    return [...groups.values()];
  },[issues]);

  const download=()=>{const bytes=XLSX.write(createTaskImportTemplate(),{bookType:"xlsx",type:"array"});downloadBlob(bytes,"mk-jewels-task-bulk-import.xlsx","application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");};
  const parseSelectedFile=useCallback(async(file:File,selectedStartDate:string)=>{setBusy(true);setError(null);setResult(null);setValidation(null);setPayload(null);setDraftRows([]);setProgress(0);try{const parsed=await parseTaskImportFile(file,{defaultStartsOn:selectedStartDate});setFileLabel(file.name.replace(/[^A-Za-z0-9._ -]/g,"_"));setIssues(parsed.issues);if(parsed.sourceFormat==="mk_daily_checklist_csv")setDraftRows(parsed.draftRows);else if(parsed.payload)setPayload(parsed.payload);else setError(parsed.errors.join(" "));}catch(caught){setError(caught instanceof Error?caught.message:"Unable to read file");}finally{setBusy(false);}},[]);
  const upload=async(file?:File)=>{if(!file)return;setSourceFile(file);await parseSelectedFile(file,startDate);};
  const changeStartDate=async(nextDate:string)=>{setStartDate(nextDate);if(sourceFile&&nextDate)await parseSelectedFile(sourceFile,nextDate);};
  const validateCanonical=async()=>{if(!payload)return;setBusy(true);setError(null);try{setValidation(await validateTaskBulkImport(payload,await hashTaskImportPayload(payload)));}catch(caught){setError(caught instanceof Error?caught.message:"Validation failed");}finally{setBusy(false);}};
  const importCanonical=async()=>{if(!payload||!validation?.valid)return;setBusy(true);setError(null);try{const outcome=await submitTaskBulkImport(payload,validation.canonical_hash,fileLabel||"task-import.xlsx");setResult({tone:"success",text:`${outcome.created_count} tasks imported.`});setPayload(null);setValidation(null);await refreshHistory();}catch(caught){setError(caught instanceof Error?caught.message:"Import failed");}finally{setBusy(false);}};
  const importCurrentSheet=async()=>{if(!readyRows.length)return;setBusy(true);setError(null);setResult(null);try{const started=await beginCurrentSheetTaskImport(await hashRows(readyRows),fileLabel||"task-import.csv",readyRows.length);if(started.replayed&&started.outcome!=="in_progress"&&started.outcome!=="partial"){setResult({tone:"success",text:"This file was already imported. No duplicate tasks were created."});return;}const outcome=await runTaskImportChunks(started.batch_id,readyRows,(batch,rows)=>commitCurrentSheetTaskImportChunk(batch,rows as typeof readyRows),(done)=>setProgress(done));setResult(taskImportOutcomeMessage(outcome));await refreshHistory();}catch(caught){setError(caught instanceof Error?caught.message:"Import failed");}finally{setBusy(false);}};
  const correction=()=>downloadBlob(createCorrectionReportCsv(issues),"task-import-corrections.csv","text/csv;charset=utf-8");

  return <section className="-m-4 min-h-[calc(100dvh-7.875rem)] bg-task-bg p-4 text-task-text sm:-m-6 sm:p-6"><div className="mx-auto max-w-6xl space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-2xl font-semibold">Task Bulk Import</h1><p className="mt-1 text-sm text-task-text-muted">Upload once. JewelOS assigns exact matches automatically and keeps unresolved work in Assigning Left.</p></div><div className="flex flex-wrap gap-2"><Button onClick={onBack} variant="secondary">Back to tasks</Button><Button onClick={()=>navigate("/tasks/assigning-left")} variant="secondary">Assigning Left</Button><Button onClick={download}><Download className="size-4"/>Download format</Button></div></header>
    <Notice tone="task">Accepts the current 18-column CSV and canonical workbook, up to 2 MiB and 2,500 records. Written names are matched automatically. Blank or unclear names do not stop the import.</Notice>
    {error?<Notice tone="danger">{error}</Notice>:null}{result?<Notice tone={result.tone}>{result.text}</Notice>:null}
    <div className="rounded-xl border border-task-border bg-task-bg p-4"><div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-end"><label><span className="label">Final task sheet</span><input accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" className="task-field mt-1" onChange={(event)=>void upload(event.target.files?.[0])} type="file"/></label><label><span className="label">Start schedules from</span><input className="task-field mt-1" max="2100-12-31" min="2020-01-01" onChange={(event)=>void changeStartDate(event.target.value)} type="date" value={startDate}/></label></div></div>
    {draftRows.length?<div className="rounded-xl border border-task-border bg-task-bg p-4"><ImportReadinessSummary assigned={assigned} assigningLeft={assigningLeft} recurring={recurring} startDate={startDate} total={draftRows.length}/><p className="mt-3 text-sm text-task-text-muted">Any name that is blank, not found, or matches more than one account will remain safely unassigned.</p><div className="mt-4 flex flex-wrap gap-2"><Button disabled={!readyRows.length||busy} onClick={()=>void importCurrentSheet()}><Upload className="size-4"/>{busy?`Importing ${progress}/${readyRows.length}…`:`Import all ${readyRows.length} records`}</Button>{issues.length?<Button onClick={correction} variant="secondary"><Download className="size-4"/>Download correction report</Button>:null}</div></div>:null}
    {issueGroups.length?<div className="rounded-xl border border-danger/30 p-4"><h2 className="font-semibold">A few source values still need attention</h2><p className="mt-1 text-sm text-task-text-muted">Grouped below so you are not shown the same message thousands of times.</p><div className="mt-3 space-y-2">{issueGroups.slice(0,20).map((group)=><div className="rounded-lg bg-task-muted p-3 text-sm" key={`${group.field}-${group.reason}`}><p className="font-medium">{group.reason}</p><p className="text-task-text-muted">{group.field} · {group.rows.length} affected row{group.rows.length===1?"":"s"} · {group.guidance}</p></div>)}</div>{issueGroups.length>20?<p className="mt-2 text-sm text-task-text-muted">Download the correction report for the remaining grouped issues.</p>:null}</div>:draftRows.length?<Notice tone="success">The file is ready. You can import everything now.</Notice>:null}
    {payload?<div className="rounded-xl border border-task-border p-4"><h2 className="font-semibold">Canonical workbook</h2><div className="mt-3 flex gap-2"><Button disabled={busy} onClick={()=>void validateCanonical()} variant="secondary">Check workbook</Button><Button disabled={!validation?.valid||busy} onClick={()=>void importCanonical()}>Import workbook</Button></div></div>:null}
    {validation?<div className="rounded-xl border border-task-border p-4"><h2 className="font-semibold">Workbook check</h2><p className="text-sm text-task-text-muted">{validation.summary.requested_count} requested · {validation.summary.error_count} errors</p></div>:null}
    <div className="rounded-xl border border-task-border p-4"><h2 className="font-semibold">Recent imports</h2>{history.length?<div className="mt-3 space-y-2">{history.map((batch)=><div className="rounded-lg bg-task-muted p-3 text-sm" key={batch.id}>{new Date(batch.created_at).toLocaleString("en-IN")} · {batch.safe_file_label??"Import"} · {batch.requested_count} requested / {batch.valid_count} created / {batch.error_count} rejected · {batch.outcome}</div>)}</div>:<p className="mt-2 text-sm text-task-text-muted">No recent imports visible to this account.</p>}</div>
  </div></section>;
}
