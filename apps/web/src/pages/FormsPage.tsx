import { FmsStartingForm } from "@/features/forms/FmsStartingForm";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Archive, BookOpen, ChevronRight, ClipboardList, Copy, FileText, History, Pencil, Plus, Search, Send, Trash2, Workflow } from "lucide-react";
import { formatKolkataDateTime, groupFormSubmissions, type FmsBuiltForm, formMatchesLifecycle, hasPermission, presentFormSubmission, WORK_UPLOAD_FORM_NAME, type FormMasterOption, type SubmissionRecord, type SubmissionTemplate } from "@jewelos/core";
import { useAuth } from "@/auth/AuthContext";
import { Button, Modal, Notice } from "@/components/ui";
import { archiveForm, deletedFormBundle, deleteForm, formDeletionImpact, loadFmsBuiltForms, loadFormDynamicOptions, loadForms, publishAsNewForm, publishForm, reviseForm, reviewSubmission, type FormBundle, type FormDeletionImpact, type FormSubmission } from "@/features/forms/api";
import {loadFormSubmissionDetail} from "@jewelos/data/forms/api";
import { FormLibraryVisibility } from "@/features/forms/FormLibraryVisibility";
import { FormBuilder } from "@/features/forms/FormBuilder";
import { type DynamicOptions } from "@/features/forms/FormRenderer";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";
import { cn } from "@/lib/utils";

const EMPTY: DynamicOptions = { users: [], branches: [], departments: [], masters: [] };
const submissionRecord = (row: FormSubmission): SubmissionRecord => ({ id: row.id, formTemplateId: row.form_template_id, status: row.status, submittedAt: row.submitted_at, submittedBy: row.submitted_by, linkedModule: row.linked_module, linkedRecordId: row.linked_record_id, reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, reviewNotes: row.review_notes, answers: (row.data ?? {}) as Readonly<Record<string, unknown>> });
const submissionTemplate = (form: FormBundle): SubmissionTemplate => ({ id: form.id, familyId: form.family_id, name: form.name, version: form.version, fields: form.fields });

export function FormsPage() {
  const { access, profile } = useAuth(); const [data, setData] = useState<{ bundles: FormBundle[]; submissions: FormSubmission[] }>(); const [options, setOptions] = useState<DynamicOptions>(EMPTY); const [error, setError] = useState<string | null>(null); const [tab, setTab] = useState<"templates" | "submissions">("templates"); const [edit, setEdit] = useState<FormBundle | null | undefined>(); const [fill, setFill] = useState<FormBundle | null>(null); const [view, setView] = useState<FormSubmission | null>(null); const [query, setQuery] = useState(""); const [life, setLife] = useState("active"); const [remove, setRemove] = useState<FormBundle | null>(null); const [removed, setRemoved] = useState<FormDeletionImpact | null>(null);
  /** Form families built inside FMS workflow steps; null until known, and the split is hidden if they cannot be loaded. */
  const [built, setBuilt] = useState<ReadonlyMap<string, FmsBuiltForm> | null>(null);
  const [source, setSource] = useState<"library" | "fms">("library");
  const starter = useMemo(() => { const params = new URLSearchParams(window.location.search); const id = params.get("fmsStarter"); const formTemplateId = params.get("form"); return id && formTemplateId ? { id, formTemplateId } : null; }, []);
  const selectedSubmissionId=new URLSearchParams(window.location.search).get("submission_id");
  const refresh = useCallback(async () => { try { setError(null); const [forms, dynamic, fmsBuilt] = await Promise.all([loadForms(), loadFormDynamicOptions(), Promise.resolve().then(() => loadFmsBuiltForms()).catch(() => null)]); setBuilt(fmsBuilt); if(selectedSubmissionId){const detail=await loadFormSubmissionDetail(selectedSubmissionId);if(!detail)throw new Error("Submission unavailable in your authorized scope");forms.submissions=[detail.submission,...forms.submissions.filter(row=>row.id!==detail.submission.id)];if(detail.bundle&&!forms.bundles.some(bundle=>bundle.id===detail.bundle?.id))forms.bundles.push(detail.bundle);setView(detail.submission);setTab("submissions");}setData(forms); setOptions(dynamic); } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load Forms"); } }, [selectedSubmissionId]); useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (!starter || !data) return; const pinned = data.bundles.find((bundle) => bundle.id === starter.formTemplateId); if (pinned) setFill(pinned); }, [data, starter]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["forms", "tasks", "fms", "organization"], refresh });
  const author = hasPermission(access, "forms.manage"); const families = useMemo(() => { const groups = new Map<string, FormBundle[]>(); for (const item of data?.bundles ?? []) { if (!author && item.library_visible === false) continue; groups.set(item.family_id, [...(groups.get(item.family_id) ?? []), item]); } return [...groups.values()].map((items) => items.sort((a, b) => b.version - a.version)).filter((items) => items.some((item) => `${item.name} ${item.description ?? ""}`.toLowerCase().includes(query.toLowerCase()) && formMatchesLifecycle(item.lifecycle, life))).sort((a, b) => a[0]!.name.localeCompare(b[0]!.name)); }, [data, life, query, author]);
  const libraryFamilies = useMemo(() => families.filter((versions) => !built?.has(versions[0]!.family_id)), [built, families]);
  const fmsFamilies = useMemo(() => built ? families.filter((versions) => built.has(versions[0]!.family_id)) : [], [built, families]);
  if (!profile) return null;
  const runPublish = (id: string) => void publishForm(id).then(refresh).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Publish failed"));
  const runPublishAsNew = (id: string) => void publishAsNewForm(id).then(refresh).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Publish as separate form failed"));
  const runCreateVersion = (id: string) => void reviseForm(id).then(async (draftId) => {
    const next = await loadForms();
    setData(next);
    const draft = next.bundles.find((item) => item.id === draftId);
    if (!draft) throw new Error("The new version is not visible in Forms Library");
    setEdit(draft);
  }).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Create form version failed"));
  if (edit !== undefined) return <FormBuilder bundle={edit ?? undefined} dynamicOptions={options} onClose={() => setEdit(undefined)} onSaved={refresh} />;
  return <><section className="mx-auto max-w-5xl">
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0"><h1 className="font-display text-[1.85rem] font-semibold leading-tight text-gold-secondary sm:text-[2.1rem]">Forms Library</h1><p className="mt-1 text-sm text-soft-grey">Pick a form, answer the questions, and press Submit.</p></div>
      {author ? <Button className="min-h-12 w-full sm:w-auto" onClick={() => setEdit(null)}><Plus />New form</Button> : null}
    </header>
    <div aria-label="Forms views" className="mb-4 grid grid-cols-2 gap-1 rounded-2xl border border-task-border bg-task-muted p-1" role="group">
      {([["templates", "Forms to fill", ClipboardList], ["submissions", "My submissions", History]] as const).map(([key, label, Icon]) => <button aria-pressed={tab === key} className={cn("inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition", tab === key ? "bg-task-bg text-task-text shadow-sm ring-1 ring-gold/40" : "text-task-text-muted hover:text-task-text")} key={key} onClick={() => setTab(key)} type="button"><Icon aria-hidden="true" className="size-4" />{label}</button>)}
    </div>
    {tab === "templates" && built ? <div className="mb-4">
      <div aria-label="Which forms" className="grid grid-cols-2 gap-2" role="group">
        {([["library", "Forms Library", BookOpen, libraryFamilies.length], ["fms", "FMS workflow forms", Workflow, fmsFamilies.length]] as const).map(([key, label, Icon, count]) => <button aria-pressed={source === key} className={cn("flex min-h-14 items-center justify-center gap-2 rounded-2xl border-2 px-3 py-2 text-left text-sm font-semibold transition sm:justify-start sm:px-4", source === key ? "border-gold bg-gold/10 text-task-text" : "border-task-border bg-task-bg text-task-text-muted hover:border-gold/50 hover:text-task-text")} key={key} onClick={() => setSource(key)} type="button"><Icon aria-hidden="true" className={cn("size-5 shrink-0", source === key && "text-gold-secondary")} /><span className="min-w-0 leading-tight">{label}</span><span className={cn("ml-auto shrink-0 rounded-full px-2 py-0.5 text-xs", source === key ? "bg-gold/20 text-gold-secondary" : "bg-task-muted")}>{count}</span></button>)}
      </div>
      <p className="mt-2 px-1 text-sm text-task-text-muted">{source === "library" ? "Forms made here in Forms Library." : author ? "Questions built inside FMS workflow steps. People fill them through their workflow. To change one, open the workflow in FMS and edit that step's Questions & Form, so the workflow uses the new version." : "Forms that belong to FMS workflows. You fill them from Tasks → FMS when a step is assigned to you."}</p>
    </div> : null}
    {tab === "templates" ? <div className={cn("mb-5 grid gap-2", author && "sm:grid-cols-[1fr_auto]")}><label className="relative block"><Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-soft-grey" /><input aria-label="Search forms" className="field min-h-12 pl-10" enterKeyHint="search" onChange={(event) => setQuery(event.target.value)} placeholder="Search forms" type="search" value={query} /></label>{author ? <select aria-label="Lifecycle filter" className="field min-h-12 sm:w-56" onChange={(event) => setLife(event.target.value)} value={life}><option value="active">Current and drafts</option><option value="published">Published</option><option value="draft">Drafts</option><option value="archived">Archived history</option><option value="all">All lifecycle</option></select> : null}</div> : null}
    {error ? <div className="mb-4"><Notice tone="danger">{error === "Publish form: Form version is pinned by an active FMS stage" ? "This version is in an active FMS stage. Use Publish as separate form to preserve in-progress work and publish your edited copy." : error} <button className="underline" onClick={() => void refresh()} type="button">Retry</button></Notice></div> : null}
    {!data ? <div className="grid gap-3 sm:grid-cols-2"><div className="skeleton h-36 rounded-2xl" /><div className="skeleton h-36 rounded-2xl" /></div> : tab === "templates" ? <Library onVisibilitySaved={refresh} onVisibilityError={setError} author={author} built={built} emptyText={built && source === "fms" ? "No FMS workflow forms match. Forms built inside an FMS step appear here." : "No forms match these filters."} families={built && source === "fms" ? fmsFamilies : built ? libraryFamilies : families} onArchive={(id) => void archiveForm(id).then(refresh).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : "Archive failed"))} onCreateVersion={runCreateVersion} onDelete={setRemove} onEdit={setEdit} onFill={setFill} onPublish={runPublish} onPublishAsNew={runPublishAsNew} onEditPublished={(id) => { const form = data.bundles.find((item) => item.id === id); if (form?.lifecycle === "published") setEdit(form); else setError("Archived forms cannot be edited."); }} /> : <SubmissionList bundles={data.bundles} onView={setView} submissions={data.submissions} />}
  </section>
  {fill ? <Modal mobileFullscreen onClose={() => setFill(null)} title={fill.name} stickyHeader wide><div className="mx-auto max-w-2xl">{fill.description ? <p className="mb-4 px-1 text-sm text-soft-grey">{fill.description}</p> : null}<FmsStartingForm formId={fill.id} {...(starter ? { starterAssignmentId: starter.id } : {})} onSaved={refresh} definition={{ name: fill.name, description: fill.description ?? undefined, sections: fill.sections, fields: fill.fields }} dynamicOptions={options} initialAnswers={fill.name === WORK_UPLOAD_FORM_NAME ? { ...(new URLSearchParams(window.location.search).get("referenceNumber") ? { reference_number: new URLSearchParams(window.location.search).get("referenceNumber")! } : {}), ...(options.users.some((user) => user.id === profile.id) ? { crm_follow_up: profile.id } : {}) } : {}} templateId={fill.id} workflowHint /></div></Modal> : null}
  {remove ? <DeleteFormDialog form={remove} onCancel={() => setRemove(null)} onDeleted={(impact) => { setRemove(null); setRemoved(impact); void refresh(); }} /> : null}
  {removed ? <DeletedFormSummary impact={removed} onClose={() => setRemoved(null)} /> : null}
  {view ? <SubmissionDetails bundle={data!.bundles.find((item) => item.id === view.form_template_id)} canReview={author} masters={options.masters} users={options.users} branches={options.branches} departments={options.departments} onClose={() => {const params=new URLSearchParams(window.location.search);params.delete("submission_id");window.history.replaceState({},"",`${window.location.pathname}?${params}`);setView(null);}} onRefresh={refresh} submission={view} /> : null}</>;
}

const LAYOUT_FIELDS = new Set(["section_header", "divider"]);
const questionCount = (form: FormBundle) => form.fields.filter((field) => !LAYOUT_FIELDS.has(field.type)).length;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const LIFECYCLE_BADGE: Readonly<Record<string, { label: string; tone: string }>> = {
  published: { label: "Live", tone: "bg-success/15 text-success" },
  draft: { label: "Draft", tone: "bg-gold/15 text-gold-secondary" },
  archived: { label: "Archived", tone: "bg-task-muted text-task-text-muted" },
};
const roleList = (item: FormBundle) => Array.isArray((item.permissions as { roles?: unknown })?.roles) ? ((item.permissions as { roles: string[] }).roles.map((role) => role.replaceAll("_", " ")).join(", ") || "none") : "none";

function Library({ families, author, built, emptyText, onVisibilitySaved, onVisibilityError, onFill, onEdit, onPublish, onPublishAsNew, onEditPublished, onCreateVersion, onArchive, onDelete }: { families: FormBundle[][]; author: boolean; built: ReadonlyMap<string, FmsBuiltForm> | null; emptyText: string; onVisibilitySaved: () => Promise<void>; onVisibilityError: (message: string) => void; onFill: (item: FormBundle) => void; onEdit: (item: FormBundle) => void; onPublish: (id: string) => void; onPublishAsNew: (id: string) => void; onEditPublished: (id: string) => void; onCreateVersion: (id: string) => void; onArchive: (id: string) => void; onDelete: (item: FormBundle) => void }) {
  if (families.length === 0) return <Notice>{emptyText}</Notice>;
  return <div className={cn("grid gap-3", !author && "sm:grid-cols-2")}>{families.map((versions) => {
    const latest = versions[0]!;
    const live = versions.find((item) => item.lifecycle === "published");
    const shown = live ?? latest;
    const fms = built?.get(latest.family_id);
    return <article className="flex min-w-0 flex-col gap-3 rounded-2xl border border-task-border bg-task-bg p-4 shadow-sm sm:p-5" key={latest.family_id}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-xl bg-gold/10 text-gold-secondary"><FileText className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-semibold leading-snug text-task-text sm:text-lg">{latest.name}</h2>
          {latest.description ? <p className="mt-0.5 line-clamp-3 break-words text-sm text-task-text-muted">{latest.description}</p> : null}
          <p className="mt-1 text-xs text-task-text-muted">{plural(questionCount(shown), "question")}</p>
          {fms ? <p className="mt-2 inline-flex max-w-full items-start gap-1.5 rounded-lg bg-gold/10 px-2 py-1 text-xs text-gold-secondary"><Workflow aria-hidden="true" className="mt-px size-3.5 shrink-0" /><span className="min-w-0 break-words">{fms.workflows.length ? `FMS: ${fms.workflows.join(", ")}${fms.steps.length ? ` · Step: ${fms.steps.join(", ")}` : ""}` : "Built inside an FMS workflow"}</span></p> : null}
        </div>
      </div>
      {!author && live ? <Button className="min-h-12 w-full" onClick={() => onFill(live)} type="button"><Send />Fill form</Button> : null}
      {author ? <ul className="divide-y divide-task-border rounded-xl border border-task-border">{versions.map((item) => {
        const badge = LIFECYCLE_BADGE[item.lifecycle] ?? { label: item.lifecycle, tone: "bg-task-muted text-task-text-muted" };
        return <li className="space-y-3 p-3" key={item.id}>
          <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-semibold text-task-text">Version {item.version}</span><span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", badge.tone)}>{badge.label}</span><span className="text-xs text-task-text-muted">{plural(questionCount(item), "question")} · {plural(item.submissionCount, "submission")}</span></div>
          <p className="text-xs text-task-text-muted">Who can fill it: {roleList(item)}</p>
          <FormLibraryVisibility templateId={item.id} visible={item.library_visible !== false} onSaved={onVisibilitySaved} onError={onVisibilityError} />
          <div className="flex flex-wrap gap-2">
            {item.lifecycle === "published" ? <Button onClick={() => onFill(item)} type="button"><Send />Fill form</Button> : null}
            {item.lifecycle === "draft" ? <><Button onClick={() => onEdit(item)} type="button" variant="secondary"><Pencil />Edit</Button><Button onClick={() => onPublish(item.id)} type="button">Publish</Button><Button onClick={() => { if (window.confirm("Publish this edited version as a separate form? Active FMS stages will keep using the current version.")) onPublishAsNew(item.id); }} type="button" variant="secondary"><Copy />Publish as separate form</Button></> : null}
            {item.lifecycle === "published" ? <><Button onClick={() => onEditPublished(item.id)} type="button" variant="secondary"><Pencil />Edit</Button><Button onClick={() => onCreateVersion(item.id)} type="button" variant="secondary"><Copy />Create new version</Button></> : null}
            <Button onClick={() => onDelete(item)} type="button" variant="danger"><Trash2 />Delete</Button>
            {item.lifecycle !== "archived" ? <Button onClick={() => { if (window.confirm("Archive this form version?")) onArchive(item.id); }} type="button" variant="danger"><Archive />Archive</Button> : null}
          </div>
        </li>;
      })}</ul> : null}
    </article>;
  })}</div>;
}
function SubmissionList({ bundles, submissions, onView }: { bundles: FormBundle[]; submissions: FormSubmission[]; onView: (item: FormSubmission) => void }) { const groups = groupFormSubmissions(submissions.map(submissionRecord), bundles.map(submissionTemplate), (record) => { const row = submissions.find((item) => item.id === record.id); const deleted = row ? deletedFormBundle(row) : null; return deleted ? submissionTemplate(deleted) : null; }, []); return <div className="grid gap-4">{groups.length === 0 ? <Notice>You have not submitted any forms yet.</Notice> : groups.map((group) => <section className="overflow-hidden rounded-2xl border border-task-border bg-task-bg" key={group.key}><header className="flex items-center justify-between gap-3 border-b border-task-border bg-task-muted/60 px-4 py-3"><h2 className="min-w-0 break-words font-semibold text-task-text">{group.title}</h2><span className="shrink-0 rounded-full bg-gold/10 px-2.5 py-1 text-xs font-semibold text-gold-secondary">{group.items.length} filled</span></header><div className="divide-y divide-task-border">{group.items.map((item) => <button className="flex min-h-16 w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-gold/5" key={item.id} onClick={() => { const row = submissions.find((submission) => submission.id === item.id); if (row) onView(row); }} type="button"><span className="min-w-0 flex-1"><span className="block text-sm font-medium text-task-text">{item.submittedAt ? formatKolkataDateTime(item.submittedAt) : "Submitted"}</span><span className="block text-xs text-task-text-muted">{item.linkedModule ? `Part of ${LINKED_MODULES[item.linkedModule] ?? item.linkedModule.replaceAll("_", " ")}` : "Filled from Forms Library"}</span></span><span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", STATUS_TONE[item.status] ?? "bg-task-muted text-task-text-muted")}>{submissionStatus(item.status)}</span><ChevronRight aria-hidden="true" className="size-4 shrink-0 text-task-text-muted" /></button>)}</div></section>)}</div>; }
const SUBMISSION_STATUS: Readonly<Record<string, string>> = { submitted: "Submitted", approved: "Approved", rejected: "Rejected", draft: "Draft" };
const STATUS_TONE: Readonly<Record<string, string>> = { submitted: "bg-gold/10 text-gold-secondary", approved: "bg-success/15 text-success", rejected: "bg-danger/10 text-danger" };
const submissionStatus = (status: string) => SUBMISSION_STATUS[status] ?? (status ? status[0]!.toUpperCase() + status.slice(1).replaceAll("_", " ") : "Unknown");
const LINKED_MODULES: Readonly<Record<string, string>> = { fms: "an FMS workflow", task: "a task", tasks: "a task", crm: "the CRM" };
function SubmissionDetails({ submission, bundle, canReview, masters, users, branches, departments, onClose, onRefresh }: { submission: FormSubmission; bundle?: FormBundle | undefined; canReview: boolean; masters: readonly FormMasterOption[]; users: readonly { id: string; label: string }[]; branches: readonly { id: string; label: string }[]; departments: readonly { id: string; label: string }[]; onClose: () => void; onRefresh: () => Promise<void> }) {
  const personName = (id: string | null) => id ? users.find((user) => user.id === id)?.label ?? "Historical employee" : "Unknown"; const [decision, setDecision] = useState<"approved" | "rejected" | null>(null); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const review = async () => { if (!decision || !window.confirm(`Confirm ${decision} submission?`)) return; setBusy(true); try { await reviewSubmission(submission.id, decision, notes); await onRefresh(); onClose(); } catch (caught) { setError(caught instanceof Error ? caught.message : "Review failed"); } finally { setBusy(false); } }; const snapshot = deletedFormBundle(submission); const presented = presentFormSubmission(submissionRecord(submission), bundle ? submissionTemplate(bundle) : null, snapshot ? submissionTemplate(snapshot) : null, masters, users, { branches: new Map(branches.map((item) => [item.id, item.label])), departments: new Map(departments.map((item) => [item.id, item.label])) }); return <Modal mobileFullscreen onClose={onClose} title={presented.templateUnavailable ? "Submission details" : presented.title} wide><div className="mx-auto max-w-2xl space-y-4"><div className="rounded-2xl border border-task-border bg-task-muted/50 p-3 text-sm text-task-text-muted"><p>Filled by <strong className="text-task-text">{personName(submission.submitted_by)}</strong>{submission.submitted_at ? ` on ${formatKolkataDateTime(submission.submitted_at)}` : ""}</p><p className="mt-1 flex flex-wrap items-center gap-2"><span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", STATUS_TONE[submission.status] ?? "bg-task-muted text-task-text-muted")}>{submissionStatus(submission.status)}</span>{submission.linked_module ? <span>Part of {LINKED_MODULES[submission.linked_module] ?? submission.linked_module.replaceAll("_", " ")}</span> : null}</p></div>{presented.templateUnavailable ? <Notice tone="danger">This submission belongs to a form version your account can no longer open, so its answers are not shown. They are not matched to a different version.</Notice> : <dl className="divide-y divide-task-border overflow-hidden rounded-2xl border border-task-border bg-task-bg">{presented.answers.map((answer) => <div className="px-4 py-3" key={answer.key}><dt className="text-sm text-task-text-muted">{answer.label}</dt><dd className="mt-0.5 min-w-0 whitespace-pre-wrap break-words text-base font-medium text-task-text">{answer.display || <span className="font-normal italic text-task-text-muted">Not answered</span>}</dd></div>)}</dl>}{submission.reviewed_by || submission.reviewed_at ? <p className="text-sm text-soft-grey">Reviewed by {personName(submission.reviewed_by)}{submission.reviewed_at ? ` · ${formatKolkataDateTime(submission.reviewed_at)}` : ""}</p> : null}{submission.review_notes ? <Notice>{submission.review_notes}</Notice> : null}{error ? <Notice tone="danger">{error}</Notice> : null}{canReview && submission.status === "submitted" ? <div className="rounded-2xl border border-task-border p-3"><label className="label" htmlFor="submission-review-notes">Optional review notes</label><textarea className="field" id="submission-review-notes" onChange={(event) => setNotes(event.target.value)} value={notes} /><div className="mt-3 flex flex-wrap gap-2"><Button className="min-h-12" disabled={busy} onClick={() => setDecision("approved")} type="button">Approve</Button><Button className="min-h-12" disabled={busy} onClick={() => setDecision("rejected")} type="button" variant="danger">Reject</Button>{decision ? <Button className="min-h-12" disabled={busy} onClick={() => void review()} type="button" variant="secondary">{busy ? "Reviewing" : `Confirm ${decision}`}</Button> : null}</div></div> : null}</div></Modal>; }

/** Workflows are the only reference that cannot quietly carry on, so they are named one by one. */
function FlowConsequences({ flows, tense }: { flows: FormDeletionImpact["flows"]; tense: "will" | "did" }) {
  if (flows.length === 0) return null;
  return <div className="rounded-xl border border-gold/30 bg-gold/5 p-3">
    <p className="flex items-center gap-2 text-sm font-semibold text-gold-secondary"><AlertTriangle className="size-4" />{flows.length === 1 ? "This form is part of a workflow" : `This form is part of ${flows.length} workflows`}</p>
    <ul className="mt-2 space-y-2 text-sm text-champagne">{flows.map((flow) => <li key={flow.id}>
      <span className="font-medium text-white">{flow.name} v{flow.version}</span>
      {flow.stages?.length ? <span className="text-soft-grey"> · {flow.stages.join(", ")}</span> : null}
      <p className="text-xs text-soft-grey">{flow.action === "reverted_to_draft"
        ? tense === "will"
          ? "Goes off the air and waits as a draft. Pick a replacement form for that step, then publish it again."
          : "Went off the air and is waiting as a draft. Pick a replacement form for that step, then publish it again."
        : flow.action === "archived"
          ? tense === "will"
            ? "Is archived, because this workflow already has a draft being edited. Fix that draft and publish it."
            : "Was archived, because this workflow already had a draft being edited. Fix that draft and publish it."
          : tense === "will"
            ? "Loses the form on that step. It is not published, so nothing live changes."
            : "Lost the form on that step. It was not published, so nothing live changed."}
        {flow.activeInstances > 0 ? ` ${flow.activeInstances} run${flow.activeInstances === 1 ? "" : "s"} retain their stage IDs. A form step with no form needs an explicit replacement before those runs can progress.` : ""}</p>
    </li>)}</ul>
  </div>;
}

/** The warning before deleting: exactly what the server is about to do. */
function DeleteFormDialog({ form, onCancel, onDeleted }: { form: FormBundle; onCancel: () => void; onDeleted: (impact: FormDeletionImpact) => void }) {
  const [impact, setImpact] = useState<FormDeletionImpact | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; setError(null); formDeletionImpact(form.id).then((next) => { if (live) setImpact(next); }).catch((caught: unknown) => { if (live) setError(caught instanceof Error ? caught.message : "Unable to check this form"); }); return () => { live = false; }; }, [form.id]);
  const confirm = async () => { setBusy(true); setError(null); try { onDeleted(await deleteForm(form.id)); } catch (caught) { setError(caught instanceof Error ? caught.message : "Delete failed"); setBusy(false); } };
  const tasks = impact ? impact.tasks + impact.taskTemplates : 0;
  return <Modal onClose={onCancel} title={`Delete ${form.name} (v${form.version})?`}>
    <div className="space-y-4">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {!impact && !error ? <div className="h-24 animate-pulse rounded-xl bg-charcoal" /> : null}
      {impact ? <>
        <p className="text-sm text-soft-grey">This removes the form itself. It cannot be undone.</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-champagne">
          <li>{impact.submissions === 0 ? "Nobody has filled this form in." : `${impact.submissions} submission${impact.submissions === 1 ? "" : "s"} stay and stay readable — each one keeps its own copy of this form.`}</li>
          {tasks > 0 ? <li>{tasks} task{tasks === 1 ? "" : "s"} stop asking for this form and can be completed without it.</li> : null}
          {impact.starterAssignments > 0 ? <li>{impact.starterAssignments} pending workflow starter{impact.starterAssignments === 1 ? "" : "s"} are withdrawn.</li> : null}
        </ul>
        <FlowConsequences flows={impact.flows} tense="will" />
      </> : null}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || !impact} onClick={() => void confirm()} type="button" variant="danger"><Trash2 />{busy ? "Deleting" : "Delete this form"}</Button>
        <Button onClick={onCancel} type="button" variant="secondary">Keep it</Button>
      </div>
    </div>
  </Modal>;
}

/** The same report once it has actually happened, so a workflow needing reconfiguration is not missed. */
function DeletedFormSummary({ impact, onClose }: { impact: FormDeletionImpact; onClose: () => void }) {
  return <Modal onClose={onClose} title={`${impact.form.name} was deleted`}>
    <div className="space-y-4">
      <p className="text-sm text-soft-grey">{impact.submissions === 0 ? "The form is gone." : `The form is gone. Its ${impact.submissions} submission${impact.submissions === 1 ? "" : "s"} remain under My submissions and still show the questions that were answered.`}</p>
      <FlowConsequences flows={impact.flows} tense="did" />
      {impact.flows.some((flow) => flow.action !== "unchanged") ? <Notice tone="danger">Open FMS to give the affected step a new form, then publish the workflow again. Until then it will not start.</Notice> : null}
      <Button onClick={onClose} type="button">Done</Button>
    </div>
  </Modal>;
}
