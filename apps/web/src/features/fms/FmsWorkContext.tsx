import { useEffect, useState } from "react";
import { presentFmsWorkContext, type FmsWorkContext as WorkContext } from "@jewelos/core";
import { loadFmsWorkContext, signedFmsContextFileUrl } from "@jewelos/data/fms/work";
import { Button, Notice } from "@/components/ui";

export function FmsWorkContext({ instanceId, instanceStageId }: { instanceId: string; instanceStageId: string }) {
  const [context, setContext] = useState<WorkContext | null>(null);
  const [failed, setFailed] = useState(false);
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
    let active = true; setContext(null); setFailed(false);
    void loadFmsWorkContext(instanceId, instanceStageId).then(value => { if (active) setContext(value); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [instanceId, instanceStageId, attempt]);
  const more = async () => {
    if (!context?.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try { const next = await loadFmsWorkContext(instanceId, instanceStageId, context.nextCursor);
      setContext(current => current ? { ...current, journey: [...current.journey, ...next.journey], nextCursor: next.nextCursor } : next);
    } catch { setFailed(true); } finally { setLoadingMore(false); }
  };
  if (failed && !context) return <Notice>Work information could not be loaded. <Button onClick={() => setAttempt(n => n + 1)} variant="ghost">Retry work information</Button></Notice>;
  if (!context) return <p className="text-sm text-soft-grey" role="status">Loading work information...</p>;
  const work = presentFmsWorkContext(context);
  return <section className="space-y-4 rounded-2xl border border-gold/20 bg-charcoal/40 p-4 sm:p-6" aria-label="Work information">
    <header><p className="text-xs text-gold">{context.workflowName} · {context.reference}</p><h2 className="mt-1 text-xl font-semibold text-white">{work.title}</h2>
      {work.shortDescription ? <p className="mt-1 text-sm text-soft-grey">{work.shortDescription}</p> : null}
      <p className="mt-2 text-sm text-soft-grey">Assigned: {work.assignedNames.join(", ") || "Configured employee"}{work.dueAt ? ` · ${work.dueLabel}: ${new Date(work.dueAt).toLocaleString("en-IN")}` : ""}</p></header>
    {work.answers.length ? <div><h3 className="mb-2 font-semibold text-champagne">Information Received</h3><dl className="space-y-2">{work.answers.map((answer, index) => <div className="grid gap-1 border-b border-gold/10 pb-2 sm:grid-cols-[minmax(8rem,1fr)_2fr]" key={`${answer.label}-${index}`}>
      <dt className="text-sm text-soft-grey">{answer.label}<span className="block text-xs">{answer.source}</span></dt><dd className="break-words text-sm text-white">{context.receivedFields[index]?.attachment ? <Button disabled={openingFile !== null} onClick={() => { const file = context.receivedFields[index]?.attachment; if (file) void openFile(file.id); }} variant="secondary">{openingFile === context.receivedFields[index]?.attachment?.id ? "Opening..." : `Open attachment: ${context.receivedFields[index]?.attachment?.name}`}</Button> : answer.display}</dd>
    </div>)}</dl></div> : null}
    {fileError ? <Notice tone="danger">{fileError}</Notice> : null}
    <div><h3 className="font-semibold text-champagne">What You Need To Do</h3><p className="mt-1 whitespace-pre-wrap text-sm text-white">{work.instructions || "Complete the linked work and record the outcome."}</p></div>
    {work.expectedResult ? <p className="text-sm text-soft-grey">Expected result: {work.expectedResult}</p> : null}
    {work.journey.length ? <details><summary className="min-h-11 cursor-pointer text-sm font-semibold text-champagne">Workflow Journey</summary><ol className="mt-2 space-y-2">{work.journey.map(item => <li className="border-l border-gold/30 pl-3 text-sm" key={item.id}>
      <span className="text-white">{item.stageName}{item.visitNumber > 1 ? ` · visit ${item.visitNumber}` : ""}</span><p className="text-xs text-soft-grey">{item.status.replaceAll("_", " ")}{item.employeeName ? ` · ${item.employeeName}` : ""}</p>
    </li>)}</ol>{context.nextCursor ? <Button disabled={loadingMore} onClick={() => void more()} variant="ghost">Load more history</Button> : null}{failed ? <Notice>More history could not be loaded. Try again.</Notice> : null}</details> : null}
  </section>;
}
