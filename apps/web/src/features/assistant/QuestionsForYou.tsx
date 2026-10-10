import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, MessageCircleQuestion } from "lucide-react";
import { KIARA_ESCALATION_REASON_LABELS } from "@jewelos/core";
import {
  KIARA_ANSWER_MAX_LENGTH,
  answerKiaraEscalation,
  listKiaraEscalations,
  type KiaraEscalationItem,
} from "@jewelos/data/assistant/escalations";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";
import { useTenantRealtimeRefresh } from "@/features/realtime/useTenantRealtimeRefresh";

type View = "open" | "answered";

function age(value: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(value).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * "Questions for you" (assistant.answer_escalations): questions Kiara could
 * not answer that employees sent up, limited by the database to the people
 * this user may answer for. The first answer wins; it goes into the asker's
 * chat with the answerer's name. "Save to knowledge base" makes a suggested
 * document for Super Admin to review.
 */
export function QuestionsForYou({ focusId, list = listKiaraEscalations, answer = answerKiaraEscalation }: {
  /** Opened from a notification: this question is shown first and expanded. */
  focusId?: string | null | undefined;
  list?: typeof listKiaraEscalations;
  answer?: typeof answerKiaraEscalation;
}) {
  const { profile } = useAuth();
  const [view, setView] = useState<View>("open");
  const [items, setItems] = useState<KiaraEscalationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(focusId ?? null);

  const load = useCallback(async () => {
    try {
      setItems(await list(view));
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The questions could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [list, view]);
  useEffect(() => { void load(); }, [load]);
  useTenantRealtimeRefresh({ tenantId: profile?.tenant_id, topics: ["assistant"], refresh: load });
  useEffect(() => { if (focusId) setOpenId(focusId); }, [focusId]);

  const ordered = focusId ? [...items].sort((a, b) => Number(b.id === focusId) - Number(a.id === focusId)) : items;
  const focusedClosed = focusId && view === "open" && !loading && !items.some((item) => item.id === focusId);

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2">
      {(["open", "answered"] as const).map((value) => <button aria-pressed={view === value} className={`min-h-9 rounded-lg border px-3 text-sm font-semibold ${view === value ? "border-task-accent bg-task-accent-soft text-task-text" : "border-task-border text-task-text hover:bg-task-muted"}`} key={value} onClick={() => { setLoading(true); setView(value); }} type="button">
        {value === "open" ? "Waiting for an answer" : "Answered"}
      </button>)}
      <p className="text-xs text-task-text-muted">Questions Kiara could not answer, sent by people you look after. Only you and others above them can see these.</p>
    </div>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {focusedClosed ? <Notice tone="task">That question is no longer waiting: it was answered or withdrawn. See "Answered" for answers.</Notice> : null}
    {loading ? <p className="flex items-center gap-2 text-sm text-task-text-muted"><Loader2 aria-hidden className="size-4 animate-spin" />Loading…</p> : null}
    {!loading && items.length === 0 ? <p className="text-sm text-task-text-muted">{view === "open" ? "No questions are waiting for you." : "No answered questions yet."}</p> : null}
    <ul className="space-y-3">
      {ordered.map((item) => <li className={`rounded-xl border p-3 sm:p-4 ${item.id === focusId ? "border-task-accent" : "border-task-border"}`} key={item.id}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-task-text-muted">
          <span className="font-semibold text-task-text">{item.asker_name}</span>
          {item.asker_designation ? <span>{item.asker_designation}</span> : null}
          {item.department ? <span>· {item.department}</span> : null}
          {item.branch ? <span>· {item.branch}</span> : null}
          <span>· {age(item.created_at)}</span>
          <span className="rounded-full border border-task-border px-2">{KIARA_ESCALATION_REASON_LABELS[item.reason]}</span>
        </div>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm text-task-text">{item.question}</p>
        {item.summary ? <p className="mt-1 text-xs text-task-text-muted">Kiara's summary: {item.summary}</p> : null}
        {item.status === "answered" ? <div className="mt-3 rounded-lg bg-task-muted p-3 text-sm text-task-text">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-success"><CheckCircle2 aria-hidden className="size-4" />Answered by {item.answered_by ?? "someone"}{item.answered_at ? ` · ${age(item.answered_at)}` : ""}{item.saved_document_id ? " · saved for review in the knowledge base" : ""}</p>
          <p className="mt-1 whitespace-pre-wrap break-words">{item.answer}</p>
        </div> : null}
        {item.status === "open" ? openId === item.id
          ? <AnswerForm answer={answer} item={item} onCancel={() => setOpenId(null)} onDone={() => { setOpenId(null); void load(); }} />
          : <Button className="mt-3 min-h-9" onClick={() => setOpenId(item.id)} type="button"><MessageCircleQuestion aria-hidden className="size-4" />Answer</Button>
          : null}
      </li>)}
    </ul>
  </div>;
}

function AnswerForm({ answer, item, onCancel, onDone }: { answer: typeof answerKiaraEscalation; item: KiaraEscalationItem; onCancel: () => void; onDone: () => void }) {
  const [text, setText] = useState("");
  const [save, setSave] = useState(false);
  const [title, setTitle] = useState(item.summary ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!text.trim()) return setError("Write an answer first.");
    setBusy(true);
    setError(null);
    try {
      await answer({ escalationId: item.id, answer: text, saveToKnowledgeBase: save, knowledgeTitle: title });
      onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The answer could not be sent.");
    } finally {
      setBusy(false);
    }
  };
  return <div className="mt-3 space-y-2">
    <label className="block">
      <span className="text-xs font-semibold text-task-text-muted">Your answer (goes into {item.asker_name}'s chat with your name)</span>
      <textarea className="task-field mt-1 min-h-28 w-full" maxLength={KIARA_ANSWER_MAX_LENGTH} onChange={(event) => setText(event.target.value)} value={text} />
    </label>
    <label className="flex items-center gap-2 text-sm text-task-text">
      <input checked={save} onChange={(event) => setSave(event.target.checked)} type="checkbox" />
      Save to knowledge base (Super Admin reviews it before Kiara uses it)
    </label>
    {save ? <label className="block">
      <span className="text-xs font-semibold text-task-text-muted">Title for the knowledge base</span>
      <input className="task-field mt-1 w-full" maxLength={200} onChange={(event) => setTitle(event.target.value)} value={title} />
    </label> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <div className="flex flex-wrap justify-end gap-2">
      <Button className="border-task-border bg-task-bg text-task-text hover:bg-task-muted" onClick={onCancel} type="button" variant="secondary">Cancel</Button>
      <Button disabled={busy || !text.trim()} onClick={() => void submit()} type="button">{busy ? <Loader2 aria-hidden className="size-4 animate-spin" /> : null}Send answer</Button>
    </div>
  </div>;
}
