import type { FormProvenance } from "./historyApi";
export const FORM_ORIGIN_LABELS: Readonly<Record<string, string>> = { library: "Forms Library", forms_library: "Forms Library", fms: "Created in FMS", ai_import: "AI HTML Import", duplicate: "Copied from another form", legacy_unknown: "Earlier form — creation source unavailable" };
export function FormOriginLabel({ provenance }: { provenance?: FormProvenance | undefined }) {
  if (!provenance) return <p className="text-xs text-soft-grey">Creation source unavailable</p>;
  return <div className="mb-3 space-y-1 text-xs text-soft-grey"><p className="font-medium text-champagne">Origin: {FORM_ORIGIN_LABELS[provenance.origin] ?? "Creation source unavailable"}</p>
    {provenance.source_flow_name ? <p>Workflow: {provenance.source_flow_name}{provenance.source_stage_name ? ` · Stage: ${provenance.source_stage_name}` : ""}</p> : provenance.origin === "fms" ? <p>{provenance.source_deleted ? "Originally created in FMS — source workflow no longer available." : "Originally created in FMS — source workflow unavailable in your access."}</p> : null}
    {provenance.source_flow_id ? <a className="inline-flex min-h-11 items-center text-gold-secondary underline" href={`/fms?flow=${encodeURIComponent(provenance.source_flow_id)}`}>Open Source FMS</a> : null}
    {provenance.used_in_fms ? <p>Used in FMS{provenance.workflows?.length ? `: ${provenance.workflows.map(flow => `${flow.name}${flow.stage_name ? ` / ${flow.stage_name}` : ""}${flow.active_instances ? ` (${flow.active_instances} active runs)` : ""}`).join(", ")}` : ""}</p> : null}
  </div>;
}
