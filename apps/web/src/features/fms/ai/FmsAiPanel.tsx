import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Loader2, SendHorizontal, Sparkles, Square, X } from "lucide-react";
import type { FmsAiEvidenceBasis, FmsAiResponse, FmsDiagnosticFinding, FmsFlowDefinition, FmsRunSnapshot } from "@jewelos/core";
import { Button, Notice } from "@/components/ui";
import { cn } from "@/lib/utils";
import type { FmsData } from "../api";
import type { FmsAiSettings } from "./api";
import { FmsAiFindingList, FmsAiRouteExplainer, useFmsDiagnostics } from "./FmsAiFindings";
import { FmsAiProposalReview } from "./FmsAiProposal";
import { FmsAiRunPicker, type FmsAiRunCandidate } from "./FmsAiRun";
import { useFmsAiConversation, type FmsAiTurn } from "./useFmsAiConversation";

export type FmsAiTab = "check" | "ask" | "build" | "run";

const DEBUG_EXAMPLES = ["Why is this step blocked?", "Is any path missing a fallback?", "Why isn't the next person receiving the task?", "Can I improve the assignments?"];
const BUILD_EXAMPLES = [
  "Stock request: branch staff fill the stock request form, the stock controller checks it within 4 hours, urgent requests need the branch manager's approval, then dispatch.",
  "Repair job: the counter takes the item using the repair intake form, the workshop repairs it within 2 days, quality check, then the counter calls the customer.",
  "Add a manager approval after the first step when the amount is high.",
];
const BASIS_LABEL: Readonly<Record<FmsAiEvidenceBasis, string>> = { static: "From the workflow", simulated: "Simulated", observed: "Observed in records", indeterminate: "Not enough evidence" };

export type FmsAiPanelProps = Readonly<{
  definition: FmsFlowDefinition;
  data: FmsData;
  settings: FmsAiSettings;
  selectedStageKey: string | null;
  readOnly: boolean;
  published: FmsFlowDefinition | null;
  initialTab?: FmsAiTab | undefined;
  runCandidates?: readonly FmsAiRunCandidate[] | undefined;
  canManageForms?: boolean | undefined;
  onClose: () => void;
  onGoToStage: (stageKey: string, finding?: FmsDiagnosticFinding) => void;
  onApply?: ((next: FmsFlowDefinition) => void) | undefined;
  onCreateRevision?: (() => void) | undefined;
  /** Inside the desktop builder workspace: anchored to its right edge below the toolbar, not to the window. */
  embedded?: boolean | undefined;
}>;

export function FmsAiPanel(props: FmsAiPanelProps) {
  const { definition, data, settings, readOnly } = props;
  const tabs = useMemo(() => (["check", ...(settings.debuggerEnabled ? ["ask"] : []), ...(settings.builderEnabled && !readOnly ? ["build"] : []), ...(settings.runDiagnosisEnabled && settings.debuggerEnabled ? ["run"] : [])] as FmsAiTab[]), [readOnly, settings]);
  const [tab, setTab] = useState<FmsAiTab>(props.initialTab && tabs.includes(props.initialTab) ? props.initialTab : "check");
  const findings = useFmsDiagnostics(definition, data);
  const debug = useFmsAiConversation("debug");
  const build = useFmsAiConversation("build");
  const [input, setInput] = useState("");
  const [run, setRun] = useState<FmsRunSnapshot | null>(null);
  const [runConsent, setRunConsent] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const transcriptEnd = useRef<HTMLDivElement>(null);
  const conversation = tab === "build" ? build : debug;

  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === "Escape") props.onClose(); }; window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close); }, [props]);
  useEffect(() => { transcriptEnd.current?.scrollIntoView?.({ block: "end" }); }, [conversation.turns.length, conversation.busy]);

  const send = (question = input) => {
    const instanceId = tab === "run" && run && runConsent ? run.instance.id : null;
    void conversation.send({ question, definition, published: props.published, selectedStageKey: props.selectedStageKey, readOnly, instanceId });
    setInput("");
  };
  const errors = findings.filter((finding) => finding.severity === "error").length;
  const examples = tab === "build" ? BUILD_EXAMPLES : [...DEBUG_EXAMPLES, ...(props.published ? ["What changed since the last published version?"] : [])];
  const names = new Map(definition.stages.map((stage) => [stage.key, stage.name]));

  // No backdrop: on phones the builder header (Save draft, Publish, Undo) stays usable above the sheet.
  return <>
    <aside aria-labelledby="fms-ai-title" aria-modal="false" className={props.embedded ? "absolute inset-y-0 right-0 z-40 flex w-[min(34rem,calc(100%-3.5rem))] flex-col border-l border-gold/30 bg-obsidian shadow-2xl" : "fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 flex max-h-[78dvh] flex-col rounded-t-2xl border border-gold/30 bg-obsidian shadow-2xl md:bottom-0 md:left-auto md:top-16 md:max-h-none md:w-[min(34rem,45vw)] md:rounded-none md:border-y-0 md:border-r-0"} role="dialog">
      <header className="border-b border-gold/15 px-4 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <Sparkles aria-hidden className="size-5 text-gold-secondary" />
          <h3 className="mr-auto text-base font-semibold text-white outline-none" id="fms-ai-title" ref={heading} tabIndex={-1}>FMS assistant</h3>
          <Button aria-label="Close FMS assistant" className="shrink-0 px-2" onClick={props.onClose} variant="ghost"><X className="size-5" /></Button>
        </div>
        <div aria-label="Assistant tools" className="mt-2 flex gap-1 rounded-xl border border-gold/20 bg-charcoal p-1" role="tablist">
          {tabs.map((item) => <button aria-selected={tab === item} className={cn("min-h-10 flex-1 rounded-lg px-2 text-sm font-semibold transition", tab === item ? "bg-gold text-on-gold" : "text-champagne")} key={item} onClick={() => setTab(item)} role="tab" type="button">
            {item === "check" ? `Check${errors ? ` (${errors})` : ""}` : item === "ask" ? "Ask" : item === "build" ? "Build" : "Run"}
          </button>)}
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
        {tab === "check" ? <>
          <p className="text-xs text-soft-grey">Checked by the app's own rules on your current, unsaved draft. No AI is used here.</p>
          <FmsAiFindingList definition={definition} findings={findings} onGoToStage={(finding) => finding.stageKey && props.onGoToStage(finding.stageKey, finding)} />
          <FmsAiRouteExplainer data={data} definition={definition} stageKey={props.selectedStageKey} />
        </> : null}

        {tab === "run" ? <FmsAiRunPicker candidates={props.runCandidates ?? []} consent={runConsent} onConsent={setRunConsent} onLoaded={setRun} /> : null}

        {tab !== "check" ? <>
          {tab === "build" && !conversation.turns.length ? <Notice>Describe the process in plain English or Hinglish. I may ask a few questions, then show the steps, people, Forms and deadlines for you to review. Nothing changes until you press Apply, and you still Save draft and Publish yourself.</Notice> : null}
          {tab === "ask" && !conversation.turns.length ? <Notice>Ask about this {readOnly ? "published version" : "draft"}{props.selectedStageKey ? ` — I'll focus on “${names.get(props.selectedStageKey) ?? props.selectedStageKey}”` : ""}. Answers are grounded in the app's checks; I cannot change anything.</Notice> : null}
          {!conversation.turns.length && tab !== "run" ? <div className="flex flex-wrap gap-2">{examples.map((example) => <button className="rounded-full border border-gold/25 px-3 py-1.5 text-left text-xs text-champagne hover:bg-gold/10" disabled={conversation.busy} key={example} onClick={() => setInput(example)} type="button">{example}</button>)}</div> : null}
          <ol aria-label="Assistant conversation" aria-live="polite" className="space-y-3">
            {conversation.turns.map((turn) => <li key={turn.id}><AssistantTurn {...props} onRegenerate={conversation.lastQuestion ? () => send(conversation.lastQuestion!) : undefined} onAnswer={(text) => setInput((current) => current ? `${current}\n${text}` : text)} turn={turn} /></li>)}
          </ol>
          {conversation.busy ? <p className="flex items-center gap-2 text-xs text-soft-grey" role="status"><Loader2 aria-hidden className="size-4 animate-spin" />{tab === "build" ? "Drafting the workflow and checking it…" : "Checking the workflow…"}</p> : null}
          <div ref={transcriptEnd} />
        </> : null}
      </div>

      {tab !== "check" ? <footer className="border-t border-gold/15 p-3">
        {tab === "run" && run && !runConsent ? <p className="mb-2 text-xs text-soft-grey">Tick the box above to include this run's records, or ask about the workflow only.</p> : null}
        <form className="flex items-end gap-2" onSubmit={(event) => { event.preventDefault(); send(); }}>
          <textarea aria-label={tab === "build" ? "Describe the workflow or change" : "Ask the FMS assistant"} className="field min-h-12 flex-1 resize-none" maxLength={2000} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={tab === "build" ? "Describe the process or the change…" : "Ask a question…"} rows={2} value={input} />
          {conversation.busy ? <Button aria-label="Cancel" onClick={conversation.cancel} type="button" variant="secondary"><Square className="size-4" /></Button>
            : <Button aria-label="Send" disabled={!input.trim()} type="submit"><SendHorizontal className="size-4" /></Button>}
        </form>
        <p className="mt-1 text-[11px] text-soft-grey">{settings.userDailyLimit ? `${Math.max(settings.userDailyLimit - settings.usedToday, 0)} of ${settings.userDailyLimit} AI requests left today (shown at open). ` : ""}AI answers can be wrong; the app's checks and the server decide.</p>
      </footer> : null}
    </aside>
  </>;
}

function AssistantTurn({ turn, definition, data, readOnly, canManageForms, onGoToStage, onApply, onCreateRevision, onRegenerate, onAnswer }: FmsAiPanelProps & { turn: FmsAiTurn; onRegenerate?: (() => void) | undefined; onAnswer: (text: string) => void }) {
  if (turn.role === "user") return <div className="ml-8 rounded-xl bg-gold/10 p-3 text-sm text-white"><p className="whitespace-pre-wrap">{turn.text}</p>{turn.runData ? <p className="mt-1 text-[11px] text-champagne">Run records included</p> : null}</div>;
  if (turn.role === "error") return <Notice tone={turn.code === "cancelled" ? "neutral" : "danger"}>{turn.text}</Notice>;
  const response: FmsAiResponse = turn.response;
  const names = new Map(definition.stages.map((stage) => [stage.key, stage.name]));
  return <div className="space-y-2 rounded-xl border border-gold/15 p-3 text-sm">
    <p className="whitespace-pre-wrap text-white">{response.message}</p>
    {response.runDataIncluded ? <p className="text-[11px] text-champagne">Answer used this run's records.</p> : null}
    {response.questions.length ? <ul className="space-y-2">{response.questions.map((question) => <li key={question.id}><p className="text-champagne">{question.question}</p><div className="mt-1 flex flex-wrap gap-1">{question.choices.map((choice) => <button className="rounded-full border border-gold/25 px-2 py-1 text-xs text-champagne hover:bg-gold/10" key={choice} onClick={() => onAnswer(`${question.question} ${choice}`)} type="button">{choice}</button>)}</div></li>)}</ul> : null}
    {response.evidence.length ? <ul className="space-y-1">{response.evidence.map((item, index) => <li className="text-xs text-soft-grey" key={index}><span className={cn("mr-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", item.basis === "indeterminate" ? "bg-charcoal text-soft-grey" : "bg-gold/15 text-gold-secondary")}>{BASIS_LABEL[item.basis]}</span>{item.stageKey && names.has(item.stageKey) ? <button className="mr-1 underline" onClick={() => onGoToStage(item.stageKey!)} type="button">{names.get(item.stageKey)}</button> : null}{item.text}</li>)}</ul> : null}
    {response.assumptions.length ? <details><summary className="cursor-pointer text-xs text-champagne">Assumptions ({response.assumptions.length})</summary><ul className="mt-1 list-disc pl-4 text-xs text-soft-grey">{response.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul></details> : null}
    {response.unresolvedItems.length ? <Notice>Still to decide: {response.unresolvedItems.join(" · ")}</Notice> : null}
    {response.suggestedFixes.map((fix, index) => <div className="space-y-2 rounded-lg border border-gold/20 p-2" key={index}>
      <p className="font-semibold text-white">Suggested fix: {fix.title}</p>
      {fix.steps.length ? <ol className="list-decimal pl-4 text-xs text-soft-grey">{fix.steps.map((step, stepIndex) => <li key={stepIndex}>{step}</li>)}</ol> : null}
      {fix.stageKey && names.has(fix.stageKey) ? <Button className="min-h-9 px-3 text-xs" onClick={() => onGoToStage(fix.stageKey!)} variant="secondary">Go to step <ArrowRight className="size-3" /></Button> : null}
      {fix.operations.length ? <FmsAiProposalReview current={definition} data={data} onApply={onApply} onCreateRevision={onCreateRevision} onRegenerate={onRegenerate} readOnly={readOnly} source={{ seed: `${response.requestId}:fix:${index}`, operations: fix.operations, baseDefinition: turn.baseDefinition, expectedFingerprint: null, title: "Preview this fix" }} /> : null}
    </div>)}
    {response.kind === "proposal" ? (response.proposedFingerprint
      ? <FmsAiProposalReview canManageForms={canManageForms ?? false} current={definition} data={data} formsToCreate={response.formsToCreate} onApply={onApply} onCreateRevision={onCreateRevision} onRegenerate={onRegenerate} readOnly={readOnly} source={{ seed: response.requestId, operations: response.operations, baseDefinition: turn.baseDefinition, expectedFingerprint: response.proposedFingerprint, title: "Review the proposed workflow" }} />
      : <Notice tone="danger">The proposal could not be applied, so nothing changed: {response.validationIssues.map((issue) => issue.message).join(" ")} Try rephrasing or answer the open questions.</Notice>) : null}
    {response.kind !== "proposal" && response.formsToCreate.length ? <FmsAiProposalReview canManageForms={canManageForms ?? false} current={definition} data={data} formsToCreate={response.formsToCreate} readOnly={readOnly} source={{ seed: response.requestId, operations: [], baseDefinition: turn.baseDefinition, expectedFingerprint: null, title: "Forms to create" }} /> : null}
    {response.usage ? <p className="text-[10px] text-soft-grey">{response.usage.model} · {response.usage.inputTokens.toLocaleString()} input / {response.usage.outputTokens.toLocaleString()} output tokens{response.usage.requests > 1 ? ` · ${response.usage.requests} requests` : ""}</p> : null}
  </div>;
}
