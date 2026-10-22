import { useEffect, useRef, useState } from "react";
import { CalendarClock, ClipboardList, History, Paperclip, UserRound } from "lucide-react";
import { describeDue, fmsEmployeeStatusLabel, formatKolkataDateTime, presentFmsWorkContext, type FmsWorkContext as WorkContext, type FmsPreviousForm, type FmsPreviousFormsPage } from "@jewelos/core";
import { loadFmsWorkContext, loadFmsPreviousForms, signedFmsContextFileUrl } from "@jewelos/data/fms/work";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";

/** Unanswered questions beyond this many are folded away so the real answers stay easy to scan. */
const UNANSWERED_SHOWN = 2;

export function FmsWorkContext({ instanceId, instanceStageId, onReady, onRecordName, collapsed = false }: { instanceId: string; instanceStageId: string; onReady?: (ready: boolean) => void; onRecordName?: ((name: string | null) => void) | undefined; collapsed?: boolean }) {
  const readyCallback = useRef(onReady); readyCallback.current = onReady;
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
      .then(([work, forms]) => { if (active) { setContext(work); setPrevious(forms); readyCallback.current?.(true); if (work.recordName) nameCallback.current?.(presentFmsWorkContext(work).title); } })
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
    <div className="rounded-2xl border border-gold/30 bg-gold/5 p-4 sm:p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-gold-secondary">Your step</p>
      <h2 className="mt-1 text-lg font-semibold text-task-text">{context.stageName}</h2>
      <dl className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
        <div className="min-w-0"><dt className="text-xs text-task-text-muted">Workflow</dt><dd className="break-words text-task-text">{context.workflowName}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-task-text-muted">Reference</dt><dd className="break-words text-task-text">{work.reference}</dd></div>
        {context.dueAt ? <div className="min-w-0"><dt className="text-xs text-task-text-muted">{context.dueLabel || "Due"}</dt><dd className={cn("flex items-center gap-1.5", due.tone === "overdue" ? "font-semibold text-danger" : "text-task-text")}><CalendarClock aria-hidden="true" className="size-4 shrink-0" />{due.label}</dd></div> : null}
        {context.assignedNames.length ? <div className="min-w-0"><dt className="text-xs text-task-text-muted">Assigned to</dt><dd className="flex items-center gap-1.5 break-words text-task-text"><UserRound aria-hidden="true" className="size-4 shrink-0" />{context.assignedNames.join(", ")}</dd></div> : null}
      </dl>
      {work.instructions ? <div className="mt-4 rounded-xl border border-task-border bg-task-bg p-3"><h3 className="flex items-center gap-1.5 text-sm font-semibold text-task-text"><ClipboardList aria-hidden="true" className="size-4 text-gold-secondary" />What you need to do</h3><p className="mt-1 whitespace-pre-wrap break-words text-sm text-task-text">{work.instructions}</p>{showExpected ? <p className="mt-2 text-sm text-task-text-muted">Expected result: {work.expectedResult}</p> : null}</div>
        : showExpected ? <p className="mt-3 text-sm text-task-text-muted">Expected result: {work.expectedResult}</p> : null}
    </div>

    <details className="group rounded-2xl border border-task-border bg-task-bg p-4 sm:p-5" open={!collapsed}>
      <summary className="flex min-h-11 cursor-pointer list-none items-start justify-between gap-3">
        <span><h2 className="text-lg font-semibold text-task-text">Previous form answers</h2>
          <span className="mt-0.5 block text-sm text-task-text-muted">{previous.forms.length ? "Read what was filled in earlier stages before you continue." : "No earlier form has been submitted for this stage."}</span></span>
        <span className="mt-1 shrink-0 rounded-full bg-task-muted px-2.5 py-1 text-xs tabular-nums text-task-text-muted">{previous.forms.length}{previous.nextCursor ? "+" : ""} {previous.forms.length === 1 ? "form" : "forms"}</span>
      </summary>
      {previous.forms.length ? <ol className="mt-4 space-y-3">{previous.forms.map((form, formIndex) => <li key={form.id}><PreviousFormCard context={context} form={form} open={formIndex < 2} openingFile={openingFile} onOpenFile={openFile} /></li>)}</ol> : null}
      {previous.nextCursor ? <Button className="mt-3" disabled={loadingMore} onClick={() => void more()} variant="secondary">{loadingMore ? "Loading earlier forms..." : "Load earlier forms"}</Button> : null}
      {failed ? <div className="mt-3"><Notice>Earlier forms could not be loaded. Try again.</Notice></div> : null}
      {fileError ? <div className="mt-3"><Notice tone="danger">{fileError}</Notice></div> : null}
    </details>

    {context.journey.length ? <details className="rounded-2xl border border-task-border bg-task-bg p-4"><summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-semibold text-task-text"><History aria-hidden="true" className="size-4 text-gold-secondary" />Workflow journey so far</summary>
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
    return <div className="grid min-w-0 gap-1 py-2.5 sm:grid-cols-[minmax(8rem,1fr)_2fr] sm:gap-3" key={answer.received?.field.key ?? index}>
      <dt className="text-sm text-task-text-muted">{answer.label}</dt>
      <dd className={cn("min-w-0 whitespace-pre-wrap break-words text-sm", answer.answered || file ? "font-medium text-task-text" : "italic text-task-text-muted")}>
        {file ? <Button className="max-w-full justify-start whitespace-normal break-words text-left" disabled={openingFile !== null} onClick={() => void onOpenFile(file.id)} variant="secondary"><Paperclip aria-hidden="true" className="size-4" />{openingFile === file.id ? "Opening..." : `Open attachment: ${file.name}`}</Button>
          : answer.answered ? answer.display : "Not answered"}
      </dd>
    </div>;
  };
  return <details className="rounded-xl border border-task-border bg-task-muted/40" open={open}>
    <summary className="flex min-h-12 cursor-pointer flex-col gap-1 p-3">
      <span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-task-text">{form.isInitial ? "Starting form" : form.stageName}</span>{form.visitNumber > 1 ? <span className="rounded-full bg-task-accent-soft px-2 py-0.5 text-xs text-task-text">Visit {form.visitNumber}</span> : null}</span>
      <span className="text-xs text-task-text-muted">{[formName, form.submittedBy ? `Filled by ${form.submittedBy}` : null, submitted || null].filter(Boolean).join(" · ")}</span>
    </summary>
    <div className="border-t border-task-border px-3 pb-2">
      {answered.length ? <dl className="divide-y divide-task-border">{answered.map(row)}</dl> : <p className="py-3 text-sm text-task-text-muted">No answers were provided in this form.</p>}
      {unanswered.length ? unanswered.length <= UNANSWERED_SHOWN ? <dl className="divide-y divide-task-border border-t border-task-border">{unanswered.map(row)}</dl>
        : <details className="border-t border-task-border py-2"><summary className="min-h-11 cursor-pointer content-center text-sm text-task-text-muted">{unanswered.length} questions were not answered</summary><dl className="divide-y divide-task-border">{unanswered.map(row)}</dl></details> : null}
    </div>
  </details>;
}
