import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, View } from "react-native";
import { countLeaveDays, hasPermission, leaveInformStatus, type LeaveHalf, type ReturnHalf } from "@jewelos/core";
import { editPendingLeave, leaveTypes, listLeaveRequests, reviewLeave, signedLeaveImage, submitHandover, submitLeave, type LeaveDraft, type LeaveRequest } from "@jewelos/data/leave/api";
import type { UploadableFile } from "@jewelos/data/runtime";
import { loadAvailabilityUsers, type TaskUser } from "@jewelos/data/tasks/api";
import { useAccess, useProfile } from "@/auth/AuthProvider";
import { DateField } from "@/forms/DateField";
import { pickFileFromChooser } from "@/lib/pickFile";
import { Button } from "@/ui/Button";
import { Card, StatusBadge } from "@/ui/Card";
import { OptionPicker } from "@/ui/OptionPicker";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Banner } from "@/ui/states";
import { Text } from "@/ui/Text";
import { TextField } from "@/ui/TextField";

const durationOptions = (["FULL DAY", "1ST HALF", "2ND HALF"] as LeaveHalf[]).map((value) => ({ value, label: value }));
const halfOptions = (["1ST HALF", "2ND HALF"] as ReturnHalf[]).map((value) => ({ value, label: value }));
const emptyDraft: LeaveDraft = { leaveType: "", duration: "FULL DAY", reason: "", leaveStart: "", leaveEnd: "", workStartDate: "", workStartIn: "1ST HALF" };

export function LeaveApplications() {
  const profile = useProfile();
  const access = useAccess();
  const canReview = hasPermission(access, "availability.review_leave") && hasPermission(access, "availability.manage_others");
  const [tab, setTab] = useState<"apply" | "history" | "review">("apply");
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [types, setTypes] = useState<Array<{ value: string; label: string }>>([]);
  const [people, setPeople] = useState<TaskUser[]>([]);
  const [draft, setDraft] = useState<LeaveDraft>(emptyDraft);
  const [tlImage, setTlImage] = useState<UploadableFile | null>(null);
  const [handoverId, setHandoverId] = useState<string | null>(null);
  const [handoverTo, setHandoverTo] = useState("");
  const [handoverImage, setHandoverImage] = useState<UploadableFile | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editDates, setEditDates] = useState({ leaveStart: "", leaveEnd: "", workStartDate: "", workStartIn: "1ST HALF" as ReturnHalf });
  const [remark, setRemark] = useState("");
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const [ownRows, reviewRows, nextTypes, nextPeople] = await Promise.all([
        listLeaveRequests(profile.id), canReview ? listLeaveRequests(undefined, "pending") : Promise.resolve([]),
        leaveTypes(), loadAvailabilityUsers(),
      ]);
      setRows([...ownRows, ...reviewRows.filter((row) => row.applicant_id !== profile.id)]);
      setTypes(nextTypes); setPeople(nextPeople);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load leave requests"); }
  }, [canReview, profile.id]);
  useEffect(() => { void load(); }, [load]);

  const mine = useMemo(() => rows.filter((row) => row.applicant_id === profile.id), [profile.id, rows]);
  const totals = useMemo(() => mine.reduce((total, row) => {
    total.total += row.total_leave_count;
    if (row.status === "pending" || row.status === "approved" || row.status === "rejected") total[row.status] += row.total_leave_count;
    return total;
  }, { total: 0, pending: 0, approved: 0, rejected: 0 }), [mine]);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person.employee_name])), [people]);
  const preview = useMemo(() => {
    try {
      if (!draft.leaveStart || !draft.leaveEnd || !draft.workStartDate) return null;
      return `${countLeaveDays(draft.duration, draft.leaveStart, draft.leaveEnd, draft.workStartDate, draft.workStartIn)} days · ${leaveInformStatus(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), draft.leaveStart, draft.leaveEnd)}`;
    } catch { return null; }
  }, [draft]);
  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true); setError(""); setMessage("");
    try { await action(); await load(); setMessage(success); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Leave action failed"); }
    finally { setBusy(false); }
  };
  const choose = async (kind: "tl" | "handover") => {
    const result = await pickFileFromChooser(kind === "tl" ? "TL approval screenshot" : "Handover approval screenshot", { imagesOnly: true });
    if (!result.ok) { if (!result.cancelled) setError(result.message); return; }
    if (kind === "tl") setTlImage(result.file); else setHandoverImage(result.file);
  };
  const openImage = async (path: string) => {
    try { await Linking.openURL(await signedLeaveImage(path)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Image unavailable"); }
  };

  return <View style={{ gap: 12, marginTop: 20 }}>
    <Text variant="heading" weight="bold">Leave applications</Text>
    <Text tone="muted" variant="small">Apply, complete handover, and follow HR's decision.</Text>
    <SegmentedControl accessibilityLabel="Leave section" onChange={setTab} options={[{ value: "apply", label: "Apply" }, { value: "history", label: "My summary" }, ...(canReview ? [{ value: "review" as const, label: "Review" }] : [])]} value={tab} />
    {error ? <Banner tone="danger">{error}</Banner> : null}
    {message ? <Banner tone="success">{message}</Banner> : null}
    {tab === "apply" ? <Card>
      <Text tone="muted" variant="small">{profile.employee_name} · Your signed in identity and branch are used.</Text>
      <OptionPicker label="Type of leave" options={types} selected={draft.leaveType ? [draft.leaveType] : []} onChange={(value) => setDraft({ ...draft, leaveType: value[0] ?? "" })} />
      <OptionPicker label="Leave duration" options={durationOptions} selected={[draft.duration]} onChange={(value) => setDraft({ ...draft, duration: value[0] as LeaveHalf })} />
      <TextField label="Reason" maxLength={1000} multiline onChangeText={(value) => setDraft({ ...draft, reason: value })} value={draft.reason} />
      <DateField disabled={false} invalid={false} label="Leave start" mode="date" onChange={(value) => setDraft({ ...draft, leaveStart: value })} value={draft.leaveStart} />
      <DateField disabled={false} invalid={false} label="Leave end" mode="date" onChange={(value) => setDraft({ ...draft, leaveEnd: value })} value={draft.leaveEnd} />
      <DateField disabled={false} invalid={false} label="Work start date" mode="date" onChange={(value) => setDraft({ ...draft, workStartDate: value })} value={draft.workStartDate} />
      <OptionPicker label="Work start in" options={halfOptions} selected={[draft.workStartIn]} onChange={(value) => setDraft({ ...draft, workStartIn: value[0] as ReturnHalf })} />
      <Button label={tlImage ? `TL approval: ${tlImage.name}` : "Attach TL approval screenshot"} onPress={() => void choose("tl")} variant="secondary" />
      {preview ? <Text variant="small">Estimated leave: {preview}</Text> : null}
      {!types.length ? <Banner tone="info">No leave types are configured in Dropdown Master.</Banner> : null}
      <Button busy={busy} disabled={!types.length || !draft.leaveType || !draft.reason.trim() || !tlImage || !draft.leaveStart || !draft.leaveEnd || !draft.workStartDate} label="Submit leave" onPress={() => void run(async () => { if (!tlImage) throw new Error("TL approval image required"); await submitLeave(draft, profile.tenant_id, profile.id, tlImage); setDraft(emptyDraft); setTlImage(null); setTab("history"); }, "Leave submitted. Complete handover from your summary.")} />
    </Card> : null}
    {tab === "history" ? <View style={{ gap: 10 }}>
      <Card><Text variant="small">Total {totals.total} · Approved {totals.approved} · Pending {totals.pending} · Rejected {totals.rejected}</Text></Card>
      {mine.length === 0 ? <Card><Text tone="muted">No leave applications yet.</Text></Card> : mine.map((row) => <Card key={row.id}>
        <Text weight="semibold">{row.leave_type} · {row.duration}</Text><Text tone="muted" variant="caption">Reference {row.id.slice(0, 8)}</Text><StatusBadge label={row.status} tone={row.status === "approved" ? "success" : row.status === "rejected" ? "danger" : "warning"} />
        <Text variant="small">{row.leave_start} to {row.leave_end} · {row.total_leave_count} days · {row.inform_status}</Text>
        <Text tone="muted" variant="small">Return {row.work_start_date} {row.work_start_in} · Handover {row.handed_over_at ? "done" : "pending"}</Text>
        {row.hr_remark ? <Text variant="small">HR remark: {row.hr_remark}</Text> : null}
        <Button label="View TL approval" onPress={() => void openImage(row.tl_approval_path)} variant="secondary" />
        {row.handover_approval_path ? <Button label="View handover proof" onPress={() => void openImage(row.handover_approval_path!)} variant="secondary" /> : null}
        {row.status === "pending" ? <Button label="Edit pending dates" onPress={() => { setEditId(row.id); setEditDates({ leaveStart: row.leave_start, leaveEnd: row.leave_end, workStartDate: row.work_start_date, workStartIn: row.work_start_in as ReturnHalf }); }} variant="secondary" /> : null}
        {!row.handed_over_at && row.status !== "rejected" ? <Button label="Submit handover" onPress={() => setHandoverId(row.id)} variant="secondary" /> : null}
      </Card>)}
      {editId ? <Card><Text weight="semibold">Edit pending leave dates</Text>{(["leaveStart", "leaveEnd", "workStartDate"] as const).map((field) => <DateField disabled={false} invalid={false} key={field} label={field} mode="date" onChange={(value) => setEditDates({ ...editDates, [field]: value })} value={editDates[field]} />)}<OptionPicker label="Work start in" options={halfOptions} selected={[editDates.workStartIn]} onChange={(value) => setEditDates({ ...editDates, workStartIn: value[0] as ReturnHalf })} /><Button busy={busy} label="Save dates" onPress={() => void run(async () => { await editPendingLeave(editId, editDates); setEditId(null); }, "Leave dates updated.")} /><Button label="Cancel" onPress={() => setEditId(null)} variant="secondary" /></Card> : null}
      {handoverId ? <Card><Text weight="semibold">Handover for leave {handoverId.slice(0, 8)}</Text><OptionPicker label="Handover given to" options={people.filter((person) => person.id !== profile.id).map((person) => ({ value: person.id, label: person.employee_name }))} selected={handoverTo ? [handoverTo] : []} onChange={(value) => setHandoverTo(value[0] ?? "")} /><Button label={handoverImage ? `Handover proof: ${handoverImage.name}` : "Attach handover approval screenshot"} onPress={() => void choose("handover")} variant="secondary" /><Button busy={busy} disabled={!handoverTo || !handoverImage} label="Submit handover" onPress={() => void run(async () => { if (!handoverImage) throw new Error("Handover image required"); await submitHandover(handoverId, profile.tenant_id, profile.id, handoverTo, handoverImage); setHandoverId(null); setHandoverTo(""); setHandoverImage(null); }, "Handover submitted.")} /><Button label="Cancel" onPress={() => setHandoverId(null)} variant="secondary" /></Card> : null}
    </View> : null}
    {tab === "review" && canReview ? <View style={{ gap: 10 }}>
      {rows.filter((row) => row.status === "pending").map((row) => <Card key={row.id}><Text weight="semibold">{peopleById.get(row.applicant_id) ?? row.applicant_id} · {row.leave_type}</Text><Text variant="small">{row.leave_start} to {row.leave_end} · {row.total_leave_count} days · {row.inform_status}</Text><Text variant="small">{row.reason}</Text><Text tone="muted" variant="small">Handover: {row.handed_over_at ? peopleById.get(row.handover_to ?? "") ?? "Done" : "Pending"}</Text><Button label="View TL approval" onPress={() => void openImage(row.tl_approval_path)} variant="secondary" />{row.handover_approval_path ? <Button label="View handover proof" onPress={() => void openImage(row.handover_approval_path!)} variant="secondary" /> : null}{reviewId === row.id ? <><TextField label="HR remark" maxLength={1000} multiline onChangeText={setRemark} value={remark} /><Button busy={busy} disabled={row.applicant_id === profile.id} label="Approve and mark absent" onPress={() => void run(async () => { await reviewLeave(row.id, true, remark); setReviewId(null); setRemark(""); }, "Leave approved and Availability updated.")} /><Button busy={busy} disabled={row.applicant_id === profile.id || !remark.trim()} label="Reject" onPress={() => void run(async () => { await reviewLeave(row.id, false, remark); setReviewId(null); setRemark(""); }, "Leave rejected.")} variant="danger" /></> : <Button disabled={row.applicant_id === profile.id} label="Review this request" onPress={() => { setReviewId(row.id); setRemark(""); }} variant="secondary" />}</Card>)}
      {rows.every((row) => row.status !== "pending") ? <Card><Text tone="muted">No pending requests.</Text></Card> : null}
    </View> : null}
  </View>;
}
