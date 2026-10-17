import { useEffect, useRef, useState } from "react";
import { presentFmsWorkContext, type FmsWorkContext as WorkContext, type FmsPreviousFormsPage } from "@jewelos/core";
import { loadFmsWorkContext, loadFmsPreviousForms, signedFmsContextFileUrl } from "@jewelos/data/fms/work";
import { Button, Notice } from "@/components/ui";

export function FmsWorkContext({ instanceId, instanceStageId, onReady }: { instanceId: string; instanceStageId: string; onReady?: (ready: boolean) => void }) {
  const readyCallback = useRef(onReady); readyCallback.current = onReady;
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
    let active = true; setContext(null); setPrevious(null); setFailed(false); readyCallback.current?.(false);
    void Promise.all([loadFmsWorkContext(instanceId, instanceStageId), loadFmsPreviousForms(instanceId, instanceStageId)])
      .then(([work, forms]) => { if (active) { setContext(work); setPrevious(forms); readyCallback.current?.(true); } })
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
  if (!context || !previous) return <p className="text-sm text-soft-grey" role="status">Loading previous form details...</p>;
  const work = presentFmsWorkContext(context);
  return <section className="space-y-4 rounded-2xl border border-gold/20 bg-charcoal/40 p-4 sm:p-6" aria-label="Work information">
    <header><p className="text-xs text-gold">{context.workflowName} | {context.reference}</p><h2 className="mt-1 text-xl font-semibold text-white">Previous form answers</h2>
      <p className="mt-1 text-sm text-soft-grey">Review the details provided before this stage, then continue with your work.</p></header>
    {previous.forms.length ? previous.forms.map((form, formIndex) => {
      const answers = presentFmsWorkContext({ ...context, receivedFields: form.fields }).answers;
      return <details className="rounded-xl border border-gold/15 p-3" open={formIndex < 2} key={form.id}>
        <summary className="min-h-11 cursor-pointer text-sm font-semibold text-champagne">{form.isInitial ? "Initial form" : form.stageName}{form.visitNumber > 1 ? ` | visit ${form.visitNumber}` : ""}<span className="mt-1 block text-xs font-normal text-soft-grey">{form.fields[0]?.formName ?? form.stageName}{form.submittedBy ? ` | Filled by ${form.submittedBy}` : ""}{form.submittedAt ? ` | ${new Date(form.submittedAt).toLocaleString("en-IN")}` : ""}</span></summary>
        {answers.length ? <dl className="mt-3 space-y-3">{answers.map((answer, index) => {
          const file = form.fields[index]?.attachment;
          return <div className="grid min-w-0 gap-1 border-b border-gold/10 pb-3 sm:grid-cols-[minmax(8rem,1fr)_2fr]" key={form.fields[index]?.field.key ?? index}>
            <dt className="text-sm text-soft-grey">{answer.label}</dt><dd className="min-w-0 whitespace-pre-wrap break-words text-sm text-white">{file ? <Button className="max-w-full whitespace-normal break-words text-left" disabled={openingFile !== null} onClick={() => void openFile(file.id)} variant="secondary">{openingFile === file.id ? "Opening..." : `Open attachment: ${file.name}`}</Button> : answer.display}</dd>
          </div>;
        })}</dl> : <p className="text-sm text-soft-grey">No answers were provided in this form.</p>}
      </details>;
    }) : <p className="text-sm text-soft-grey">No earlier form has been submitted for this stage.</p>}
    {previous.nextCursor ? <Button disabled={loadingMore} onClick={() => void more()} variant="ghost">{loadingMore ? "Loading earlier forms..." : "Load earlier forms"}</Button> : null}
    {failed ? <Notice>Earlier forms could not be loaded. Try again.</Notice> : null}
    {fileError ? <Notice tone="danger">{fileError}</Notice> : null}
    {work.instructions ? <div><h3 className="font-semibold text-champagne">What you need to do</h3><p className="mt-1 whitespace-pre-wrap text-sm text-white">{work.instructions}</p></div> : null}
    {work.expectedResult && work.expectedResult !== "Complete this step and record the outcome." ? <p className="text-sm text-soft-grey">Expected result: {work.expectedResult}</p> : null}
    {context.journey.length ? <details><summary className="min-h-11 cursor-pointer text-sm text-champagne">Workflow journey</summary><ol className="mt-2 space-y-2">{context.journey.map(item => <li className="border-l border-gold/30 pl-3 text-sm" key={item.id}>{item.stageName}{item.visitNumber > 1 ? ` | visit ${item.visitNumber}` : ""}{item.employeeName ? ` | ${item.employeeName}` : ""}<p className="text-xs text-soft-grey">{item.status.replaceAll("_", " ")}</p></li>)}</ol>{context.nextCursor ? <Button disabled={loadingHistory} onClick={() => void moreHistory()} variant="ghost">Load more history</Button> : null}{historyFailed ? <Notice>More history could not be loaded. Try again.</Notice> : null}</details> : null}
  </section>;
}
