import { useEffect, useRef, useState } from "react";
import { CalendarClock, ChevronDown, ClipboardList, FileText, History, Paperclip } from "lucide-react";
import { describeDue, fmsEmployeeStatusLabel, formatKolkataDateTime, presentFmsWorkContext, type FmsWorkContext as WorkContext, type FmsPreviousForm, type FmsPreviousFormsPage } from "@jewelos/core";
import { loadFmsWorkContext, loadFmsPreviousForms, signedFmsContextFileUrl } from "@jewelos/data/fms/work";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";

export function FmsWorkContext({ instanceId, instanceStageId, onReady, onRecordName, onPreviousForms, collapsed = false, expandAll = false }: { instanceId: string; instanceStageId: string; onReady?: (ready: boolean) => void; onRecordName?: ((name: string | null) => void) | undefined; onPreviousForms?: ((count: number) => void) | undefined; collapsed?: boolean; expandAll?: boolean }) {
  const readyCallback = useRef(onReady); readyCallback.current = onReady;
  const previousCallback = useRef(onPreviousForms); previousCallback.current = onPreviousForms;
  const nameCallback = useRef(onRecordName); nameCallback.current = onRecordName;
  const [context, setContext] = useState<WorkContext | null>(null);
  const [previous, setPrevious] = useState<FmsPreviousFormsPage | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [openingFile, setOpeningFile] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const openFile = async (fileId: string) => {
    setOpeningFile(fileId); setFileError(null);
    try { window.open(await signedFmsContextFileUrl(instanceId, instanceStageId, fileId), "_blank", "noopener"); }
    catch (error) { setFileError(error instanceof Error ? error.message : "Could not open this attachment"); }
    finally { setOpeningFile(null); }
  };
  useEffect(() => {
    let active = true; setContext(null); setPrevious(null); setFailed(false); readyCallback.current?.(false); nameCallback.current?.(null);
    void Promise.all([loadFmsWorkContext(instanceId, instanceStageId), loadFmsPreviousForms(instanceId, instanceStageId)])
      .then(([work, forms]) => { if (active) { setContext(work); setPrevious(forms); readyCallback.current?.(true); previousCallback.current?.(forms.forms.length); if (work.recordName) nameCallback.current?.(presentFmsWorkContext(work).title); } })
      .catch(() => { if (active) { setFailed(true); readyCallback.current?.(false); } });
    return () => { active = false; };
  }, [instanceId, instanceStageId, attempt]);
  const more = async () => {
    if (!previous?.nextCursor || loadingMore) return;
    setLoadingMore(true); setFailed(false);
    try { const next = await loadFmsPreviousForms(instanceId, instanceStageId, previous.nextCursor);
      setPrevious(current => current ? { forms: [...current.forms, ...next.forms.filter(form => !current.forms.some(item => item.id === form.id))], nextCursor: next.nextCursor } : next);
    } catch { setFailed(true); } finally { setLoadingMore(false); }
  };
  const moreHistory = async () => {
    if (!context?.nextCursor || loadingHistory) return;
    setLoadingHistory(true); setHistoryFailed(false);
    try { const next = await loadFmsWorkContext(instanceId, instanceStageId, context.nextCursor);
      setContext(current => current ? { ...current, journey: [...current.journey, ...next.journey], nextCursor: next.nextCursor } : next);
    } catch { setHistoryFailed(true); } finally { setLoadingHistory(false); }
  };
  if (failed && !context) return <Notice>Previous form details could not be loaded. <Button onClick={() => setAttempt(n => n + 1)} variant="ghost">Retry form details</Button></Notice>;
  if (!context || !previous) return <div aria-label="Loading previous form details" className="space-y-3" role="status"><div className="skeleton h-28 rounded-2xl" /><div className="skeleton h-40 rounded-2xl" /><span className="sr-only">Loading previous form details...</span></div>;
  const work = presentFmsWorkContext(context);
  const due = describeDue(context.dueAt);
  const showExpected = work.expectedResult && work.expectedResult !== "Complete this step and record the outcome.";
  return <section className="space-y-4" aria-label="Work information">
    {/* The card that opened this page already named the workflow, stage, reference and
        assignee. Only what helps finish the work is repeated: due time and instructions. */}
    {context.dueAt || work.instructions || showExpected ? <div className="space-y-2 rounded-2xl border border-gold/30 bg-gold/5 p-4">
      {context.dueAt ? <p className={cn("flex items-center gap-1.5 text-sm", due.tone === "overdue" ? "font-semibold text-danger" : "text-task-text")}><CalendarClock aria-hidden="true" className="size-4 shrink-0" />{context.dueLabel && context.dueLabel !== "Due" ? `${context.dueLabel}: ` : ""}{due.label}</p> : null}
      {work.instructions ? <div><h2 className="flex items-center gap-1.5 text-sm font-semibold text-task-text"><ClipboardList aria-hidden="true" className="size-4 text-gold-secondary" />What you need to do</h2><p className="mt-1 whitespace-pre-wrap break-words text-[0.9375rem] text-task-text">{work.instructions}</p></div> : null}
      {showExpected ? <p className="text-sm text-task-text-muted">Expected result: {work.expectedResult}</p> : null}
    </div> : null}

    {previous.forms.length ? <details className="group" open={expandAll || !collapsed}>
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-1 group-[:not([open])]:border group-[:not([open])]:border-task-border group-[:not([open])]:bg-task-bg group-[:not([open])]:px-4">
        <span className="min-w-0"><h2 className="text-lg font-semibold text-task-text">Previous form answers</h2><span className="block text-xs text-task-text-muted group-open:hidden">{previous.forms.length === 1 ? "1 earlier form" : `${previous.forms.length} earlier forms`} · tap to read</span></span>
        <ChevronDown aria-hidden="true" className="size-5 shrink-0 text-task-text-muted transition-transform group-open:rotate-180" />
      </summary>
      {previous.forms.length ? <ol className="mt-2 space-y-3">{previous.forms.map((form, formIndex) => <li key={form.id}><PreviousFormCard context={context} form={form} open={expandAll || formIndex < 2} openingFile={openingFile} onOpenFile={openFile} /></li>)}</ol> : null}
      {previous.nextCursor ? <Button className="mt-3" disabled={loadingMore} onClick={() => void more()} variant="secondary">{loadingMore ? "Loading earlier forms..." : "Load earlier forms"}</Button> : null}
      {failed ? <div className="mt-3"><Notice>Earlier forms could not be loaded. Try again.</Notice></div> : null}
      {fileError ? <div className="mt-3"><Notice tone="danger">{fileError}</Notice></div> : null}
    </details> : null}

    {context.journey.length ? <details className="rounded-2xl border border-task-border bg-task-bg p-4"><summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-task-text"><History aria-hidden="true" className="size-4 text-gold-secondary" />Earlier steps</summary>
      <ol className="mt-3 space-y-3">{context.journey.map(item => <li className="border-l-2 border-gold/40 pl-3 text-sm" key={item.id}>
        <p className="font-medium text-task-text">{item.stageName}{item.visitNumber > 1 ? ` · visit ${item.visitNumber}` : ""}</p>
        <p className="text-xs text-task-text-muted">{[fmsEmployeeStatusLabel(item.status), item.employeeName, formatKolkataDateTime(item.completedAt)].filter(Boolean).join(" · ")}</p>
      </li>)}</ol>
      {context.nextCursor ? <Button className="mt-2" disabled={loadingHistory} onClick={() => void moreHistory()} variant="ghost">Load more history</Button> : null}{historyFailed ? <Notice>More history could not be loaded. Try again.</Notice> : null}</details> : null}
  </section>;
}

function PreviousFormCard({ context, form, open, openingFile, onOpenFile }: { context: WorkContext; form: FmsPreviousForm; open: boolean; openingFile: string | null; onOpenFile: (fileId: string) => Promise<void> }) {
  const answers = presentFmsWorkContext({ ...context, receivedFields: form.fields }).answers.map((answer, index) => ({ ...answer, received: form.fields[index] }));
  const answered = answers.filter(answer => answer.answered || answer.received?.attachment);
  const unanswered = answers.filter(answer => !answer.answered && !answer.received?.attachment);
  const formName = form.fields[0]?.formName;
  const submitted = formatKolkataDateTime(form.submittedAt);
  const row = (answer: (typeof answers)[number], index: number) => {
    const file = answer.received?.attachment;
    return <div className="min-w-0 py-3" key={answer.received?.field.key ?? index}>
      <dt className="text-sm leading-snug text-task-text-muted">{answer.label}</dt>
      <dd className={cn("mt-1 min-w-0 whitespace-pre-wrap break-words text-base leading-snug", answer.answered || file ? "font-semibold text-task-text" : "italic text-task-text-muted")}>
        {file ? <Button className="max-w-full justify-start whitespace-normal break-words text-left" disabled={openingFile !== null} onClick={() => void onOpenFile(file.id)} variant="secondary"><Paperclip aria-hidden="true" className="size-4" />{openingFile === file.id ? "Opening..." : `Open attachment: ${file.name}`}</Button>
          : answer.answered ? answer.display : "Not answered"}
      </dd>
    </div>;
  };
  return <details className="group/form overflow-hidden rounded-2xl border border-task-border bg-task-bg" open={open}>
    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 bg-task-muted/60 px-4 py-3">
      <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-gold/10 text-gold-secondary"><FileText className="size-4" /></span>
      <span className="min-w-0 flex-1">
        <span className="block break-words font-semibold text-task-text">{form.isInitial ? formName || "Starting form" : form.stageName}</span>
        <span className="block text-xs text-task-text-muted">{[form.submittedBy ? `Filled by ${form.submittedBy}` : null, submitted || null].filter(Boolean).join(" · ")}</span>
      </span>
      <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-task-text-muted transition-transform group-open/form:rotate-180" />
    </summary>
    <div className="border-t border-task-border px-4 pb-2">
      {answered.length ? <dl className="divide-y divide-task-border">{answered.map(row)}</dl> : <p className="py-3 text-sm text-task-text-muted">No answers were provided in this form.</p>}
      {unanswered.length ? <details className="border-t border-task-border py-1"><summary className="min-h-11 cursor-pointer content-center text-sm text-task-text-muted">{unanswered.length} {unanswered.length === 1 ? "question was" : "questions were"} not answered</summary><dl className="divide-y divide-task-border">{unanswered.map(row)}</dl></details> : null}
    </div>
  </details>;
}
