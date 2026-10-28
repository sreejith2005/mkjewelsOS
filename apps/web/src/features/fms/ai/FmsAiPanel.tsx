import { useEffect, useRef, useState } from "react";
import { ArrowRight, Loader2, RotateCcw, SendHorizontal, Sparkles, Square, X } from "lucide-react";
import type { FmsAiEvidenceBasis, FmsAiResponse, FmsFlowDefinition } from "@jewelos/core";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { FmsData } from "../api";
import type { FmsAiSettings } from "./api";
import { useFmsDiagnostics } from "./FmsAiFindings";
import { FmsAiProposalReview } from "./FmsAiProposal";
import { useFmsAiConversation, type FmsAiTurn } from "./useFmsAiConversation";

const BASIS_LABEL: Readonly<Record<FmsAiEvidenceBasis, string>> = { static: "From the workflow", simulated: "Simulated", observed: "Observed in records", indeterminate: "Not enough evidence" };

export type FmsAiPanelProps = Readonly<{
  definition: FmsFlowDefinition;
  data: FmsData;
  settings: FmsAiSettings;
  selectedStageKey: string | null;
  published: FmsFlowDefinition | null;
  canManageForms?: boolean | undefined;
  onClose: () => void;
  onGoToStage: (stageKey: string) => void;
  onApply: (next: FmsFlowDefinition) => void;
  /** Inside the desktop builder workspace: anchored to its right edge below the toolbar, not to the window. */
  embedded?: boolean | undefined;
}>;

/**
 * The one FMS assistant, inside the workflow builder. A single conversation:
 * the author asks it to build, change, check, debug or explain the workflow,
 * and it decides what to do from the message. Edits come back as a reviewed
 * proposal; nothing changes until the author presses Apply.
 */
export function FmsAiPanel(props: FmsAiPanelProps) {
  const { definition, data, settings } = props;
  // Edits need the organization's build switch; with only the other switch on, the assistant still answers.
  const canEdit = settings.builderEnabled;
  const conversation = useFmsAiConversation();
  const findings = useFmsDiagnostics(definition, data);
  const problems = findings.filter((finding) => finding.severity !== "suggestion").length;
  const [input, setInput] = useState("");
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const textbox = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { textbox.current?.focus(); }, []);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [props]);
  useEffect(() => { transcriptEnd.current?.scrollIntoView?.({ block: "end" }); }, [conversation.turns.length, conversation.busy]);

  const send = (question = input) => {
    void conversation.send({ question, definition, published: props.published, selectedStageKey: props.selectedStageKey, canEdit });
    setInput("");
  };
  const empty = definition.stages.length <= 1 && !definition.stages[0]?.formTemplateId;
  const examples = [
    ...(empty ? ["Build this workflow: the branch fills the request form, the manager approves within 4 hours, then the stock team dispatches."] : []),
    "Check this workflow for problems and fix them",
    "Why isn't the next person receiving the task?",
    ...(empty ? [] : ["Add a manager approval after the first step"]),
  ];

  // No backdrop: on phones the builder header (Save draft, Publish, Undo) stays usable above the sheet.
  return <aside aria-labelledby="fms-ai-title" aria-modal="false" className={props.embedded ? "absolute inset-y-0 right-0 z-40 flex w-[min(34rem,calc(100%-3.5rem))] flex-col border-l border-gold/30 bg-obsidian shadow-2xl" : "fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex max-h-[78dvh] flex-col rounded-t-2xl border border-gold/30 bg-obsidian shadow-2xl md:bottom-0 md:left-auto md:top-16 md:max-h-none md:w-[min(34rem,45vw)] md:rounded-none md:border-y-0 md:border-r-0"} role="dialog">
    <header className="flex items-center gap-2 border-b border-gold/15 px-4 py-3">
      <Sparkles aria-hidden className="size-5 text-gold-secondary" />
      <h3 className="mr-auto text-base font-semibold text-white" id="fms-ai-title">AI assistant</h3>
      {conversation.turns.length ? <Button aria-label="New conversation" className="shrink-0 px-2" disabled={conversation.busy} onClick={conversation.reset} title="New conversation" variant="ghost"><RotateCcw className="size-4" /></Button> : null}
      <Button aria-label="Close AI assistant" className="shrink-0 px-2" onClick={props.onClose} variant="ghost"><X className="size-5" /></Button>
    </header>

    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
      {!conversation.turns.length ? <>
        <p className="text-sm text-soft-grey">Ask me to build this workflow, change it, check it for problems, or explain why something happens. {canEdit ? "I show every change for you to review; nothing changes until you press Apply, and you still Save draft and Publish yourself." : "I can explain and suggest fixes; an administrator has not switched on edits."}</p>
        {problems ? <p className="text-xs text-champagne">The app's checks found {problems} thing{problems === 1 ? "" : "s"} to look at in this draft.</p> : null}
        <div className="flex flex-wrap gap-2">{examples.map((example) => <button className="rounded-full border border-gold/25 px-3 py-1.5 text-left text-xs text-champagne hover:bg-gold/10" disabled={conversation.busy} key={example} onClick={() => { setInput(example); textbox.current?.focus(); }} type="button">{example}</button>)}</div>
      </> : null}
      <ol aria-label="Assistant conversation" aria-live="polite" className="space-y-3">
        {conversation.turns.map((turn) => <li key={turn.id}><AssistantTurn {...props} canEdit={canEdit} onAnswer={(text) => setInput((current) => current ? `${current}\n${text}` : text)} onRegenerate={conversation.lastQuestion ? () => send(conversation.lastQuestion!) : undefined} turn={turn} /></li>)}
      </ol>
      {conversation.busy ? <p className="flex items-center gap-2 text-xs text-soft-grey" role="status"><Loader2 aria-hidden className="size-4 animate-spin" />Working on it… this can take up to a minute.</p> : null}
      <div ref={transcriptEnd} />
    </div>

    <footer className="border-t border-gold/15 p-3">
      <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); send(); }}>
        <textarea aria-label="Message the AI assistant" className="field min-h-12 flex-1 resize-none" maxLength={2000} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Build, change, check or ask about this workflow…" ref={textbox} rows={2} value={input} />
        {conversation.busy ? <Button aria-label="Cancel" onClick={conversation.cancel} type="button" variant="secondary"><Square className="size-4" /></Button>
          : <Button aria-label="Send" disabled={!input.trim()} type="submit"><SendHorizontal className="size-4" /></Button>}
      </form>
      <p className="mt-1 text-[11px] text-soft-grey">{settings.userDailyLimit ? `${Math.max(settings.userDailyLimit - settings.usedToday, 0)} of ${settings.userDailyLimit} AI requests left today (shown at open). ` : ""}AI answers can be wrong; the app's checks and the server decide.</p>
    </footer>
  </aside>;
}

function AssistantTurn({ turn, definition, data, canEdit, canManageForms, onGoToStage, onApply, onRegenerate, onAnswer }: FmsAiPanelProps & { turn: FmsAiTurn; canEdit: boolean; onRegenerate?: (() => void) | undefined; onAnswer: (text: string) => void }) {
  if (turn.role === "user") return <div className="ml-8 rounded-xl bg-gold/10 p-3 text-sm text-white"><p className="whitespace-pre-wrap">{turn.text}</p></div>;
  if (turn.role === "error") return <Notice tone={turn.code === "cancelled" ? "neutral" : "danger"}>{turn.text}</Notice>;
  const response: FmsAiResponse = turn.response;
  const names = new Map(definition.stages.map((stage) => [stage.key, stage.name]));
  const readOnly = !canEdit;
  return <div className="space-y-2 rounded-xl border border-gold/15 p-3 text-sm">
    <p className="whitespace-pre-wrap text-white">{response.message}</p>
    {response.questions.length ? <ul className="space-y-2">{response.questions.map((question) => <li key={question.id}><p className="text-champagne">{question.question}</p><div className="mt-1 flex flex-wrap gap-1">{question.choices.map((choice) => <button className="rounded-full border border-gold/25 px-2 py-1 text-xs text-champagne hover:bg-gold/10" key={choice} onClick={() => onAnswer(`${question.question} ${choice}`)} type="button">{choice}</button>)}</div></li>)}</ul> : null}
    {response.evidence.length ? <ul className="space-y-1">{response.evidence.map((item, index) => <li className="text-xs text-soft-grey" key={index}><span className={cn("mr-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", item.basis === "indeterminate" ? "bg-charcoal text-soft-grey" : "bg-gold/15 text-gold-secondary")}>{BASIS_LABEL[item.basis]}</span>{item.stageKey && names.has(item.stageKey) ? <button className="mr-1 underline" onClick={() => onGoToStage(item.stageKey!)} type="button">{names.get(item.stageKey)}</button> : null}{item.text}</li>)}</ul> : null}
    {response.assumptions.length ? <details><summary className="cursor-pointer text-xs text-champagne">Assumptions ({response.assumptions.length})</summary><ul className="mt-1 list-disc pl-4 text-xs text-soft-grey">{response.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></details> : null}
    {response.unresolvedItems.length ? <Notice>Still to decide: {response.unresolvedItems.join(" · ")}</Notice> : null}
    {response.suggestedFixes.map((fix, index) => <div className="space-y-2 rounded-lg border border-gold/20 p-2" key={index}>
      <p className="font-semibold text-white">Suggested fix: {fix.title}</p>
      {fix.steps.length ? <ol className="list-decimal pl-4 text-xs text-soft-grey">{fix.steps.map((step, stepIndex) => <li key={stepIndex}>{step}</li>)}</ol> : null}
      {fix.stageKey && names.has(fix.stageKey) ? <Button className="min-h-9 px-3 text-xs" onClick={() => onGoToStage(fix.stageKey!)} variant="secondary">Go to step <ArrowRight className="size-3" /></Button> : null}
      {fix.operations.length ? <FmsAiProposalReview current={definition} data={data} onApply={onApply} onRegenerate={onRegenerate} readOnly={readOnly} source={{ seed: `${response.requestId}:fix:${index}`, operations: fix.operations, baseDefinition: turn.baseDefinition, expectedFingerprint: null, title: "Preview this fix" }} /> : null}
    </div>)}
    {response.kind === "proposal" ? (response.proposedFingerprint
      ? <FmsAiProposalReview canManageForms={canManageForms ?? false} current={definition} data={data} formsToCreate={response.formsToCreate} onApply={onApply} onRegenerate={onRegenerate} readOnly={readOnly} source={{ seed: response.requestId, operations: response.operations, baseDefinition: turn.baseDefinition, expectedFingerprint: response.proposedFingerprint, title: "Review the changes" }} />
      : response.validationIssues.length ? <Notice tone="danger">The changes could not be applied, so nothing changed: {response.validationIssues.map((issue) => issue.message).join(" ")} Try rephrasing or answer the open questions.</Notice> : null) : null}
    {(response.kind !== "proposal" || !response.proposedFingerprint) && response.formsToCreate.length ? <FmsAiProposalReview canManageForms={canManageForms ?? false} current={definition} data={data} formsToCreate={response.formsToCreate} readOnly={readOnly} source={{ seed: response.requestId, operations: [], baseDefinition: turn.baseDefinition, expectedFingerprint: null, title: "Forms to create" }} /> : null}
  </div>;
}
