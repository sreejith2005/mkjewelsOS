import { useCallback, useEffect, useMemo, useState } from "react";
import { countLeaveDays, hasPermission, leaveInformStatus, type LeaveHalf, type ReturnHalf } from "@jewelos/core";
import { canSubmitLeave, editPendingLeave, leaveHandoverCandidates, leaveTypes, listLeaveRequests, reviewLeave, signedLeaveImage, submitHandover, submitLeave, type LeaveDraft, type LeaveRequest } from "@jewelos/data/leave/api";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";

const durations: LeaveHalf[] = ["FULL DAY", "1ST HALF", "2ND HALF"];
const halves: ReturnHalf[] = ["1ST HALF", "2ND HALF"];
const emptyDraft: LeaveDraft = { leaveType: "", duration: "FULL DAY", reason: "", leaveStart: "", leaveEnd: "", workStartDate: "", workStartIn: "1ST HALF" };

export function LeaveApplications() {
  const { access, profile } = useAuth();
  const canReview = hasPermission(access, "availability.review_leave") && hasPermission(access, "availability.manage_others");
  const [canApply, setCanApply] = useState<boolean | null>(null);
  const [tab, setTab] = useState<"apply" | "history" | "review">("apply");
  const [types, setTypes] = useState<Array<{ value: string; label: string }>>([]);
  const [people, setPeople] = useState<Array<{ id: string; employee_name: string }>>([]);
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [draft, setDraft] = useState<LeaveDraft>(emptyDraft);
  const [tlImage, setTlImage] = useState<File | null>(null);
  const [handoverId, setHandoverId] = useState<string | null>(null);
  const [handoverTo, setHandoverTo] = useState("");
  const [handoverImage, setHandoverImage] = useState<File | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDates, setEditDates] = useState({ leaveStart: "", leaveEnd: "", workStartDate: "", workStartIn: "1ST HALF" as ReturnHalf });
  const [remark, setRemark] = useState("");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!profile) return;
    try {
      const [ownRows, reviewRows, nextTypes, nextPeople, applicantEligible] = await Promise.all([
        listLeaveRequests(profile.id), canReview ? listLeaveRequests(undefined, "pending") : Promise.resolve([]),
        leaveTypes(), leaveHandoverCandidates(), canSubmitLeave(),
      ]);
      setRows([...ownRows, ...reviewRows.filter((row) => row.applicant_id !== profile.id)]);
      setTypes(nextTypes); setPeople(nextPeople);
      setCanApply(applicantEligible);
      if (!applicantEligible) setTab((current) => current === "apply" ? (canReview ? "review" : "history") : current);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Unable to load leave requests"); }
  }, [canReview, profile]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [load]);

  const myRows = useMemo(() => rows.filter((row) => row.applicant_id === profile?.id), [rows, profile?.id]);
  const totals = useMemo(() => myRows.reduce((result, row) => {
    result.total += row.total_leave_count;
    if (row.status === "pending" || row.status === "approved" || row.status === "rejected") result[row.status] += row.total_leave_count;
    return result;
  }, { total: 0, pending: 0, approved: 0, rejected: 0 }), [myRows]);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const preview = useMemo(() => {
    try {
      if (!draft.leaveStart || !draft.leaveEnd || !draft.workStartDate) return null;
      return { days: countLeaveDays(draft.duration, draft.leaveStart, draft.leaveEnd, draft.workStartDate, draft.workStartIn),
        notice: leaveInformStatus(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), draft.leaveStart, draft.leaveEnd) };
    } catch { return null; }
  }, [draft]);

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); await load(); setMessage(success); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Leave action failed"); }
    finally { setBusy(false); }
  };
  const openImage = async (path: string) => {
    try { window.open(await signedLeaveImage(path), "_blank", "noopener,noreferrer"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Image unavailable"); }
  };

  if (!profile) return null;
  return <section className="mb-6 space-y-4 rounded-xl border border-gold/25 bg-charcoal p-4 sm:p-5">
    <div><h2 className="font-display text-xl text-gold">Leave applications</h2><p className="text-sm text-soft-grey">Apply, complete your handover, and follow HR's decision.</p></div>
    {canApply !== null ? <div className="flex flex-wrap gap-2" role="tablist" aria-label="Leave applications">
      {([...(canApply ? ["apply"] : []), "history", ...(canReview ? ["review"] : [])] as Array<typeof tab>).map((item) => <Button key={item} onClick={() => setTab(item)} variant={tab === item ? "primary" : "secondary"}>{item === "apply" ? "Apply leave" : item === "history" ? "My leave summary" : "Review requests"}</Button>)}
    </div> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {message ? <Notice tone="success">{message}</Notice> : null}
    {tab === "apply" && canApply ? <form className="grid gap-4 rounded-xl border border-gold/15 p-4 sm:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      if (!tlImage) { setError("Attach the TL approval screenshot"); return; }
      void run(async () => { await submitLeave(draft, profile.tenant_id, profile.id, tlImage); setDraft(emptyDraft); setTlImage(null); setTab("history"); }, "Leave submitted. Complete handover from your summary.");
    }}>
      <p className="sm:col-span-2 text-sm text-soft-grey">{profile.employee_name} · Your signed in identity and branch are used.</p>
      <label className="text-sm">Type of leave<select className="task-field mt-1 w-full" required value={draft.leaveType} onChange={(e) => setDraft({ ...draft, leaveType: e.target.value })}><option value="">Select leave type</option>{types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
      <label className="text-sm">Leave duration<select className="task-field mt-1 w-full" value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: e.target.value as LeaveHalf })}>{durations.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-sm sm:col-span-2">Reason<textarea className="task-field mt-1 w-full" maxLength={1000} required value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></label>
      <label className="text-sm">Leave start<input className="task-field mt-1 w-full" required type="date" value={draft.leaveStart} onChange={(e) => setDraft({ ...draft, leaveStart: e.target.value })} /></label>
      <label className="text-sm">Leave end<input className="task-field mt-1 w-full" required type="date" value={draft.leaveEnd} onChange={(e) => setDraft({ ...draft, leaveEnd: e.target.value })} /></label>
      <label className="text-sm">Work start date<input className="task-field mt-1 w-full" required type="date" value={draft.workStartDate} onChange={(e) => setDraft({ ...draft, workStartDate: e.target.value })} /></label>
      <label className="text-sm">Work start in<select className="task-field mt-1 w-full" value={draft.workStartIn} onChange={(e) => setDraft({ ...draft, workStartIn: e.target.value as ReturnHalf })}>{halves.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-sm sm:col-span-2">TL approval screenshot<input accept="image/jpeg,image/png,image/webp" className="task-field mt-1 w-full" required type="file" onChange={(e) => setTlImage(e.target.files?.[0] ?? null)} /></label>
      {preview ? <p className="text-sm sm:col-span-2">Estimated leave: {preview.days} days · {preview.notice}</p> : null}
      {types.length === 0 ? <Notice tone="danger">No leave types are configured in Dropdown Master.</Notice> : null}
      <Button disabled={busy || !types.length} type="submit">{busy ? "Submitting…" : "Submit leave"}</Button>
    </form> : null}
    {tab === "history" ? <div className="space-y-4">
      <div className="flex flex-wrap gap-2 text-sm">{Object.entries(totals).map(([label, value]) => <span className="rounded-lg border border-gold/15 px-3 py-2" key={label}>{label}: {value}</span>)}</div>
      {myRows.length === 0 ? <Notice tone="task">No leave applications yet.</Notice> : myRows.map((row) => <article className="space-y-2 rounded-xl border border-gold/15 p-4 text-sm" key={row.id}>
        <div className="flex flex-wrap justify-between gap-2"><strong>{row.leave_type} · {row.duration}</strong><span>{row.status.toUpperCase()}</span></div><p className="text-xs text-soft-grey">Reference {row.id.slice(0, 8)}</p>
        <p>{row.leave_start} to {row.leave_end} · {row.total_leave_count} days · {row.inform_status}</p>
        <p>Return {row.work_start_date} {row.work_start_in} · Handover {row.handed_over_at ? "done" : "pending"}</p>
        {row.hr_remark ? <p>HR remark: {row.hr_remark}</p> : null}
        <div className="flex flex-wrap gap-2"><Button onClick={() => void openImage(row.tl_approval_path)} variant="secondary">TL approval</Button>{row.handover_approval_path ? <Button onClick={() => void openImage(row.handover_approval_path!)} variant="secondary">Handover proof</Button> : null}{row.status === "pending" ? <Button onClick={() => { setEditingId(row.id); setEditDates({ leaveStart: row.leave_start, leaveEnd: row.leave_end, workStartDate: row.work_start_date, workStartIn: row.work_start_in as ReturnHalf }); }} variant="secondary">Edit dates</Button> : null}{!row.handed_over_at && row.status !== "rejected" ? <Button onClick={() => setHandoverId(row.id)} variant="secondary">Submit handover</Button> : null}</div>
      </article>)}
      {editingId ? <form className="grid gap-3 rounded-xl border border-gold/15 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run(async () => { await editPendingLeave(editingId, editDates); setEditingId(null); }, "Leave dates updated."); }}><h3 className="sm:col-span-2">Edit pending leave dates</h3>{(["leaveStart", "leaveEnd", "workStartDate"] as const).map((field) => <label key={field}>{field}<input className="task-field mt-1 w-full" required type="date" value={editDates[field]} onChange={(e) => setEditDates({ ...editDates, [field]: e.target.value })} /></label>)}<label>Work start in<select className="task-field mt-1 w-full" value={editDates.workStartIn} onChange={(e) => setEditDates({ ...editDates, workStartIn: e.target.value as ReturnHalf })}>{halves.map((item) => <option key={item}>{item}</option>)}</select></label><Button disabled={busy} type="submit">Save dates</Button><Button onClick={() => setEditingId(null)} type="button" variant="secondary">Cancel</Button></form> : null}
      {handoverId ? <form className="grid gap-3 rounded-xl border border-gold/15 p-4" onSubmit={(e) => { e.preventDefault(); if (!handoverImage) { setError("Attach the handover approval screenshot"); return; } void run(async () => { await submitHandover(handoverId, profile.tenant_id, profile.id, handoverTo, handoverImage); setHandoverId(null); setHandoverTo(""); setHandoverImage(null); }, "Handover submitted."); }}><h3>Handover for leave {handoverId.slice(0, 8)}</h3><label>Handover given to<select className="task-field mt-1 w-full" required value={handoverTo} onChange={(e) => setHandoverTo(e.target.value)}><option value="">Select employee</option>{people.filter((person) => person.id !== profile.id).map((person) => <option key={person.id} value={person.id}>{person.employee_name}</option>)}</select></label><label>Handover approval screenshot<input accept="image/jpeg,image/png,image/webp" className="task-field mt-1 w-full" required type="file" onChange={(e) => setHandoverImage(e.target.files?.[0] ?? null)} /></label><div className="flex gap-2"><Button disabled={busy} type="submit">Submit handover</Button><Button onClick={() => setHandoverId(null)} type="button" variant="secondary">Cancel</Button></div></form> : null}
    </div> : null}
    {tab === "review" && canReview ? <div className="space-y-3">{rows.filter((row) => row.status === "pending").map((row) => <article className="space-y-2 rounded-xl border border-gold/15 p-4 text-sm" key={row.id}><strong>{peopleById.get(row.applicant_id)?.employee_name ?? row.applicant_id} · {row.leave_type}</strong><p>{row.leave_start} to {row.leave_end} · {row.total_leave_count} days · {row.inform_status}</p><p>{row.reason}</p><p>Handover: {row.handed_over_at ? peopleById.get(row.handover_to ?? "")?.employee_name ?? "Done" : "Pending"}</p><div className="flex gap-2"><Button onClick={() => void openImage(row.tl_approval_path)} variant="secondary">TL approval</Button>{row.handover_approval_path ? <Button onClick={() => void openImage(row.handover_approval_path!)} variant="secondary">Handover proof</Button> : null}</div>{reviewId === row.id ? <><label className="block">HR remark<textarea className="task-field mt-1 w-full" maxLength={1000} value={remark} onChange={(e) => setRemark(e.target.value)} /></label><div className="flex gap-2"><Button disabled={busy || row.applicant_id === profile.id} onClick={() => void run(async () => { await reviewLeave(row.id, true, remark); setReviewId(null); setRemark(""); }, "Leave approved and Availability updated.")}>Approve</Button><Button disabled={busy || row.applicant_id === profile.id || !remark.trim()} onClick={() => void run(async () => { await reviewLeave(row.id, false, remark); setReviewId(null); setRemark(""); }, "Leave rejected.")} variant="secondary">Reject</Button></div></> : <Button disabled={row.applicant_id === profile.id} onClick={() => { setReviewId(row.id); setRemark(""); }} variant="secondary">Review this request</Button>}</article>)}{rows.every((row) => row.status !== "pending") ? <Notice tone="task">No pending requests.</Notice> : null}</div> : null}
  </section>;
}
