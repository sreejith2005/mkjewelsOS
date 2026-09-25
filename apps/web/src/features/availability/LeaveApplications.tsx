import { useCallback, useEffect, useMemo, useState } from "react";
import { countLeaveDays, formatLeaveDate, hasPermission, leaveInformStatus, leaveNeedsHandover, leaveSummaryTotals, type LeaveHalf, type ReturnHalf } from "@jewelos/core";
import { canSubmitLeave, editPendingLeave, leaveHandoverCandidates, leaveTypes, listLeaveRequests, reviewLeave, signedLeaveImage, submitHandover, submitLeave, type LeaveDraft, type LeaveRequest } from "@jewelos/data/leave/api";
import { useAuth } from "@/auth/AuthContext";
import { Button, Notice } from "@/components/ui";

const durations: LeaveHalf[] = ["FULL DAY", "1ST HALF", "2ND HALF"];
const halves: ReturnHalf[] = ["1ST HALF", "2ND HALF"];
const emptyDraft: LeaveDraft = { leaveType: "", duration: "FULL DAY", reason: "", leaveStart: "", leaveEnd: "", workStartDate: "", workStartIn: "1ST HALF" };
const statusPill: Record<string, string> = {
  approved: "border-success/40 bg-success/10 text-success",
  rejected: "border-danger/40 bg-danger/10 text-danger",
  pending: "border-warning/40 bg-warning/10 text-warning",
};
type Tab = "apply" | "handover" | "history" | "review";
const tabLabels: Record<Tab, string> = { apply: "Apply leave", handover: "Handover", history: "My leave summary", review: "Review requests" };

function StatusPill({ status }: { status: string }) {
  return <span className={`inline-block rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase ${statusPill[status] ?? statusPill.pending}`}>{status}</span>;
}

export function LeaveApplications() {
  const { access, branch, profile } = useAuth();
  const canReview = hasPermission(access, "availability.review_leave") && hasPermission(access, "availability.manage_others");
  const [canApply, setCanApply] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("apply");
  const [types, setTypes] = useState<Array<{ value: string; label: string }>>([]);
  const [people, setPeople] = useState<Array<{ id: string; employee_name: string }>>([]);
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [draft, setDraft] = useState<LeaveDraft>(emptyDraft);
  const [tlImage, setTlImage] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [handoverId, setHandoverId] = useState<string | null>(null);
  const [handoverDone, setHandoverDone] = useState("");
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
  const handoverRows = useMemo(() => myRows.filter(leaveNeedsHandover), [myRows]);
  const totals = useMemo(() => leaveSummaryTotals(myRows), [myRows]);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const selectedHandover = handoverRows.find((row) => row.id === handoverId) ?? null;
  const preview = useMemo(() => {
    try {
      if (!draft.leaveStart || !draft.leaveEnd || !draft.workStartDate) return null;
      return { days: countLeaveDays(draft.duration, draft.leaveStart, draft.leaveEnd, draft.workStartDate, draft.workStartIn),
        notice: leaveInformStatus(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), draft.leaveStart, draft.leaveEnd) };
    } catch { return null; }
  }, [draft]);
  const tabs: Tab[] = [...(canApply ? ["apply" as const] : []), ...(canApply || handoverRows.length ? ["handover" as const] : []), "history", ...(canReview ? ["review" as const] : [])];

  const run = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); await load(); setMessage(success); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Leave action failed"); }
    finally { setBusy(false); }
  };
  const openImage = async (path: string) => {
    try { window.open(await signedLeaveImage(path), "_blank", "noopener,noreferrer"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Image unavailable"); }
  };
  const switchTab = (next: Tab) => { setTab(next); setError(""); setMessage(""); if (next !== "apply") void load(); };
  const fillHandover = (id: string) => { setHandoverId(id); setHandoverDone(""); setHandoverTo(""); setHandoverImage(null); setFileInputKey((key) => key + 1); setTab("handover"); };

  if (!profile) return null;
  return <section className="mb-6 space-y-4 rounded-xl border border-gold/25 bg-charcoal p-4 sm:p-5">
    <div><h2 className="font-display text-xl text-gold">Leave management</h2><p className="text-sm text-soft-grey">Apply, complete your handover, and follow HR's decision.</p></div>
    {canApply !== null ? <div className="flex flex-wrap gap-2" role="tablist" aria-label="Leave management">
      {tabs.map((item) => <Button aria-selected={tab === item} key={item} onClick={() => switchTab(item)} role="tab" variant={tab === item ? "primary" : "secondary"}>{tabLabels[item]}{item === "handover" && handoverRows.length ? ` (${handoverRows.length})` : ""}</Button>)}
    </div> : null}
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {message ? <Notice tone="success">{message}</Notice> : null}

    {tab === "apply" && canApply ? <form className="grid gap-4 rounded-xl border border-gold/15 p-4 sm:grid-cols-2" onSubmit={(event) => {
      event.preventDefault();
      if (draft.leaveEnd && draft.leaveStart && draft.leaveEnd < draft.leaveStart) { setError("Leave end date cannot be before leave start date"); return; }
      if (!tlImage) { setError("Attach the TL approval screenshot"); return; }
      void run(async () => {
        const id = await submitLeave(draft, profile.tenant_id, profile.id, tlImage);
        setDraft(emptyDraft); setTlImage(null); setFileInputKey((key) => key + 1);
        fillHandover(id);
      }, "Leave submitted. Complete the handover for this leave.");
    }}>
      <label className="text-sm">Name<input className="task-field mt-1 w-full" disabled value={profile.employee_name} /></label>
      <label className="text-sm">Branch<input className="task-field mt-1 w-full" disabled value={branch?.name ?? ""} /></label>
      <label className="text-sm">Type of leave<select className="task-field mt-1 w-full" required value={draft.leaveType} onChange={(e) => setDraft({ ...draft, leaveType: e.target.value })}><option value="">Select leave type</option>{types.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label>
      <label className="text-sm">Leave duration<select className="task-field mt-1 w-full" value={draft.duration} onChange={(e) => setDraft({ ...draft, duration: e.target.value as LeaveHalf })}>{durations.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-sm sm:col-span-2">Reason<textarea className="task-field mt-1 w-full" maxLength={1000} required value={draft.reason} onChange={(e) => setDraft({ ...draft, reason: e.target.value })} /></label>
      <label className="text-sm">Leave start date<input className="task-field mt-1 w-full" required type="date" value={draft.leaveStart} onChange={(e) => setDraft({ ...draft, leaveStart: e.target.value })} /></label>
      <label className="text-sm">Leave end date<input className="task-field mt-1 w-full" min={draft.leaveStart || undefined} required type="date" value={draft.leaveEnd} onChange={(e) => setDraft({ ...draft, leaveEnd: e.target.value })} /></label>
      <label className="text-sm">Work start date<input className="task-field mt-1 w-full" min={draft.leaveEnd || undefined} required type="date" value={draft.workStartDate} onChange={(e) => setDraft({ ...draft, workStartDate: e.target.value })} /></label>
      <label className="text-sm">Work start in<select className="task-field mt-1 w-full" value={draft.workStartIn} onChange={(e) => setDraft({ ...draft, workStartIn: e.target.value as ReturnHalf })}>{halves.map((item) => <option key={item}>{item}</option>)}</select></label>
      <label className="text-sm sm:col-span-2">Did you get approval from your TL? Attach the screenshot<input accept="image/jpeg,image/png,image/webp" className="task-field mt-1 w-full" key={fileInputKey} required type="file" onChange={(e) => setTlImage(e.target.files?.[0] ?? null)} /></label>
      {preview ? <p className="text-sm sm:col-span-2">Estimated leave: {preview.days} days · {preview.notice}</p> : null}
      {types.length === 0 ? <Notice tone="danger">No leave types are configured in Dropdown Master.</Notice> : null}
      <Button disabled={busy || !types.length} type="submit">{busy ? "Submitting…" : "Submit leave"}</Button>
    </form> : null}

    {tab === "handover" ? <div className="space-y-4">
      <h3 className="font-semibold text-champagne">Your handover pending leaves</h3>
      {handoverRows.length === 0 ? <Notice tone="task">No handover pending.</Notice> : <div className="overflow-x-auto rounded-xl border border-gold/15">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="text-xs uppercase text-soft-grey"><tr><th className="p-3">Unique ID</th><th className="p-3">Type</th><th className="p-3">Start</th><th className="p-3">End</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead>
          <tbody>{handoverRows.map((row) => <tr className={`border-t border-gold/10 ${row.id === handoverId ? "bg-gold/10" : ""}`} key={row.id}>
            <td className="p-3 font-mono text-xs">{row.reference_code}</td>
            <td className="p-3">{row.leave_type}<br /><span className="text-xs text-soft-grey">{row.duration}</span></td>
            <td className="p-3">{formatLeaveDate(row.leave_start)}</td>
            <td className="p-3">{formatLeaveDate(row.leave_end)}</td>
            <td className="p-3"><StatusPill status={row.status} /></td>
            <td className="p-3"><Button onClick={() => fillHandover(row.id)} variant={row.id === handoverId ? "primary" : "secondary"}>Fill handover</Button></td>
          </tr>)}</tbody>
        </table>
      </div>}
      {handoverRows.length ? <form className="grid gap-3 rounded-xl border border-gold/15 p-4 sm:grid-cols-2" onSubmit={(e) => {
        e.preventDefault();
        if (!selectedHandover) { setError("Choose Fill handover for a leave first"); return; }
        if (handoverDone !== "YES") { setError("Confirm that the handover is done"); return; }
        if (!handoverImage) { setError("Attach the handover approval screenshot"); return; }
        void run(async () => {
          await submitHandover(selectedHandover.id, profile.tenant_id, profile.id, handoverTo, handoverImage);
          setHandoverId(null); setHandoverDone(""); setHandoverTo(""); setHandoverImage(null); setFileInputKey((key) => key + 1);
          setTab("history");
        }, "Handover submitted.");
      }}>
        <h3 className="font-semibold text-champagne sm:col-span-2">Handover form</h3>
        <label className="text-sm sm:col-span-2">Selected leave (Unique ID)<input className="task-field mt-1 w-full" disabled placeholder="Choose Fill handover above" value={selectedHandover?.reference_code ?? ""} /></label>
        <label className="text-sm">Handover done?<select className="task-field mt-1 w-full" required value={handoverDone} onChange={(e) => setHandoverDone(e.target.value)}><option value="">Select</option><option value="YES">YES</option></select></label>
        <label className="text-sm">Handover given to<select className="task-field mt-1 w-full" required value={handoverTo} onChange={(e) => setHandoverTo(e.target.value)}><option value="">Select employee</option>{people.filter((person) => person.id !== profile.id).map((person) => <option key={person.id} value={person.id}>{person.employee_name}</option>)}</select></label>
        <label className="text-sm sm:col-span-2">Handover approval screenshot<input accept="image/jpeg,image/png,image/webp" className="task-field mt-1 w-full" key={fileInputKey} required type="file" onChange={(e) => setHandoverImage(e.target.files?.[0] ?? null)} /></label>
        <Button disabled={busy || !selectedHandover} type="submit">{busy ? "Submitting…" : "Submit handover"}</Button>
      </form> : null}
    </div> : null}

    {tab === "history" ? <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([["Total leaves", totals.total], ["Approved", totals.approved], ["Pending", totals.pending], ["Rejected", totals.rejected]] as const).map(([label, value]) => <div className="rounded-xl border border-gold/15 p-3" key={label}>
          <p className="text-xs uppercase text-soft-grey">{label}</p><p className="mt-1 text-2xl font-semibold text-champagne">{value}</p><p className="text-xs text-soft-grey">days</p>
        </div>)}
      </div>
      <h3 className="font-semibold text-champagne">My leave history</h3>
      {myRows.length === 0 ? <Notice tone="task">No leave applications yet.</Notice> : myRows.map((row) => <article className="space-y-2 rounded-xl border border-gold/15 p-4 text-sm" key={row.id}>
        <div className="flex flex-wrap items-start justify-between gap-2"><div><strong>{row.leave_type} · {row.duration}</strong><p className="font-mono text-xs text-soft-grey">{row.reference_code}</p></div><StatusPill status={row.status} /></div>
        <p>{formatLeaveDate(row.leave_start)} to {formatLeaveDate(row.leave_end)} · {row.total_leave_count} days · {row.inform_status}</p>
        <p>Return {formatLeaveDate(row.work_start_date)} {row.work_start_in} · Handover {row.handed_over_at ? `done${row.handover_to ? ` to ${peopleById.get(row.handover_to)?.employee_name ?? "colleague"}` : ""}` : row.status === "rejected" ? "not required" : "pending"}</p>
        <p>HR remark: {row.hr_remark ?? "—"}</p>
        <div className="flex flex-wrap gap-2"><Button onClick={() => void openImage(row.tl_approval_path)} variant="secondary">TL approval</Button>{row.handover_approval_path ? <Button onClick={() => void openImage(row.handover_approval_path!)} variant="secondary">Handover proof</Button> : null}{row.status === "pending" ? <Button onClick={() => { setEditingId(row.id); setEditDates({ leaveStart: row.leave_start, leaveEnd: row.leave_end, workStartDate: row.work_start_date, workStartIn: row.work_start_in as ReturnHalf }); }} variant="secondary">Edit</Button> : null}{leaveNeedsHandover(row) ? <Button onClick={() => fillHandover(row.id)} variant="secondary">Handover</Button> : null}</div>
        {editingId === row.id && row.status === "pending" ? <form className="grid gap-3 rounded-xl border border-gold/15 p-4 sm:grid-cols-2" onSubmit={(e) => {
          e.preventDefault();
          if (editDates.leaveEnd < editDates.leaveStart) { setError("Leave end date cannot be before leave start date"); return; }
          void run(async () => { await editPendingLeave(row.id, editDates); setEditingId(null); }, "Leave updated. Leave count and inform status recalculated.");
        }}>
          <h3 className="sm:col-span-2">Edit leave (pending only)</h3>
          <label>Leave start date<input className="task-field mt-1 w-full" required type="date" value={editDates.leaveStart} onChange={(e) => setEditDates({ ...editDates, leaveStart: e.target.value })} /></label>
          <label>Leave end date<input className="task-field mt-1 w-full" min={editDates.leaveStart || undefined} required type="date" value={editDates.leaveEnd} onChange={(e) => setEditDates({ ...editDates, leaveEnd: e.target.value })} /></label>
          <label>Work start date<input className="task-field mt-1 w-full" min={editDates.leaveEnd || undefined} required type="date" value={editDates.workStartDate} onChange={(e) => setEditDates({ ...editDates, workStartDate: e.target.value })} /></label>
          <label>Work start in<select className="task-field mt-1 w-full" value={editDates.workStartIn} onChange={(e) => setEditDates({ ...editDates, workStartIn: e.target.value as ReturnHalf })}>{halves.map((item) => <option key={item}>{item}</option>)}</select></label>
          <Button disabled={busy} type="submit">{busy ? "Saving…" : "Save"}</Button><Button onClick={() => setEditingId(null)} type="button" variant="secondary">Close</Button>
        </form> : null}
      </article>)}
    </div> : null}

    {tab === "review" && canReview ? <div className="space-y-3">{rows.filter((row) => row.status === "pending").map((row) => <article className="space-y-2 rounded-xl border border-gold/15 p-4 text-sm" key={row.id}><strong>{peopleById.get(row.applicant_id)?.employee_name ?? row.applicant_id} · {row.leave_type}</strong><p className="font-mono text-xs text-soft-grey">{row.reference_code}</p><p>{formatLeaveDate(row.leave_start)} to {formatLeaveDate(row.leave_end)} · {row.total_leave_count} days · {row.inform_status}</p><p>{row.reason}</p><p>Handover: {row.handed_over_at ? peopleById.get(row.handover_to ?? "")?.employee_name ?? "Done" : "Pending"}</p><div className="flex gap-2"><Button onClick={() => void openImage(row.tl_approval_path)} variant="secondary">TL approval</Button>{row.handover_approval_path ? <Button onClick={() => void openImage(row.handover_approval_path!)} variant="secondary">Handover proof</Button> : null}</div>{reviewId === row.id ? <><label className="block">HR remark<textarea className="task-field mt-1 w-full" maxLength={1000} value={remark} onChange={(e) => setRemark(e.target.value)} /></label><div className="flex gap-2"><Button disabled={busy || row.applicant_id === profile.id} onClick={() => void run(async () => { await reviewLeave(row.id, true, remark); setReviewId(null); setRemark(""); }, "Leave approved and Availability updated.")}>Approve</Button><Button disabled={busy || row.applicant_id === profile.id || !remark.trim()} onClick={() => void run(async () => { await reviewLeave(row.id, false, remark); setReviewId(null); setRemark(""); }, "Leave rejected.")} variant="secondary">Reject</Button></div></> : <Button disabled={row.applicant_id === profile.id} onClick={() => { setReviewId(row.id); setRemark(""); }} variant="secondary">Review this request</Button>}</article>)}{rows.every((row) => row.status !== "pending") ? <Notice tone="task">No pending requests.</Notice> : null}</div> : null}
  </section>;
}
