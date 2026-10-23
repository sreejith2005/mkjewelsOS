import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CircleAlert, Lightbulb } from "lucide-react";
import { diagnoseFmsDefinition, explainFmsRoute, fmsFieldOptions, type FmsDiagnosticFinding, type FmsFlowDefinition } from "@jewelos/core";
import { Button, Field, Notice } from "@/components/ui";
import type { FmsData } from "../api";
import { fmsDiagnosticCatalogFromData } from "./catalog";

const SEVERITY = {
  error: { label: "Must fix", icon: CircleAlert, tone: "border-danger/40 bg-danger/5 text-danger" },
  warning: { label: "Check", icon: AlertTriangle, tone: "border-gold/40 bg-gold/5 text-gold-secondary" },
  suggestion: { label: "Suggestion", icon: Lightbulb, tone: "border-gold/15 bg-charcoal text-champagne" },
} as const;

export function FmsAiFindingList({ findings, definition, onGoToStage }: { findings: readonly FmsDiagnosticFinding[]; definition: FmsFlowDefinition; onGoToStage: (finding: FmsDiagnosticFinding) => void }) {
  if (!findings.length) return <Notice tone="success">No problems found. The server checks everything again when you publish.</Notice>;
  const names = new Map(definition.stages.map((stage) => [stage.key, stage.name]));
  return <ul aria-label="Workflow check results" className="space-y-2">
    {findings.map((finding) => {
      const style = SEVERITY[finding.severity]; const Icon = style.icon;
      return <li className={`rounded-xl border p-3 text-sm ${style.tone}`} key={finding.id}>
        <div className="flex items-start gap-2"><Icon aria-hidden className="mt-0.5 size-4 shrink-0" /><div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide">{style.label}{finding.stageKey ? ` · ${names.get(finding.stageKey) ?? finding.stageKey}` : ""}</p>
          <p className="font-semibold text-white">{finding.title}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-soft-grey">{finding.evidence.map((line, index) => <li key={index}>{line}</li>)}</ul>
          {finding.fix ? <p className="mt-1 text-xs text-champagne">Fix: {finding.fix}</p> : null}
        </div></div>
        {finding.stageKey && names.has(finding.stageKey) ? <Button className="mt-2 min-h-9 px-3 text-xs" onClick={() => onGoToStage(finding)} variant="secondary">Go to step <ArrowRight className="size-3" /></Button> : null}
      </li>;
    })}
  </ul>;
}

/** "What happens if the user selects X?" for the selected step, answered by the engine's own route resolver. */
export function FmsAiRouteExplainer({ definition, data, stageKey }: { definition: FmsFlowDefinition; data: FmsData; stageKey: string | null }) {
  const stage = definition.stages.find((item) => item.key === stageKey);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [outcome, setOutcome] = useState("");
  if (!stage || (!stage.branchRules.length && !stage.defaultNextStageKey)) return null;
  const fields = stage.formTemplateId ? (data.formFields[stage.formTemplateId] ?? []) : [];
  const routed = [...new Set(stage.branchRules.flatMap((rule) => rule.source === "form_answer" && rule.sourceKey ? [rule.sourceKey] : []))].map((key) => fields.find((field) => field.key === key) ?? { key, label: key });
  const explanation = explainFmsRoute(definition, stage.key, { answers, outcome: outcome || null }, data.formFields);
  return <section aria-label="What happens if" className="space-y-2 rounded-xl border border-gold/20 p-3">
    <h4 className="text-sm font-semibold text-white">What happens if… <span className="font-normal text-soft-grey">({stage.name})</span></h4>
    {routed.map((field) => {
      const options = fmsFieldOptions(field);
      return <Field key={field.key} label={field.label}>{options.length
        ? <select className="field" onChange={(event) => setAnswers((current) => ({ ...current, [field.key]: event.target.value }))} value={answers[field.key] ?? ""}><option value="">Left blank</option>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
        : <input className="field" onChange={(event) => setAnswers((current) => ({ ...current, [field.key]: event.target.value }))} value={answers[field.key] ?? ""} />}</Field>;
    })}
    {stage.sla.decisionOptions?.length ? <Field label="Decision"><select className="field" onChange={(event) => setOutcome(event.target.value)} value={outcome}><option value="">No decision yet</option>{stage.sla.decisionOptions.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}</select></Field> : null}
    {explanation ? <div className="space-y-1 text-xs">
      <ol className="space-y-1">{explanation.evaluations.map((evaluation) => <li className={evaluation.ruleId === explanation.chosenRuleId ? "text-success" : "text-soft-grey"} key={evaluation.ruleId}>{evaluation.order + 1}. {evaluation.label}: {evaluation.questionLabel ?? evaluation.source} {evaluation.operator.replaceAll("_", " ")} {evaluation.expected} — answer {evaluation.actual} → {evaluation.matched ? "matches" : "no match"}</li>)}</ol>
      <p className="font-semibold text-white">{explanation.nextStageName ? `Next: ${explanation.nextStageName}` : "Next: the workflow completes (if no other branch is open)"}{explanation.viaFallback && explanation.evaluations.length ? " (fallback)" : ""}</p>
      <p className="text-soft-grey">{explanation.note} Simulation only; it creates no work.</p>
    </div> : null}
  </section>;
}

export function useFmsDiagnostics(definition: FmsFlowDefinition, data: FmsData) {
  return useMemo(() => diagnoseFmsDefinition(definition, fmsDiagnosticCatalogFromData(data)), [data, definition]);
}
