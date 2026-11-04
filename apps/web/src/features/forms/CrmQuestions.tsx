// CRM question types in the shared form renderer (owner request 2026-11-03): a repeating group,
// a CRM photo / video upload, and the branch choice lists. They need what CRM gives a form it
// opens (FormCrmServices); anywhere else they explain that they only work in CRM forms.
import { useRef, useState } from "react";
import { Camera, Paperclip, X } from "lucide-react";
import { formRepeatRowCount, isFormCrmFilesAnswer, isFormRepeatAnswer, type FormAnswer, type FormCrmFile, type FormCrmServices, type FormFieldDefinition, type FormRepeatAnswer, type FormRepeatRow } from "@jewelos/core";
import { Notice } from "@/components/ui";

const IMAGE_TYPES = ".jpg,.jpeg,.png,.webp,.heic,.heif";
const VIDEO_TYPES = ".mp4,.webm,.mov";
const ALLOWED_IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const ALLOWED_VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime"]);
export const CRM_ONLY_NOTICE = "This question works in CRM forms only.";

/** "How many?" followed by one set of row questions per person or item. */
export function RepeatField({ field, value, disabled, onChange, registerRef }: { field: FormFieldDefinition; value: FormAnswer | undefined; disabled: boolean; onChange: (value: FormRepeatAnswer) => void; registerRef: (node: HTMLElement | null) => void; labelId?: string }) {
  const config = field.validation?.repeat;
  if (!config) return <Notice tone="danger">This repeating group has no questions per row yet.</Notice>;
  const answer: FormRepeatAnswer = isFormRepeatAnswer(value) ? value : { kind: "repeat", count: "", rows: [] };
  const size = formRepeatRowCount(answer);
  const counts = Array.from({ length: config.max - config.min + 1 }, (_, index) => String(config.min + index));
  const setCount = (count: string) => {
    const next = count === "NA" ? 0 : Number(count) || 0;
    onChange({ kind: "repeat", count, rows: Array.from({ length: next }, (_, index) => answer.rows[index] ?? {}) });
  };
  const setCell = (rowIndex: number, key: string, text: string) => onChange({ ...answer, rows: Array.from({ length: size }, (_, index): FormRepeatRow => index === rowIndex ? { ...(answer.rows[index] ?? {}), [key]: text } : answer.rows[index] ?? {}) });
  return <div className="space-y-3">
    <label className="block max-w-xs"><span className="mb-1 block text-sm text-task-text-muted">{config.countLabel}</span>
      <select aria-label={config.countLabel} className="field" disabled={disabled} onChange={(event) => setCount(event.target.value)} ref={registerRef} value={answer.count}>
        <option value="">Choose</option>
        {counts.map((count) => <option key={count} value={count}>{count}</option>)}
        {config.allowNa ? <option value="NA">NA</option> : null}
      </select>
    </label>
    {size > 0 ? <ol className="space-y-2">{Array.from({ length: size }, (_, rowIndex) => <li className="rounded-xl border border-task-border bg-task-muted/40 p-3" key={rowIndex}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-task-text-muted">{field.label} {rowIndex + 1}</p>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{config.fields.map((sub) => {
        const cell = answer.rows[rowIndex]?.[sub.key] ?? "";
        const label = `${sub.label} ${rowIndex + 1}`;
        return <label className="block min-w-0" key={sub.key}><span className="mb-1 block text-sm text-task-text">{sub.label}{sub.required ? <span aria-hidden="true" className="ml-1 text-danger">*</span> : null}</span>
          {sub.type === "select"
            ? <select aria-label={label} className="field" disabled={disabled} onChange={(event) => setCell(rowIndex, sub.key, event.target.value)} value={cell}><option value="">Choose</option>{(sub.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
            : <input aria-label={label} autoComplete="off" className="field" disabled={disabled} inputMode={sub.type === "phone" ? "tel" : undefined} onChange={(event) => setCell(rowIndex, sub.key, event.target.value)} type={sub.type === "phone" ? "tel" : "text"} value={cell} />}
        </label>;
      })}</div>
    </li>)}</ol> : null}
  </div>;
}

/** Photos (and, when allowed, videos) uploaded straight to CRM documents storage. */
export function CrmPhotoField({ field, value, disabled, crm, onChange, onBusyChange, registerRef, describedBy }: { field: FormFieldDefinition; value: FormAnswer | undefined; disabled: boolean; crm: FormCrmServices | undefined; onChange: (value: FormAnswer) => void; onBusyChange: (busy: boolean) => void; registerRef: (node: HTMLElement | null) => void; describedBy?: string | undefined }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement | null>(null);
  if (!crm?.upload || !crm.remove) return <Notice>{CRM_ONLY_NOTICE}</Notice>;
  const upload = crm.upload; const removeFile = crm.remove;
  const video = field.validation?.crm?.video === true;
  const max = field.validation?.crm?.maxFiles ?? 1;
  const files: readonly FormCrmFile[] = isFormCrmFilesAnswer(value) ? value.files : [];
  const choose = async (file: File | undefined) => {
    if (!file) return;
    const type = file.type.toLowerCase();
    if (!ALLOWED_IMAGE_MIME.has(type) && !(video && ALLOWED_VIDEO_MIME.has(type))) { setError(`Use a JPEG, PNG, WebP, HEIC or HEIF image${video ? ", or an MP4, MOV or WebM video" : ""}.`); return; }
    if (file.size > 10 * 1024 * 1024) { setError("The file must be 10MB or smaller."); return; }
    setUploading(true); onBusyChange(true); setError(null);
    try {
      const uploaded = await upload(field.key, file, { video });
      onChange({ kind: "crm_files", files: max === 1 ? [uploaded] : [...files, uploaded].slice(0, max) });
      if (max === 1 && files[0]) void removeFile(files[0]).catch(() => undefined);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Upload failed. Try again."); }
    finally { setUploading(false); onBusyChange(false); }
  };
  const remove = async (file: FormCrmFile) => {
    onChange({ kind: "crm_files", files: files.filter((item) => item.path !== file.path) });
    await removeFile(file).catch(() => undefined);
  };
  return <div className="space-y-2">
    {files.map((file) => <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-task-text" key={file.path}>
      <Paperclip aria-hidden className="size-4 shrink-0 text-success" /><span className="min-w-0 flex-1 break-words">{file.fileName} uploaded</span>
      <button aria-label={`Remove ${file.fileName}`} className="inline-flex size-9 items-center justify-center rounded-lg text-task-text-muted hover:bg-task-muted" disabled={disabled || uploading} onClick={() => void remove(file)} type="button"><X aria-hidden className="size-4" /></button>
    </div>)}
    {files.length < max ? <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gold/50 px-3 text-sm font-medium text-gold-secondary hover:bg-gold/5">
      <Camera aria-hidden className="size-4" />{uploading ? "Uploading…" : files.length ? "Add another" : video ? "Take or choose a photo or video" : "Take or choose a photo"}
      <input accept={video ? `${IMAGE_TYPES},${VIDEO_TYPES}` : IMAGE_TYPES} aria-describedby={describedBy} aria-label={field.label} capture="environment" className="sr-only" disabled={disabled || uploading} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; void choose(file); }} ref={(node) => { input.current = node; registerRef(node); }} type="file" />
    </label> : null}
    <p className="text-xs text-task-text-muted">{video ? "Photo or video" : "Photo"} up to 10MB{max > 1 ? ` · up to ${max} files` : ""}.</p>
    {error ? <p className="text-sm font-medium text-danger" role="alert">{error}</p> : null}
  </div>;
}

/** A short text question CRM answers from a list (the branch's salespeople or CRM on duty). */
export function CrmChoiceField({ choices, value, disabled, onChange, registerRef, aria }: { choices: readonly string[]; value: FormAnswer | undefined; disabled: boolean; onChange: (value: string) => void; registerRef: (node: HTMLElement | null) => void; aria: Readonly<Record<string, string | boolean | undefined>> }) {
  const current = typeof value === "string" ? value : "";
  return <select {...aria} className="field" disabled={disabled} onChange={(event) => onChange(event.target.value)} ref={registerRef} value={current}>
    <option value="">{choices.length ? "Choose" : "No one listed for this branch"}</option>
    {current && !choices.includes(current) ? <option value={current}>{current} (saved)</option> : null}
    {choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}
  </select>;
}
