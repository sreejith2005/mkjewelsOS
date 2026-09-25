import { useCallback, useMemo, useState } from "react";
import { Linking, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { countLeaveDays, formatLeaveDate, hasPermission, leaveInformStatus, leaveNeedsHandover, leaveSummaryTotals, type LeaveHalf, type ReturnHalf } from "@jewelos/core";
import { canSubmitLeave, editPendingLeave, leaveHandoverCandidates, leaveTypes, listLeaveRequests, reviewLeave, signedLeaveImage, submitHandover, submitLeave, type LeaveDraft, type LeaveRequest } from "@jewelos/data/leave/api";
import type { UploadableFile } from "@jewelos/data/runtime";
import { useAccess, useAuth, useProfile } from "@/auth/AuthProvider";
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
const handoverDoneOptions = [{ value: "YES", label: "YES" }];
const emptyDraft: LeaveDraft = { leaveType: "", duration: "FULL DAY", reason: "", leaveStart: "", leaveEnd: "", workStartDate: "", workStartIn: "1ST HALF" };
type Tab = "apply" | "handover" | "history" | "review";
const statusTone = (status: string) => status === "approved" ? "success" as const : status === "rejected" ? "danger" as const : "warning" as const;

export function LeaveApplications() {
  const profile = useProfile();
  const access = useAccess();
  const { branch } = useAuth();
  const canReview = hasPermission(access, "availability.review_leave") && hasPermission(access, "availability.manage_others");
  const [canApply, setCanApply] = useState<boolean | null>(null);
  const [tab, setTab] = useState<Tab>("apply");
  const [rows, setRows] = useState<LeaveRequest[]>([]);
  const [types, setTypes] = useState<Array<{ value: string; label: string }>>([]);
  const [people, setPeople] = useState<Array<{ id: string; employee_name: string }>>([]);
  const [draft, setDraft] = useState<LeaveDraft>(emptyDraft);
  const [tlImage, setTlImage] = useState<UploadableFile | null>(null);
  const [handoverId, setHandoverId] = useState<string | null>(null);
  const [handoverDone, setHandoverDone] = useState("");
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
      const [ownRows, reviewRows, nextTypes, nextPeople, applicantEligible] = await Promise.all([
        listLeaveRequests(profile.id), canReview ? listLeaveRequests(undefined, "pending") : Promise.resolve([]),
        leaveTypes(), leaveHandoverCandidates(), canSubmitLeave(),
      ]);
      setRows([...ownRows, ...reviewRows.filter((row) => row.applicant_id !== profile.id)]);
      setTypes(nextTypes); setPeople(nextPeople);
      setCanApply(applicantEligible);
      if (!applicantEligible) setTab((current) => current === "apply" ? (canReview ? "review" : "history") : current);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load leave requests"); }
  }, [canReview, profile.id]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const mine = useMemo(() => rows.filter((row) => row.applicant_id === profile.id), [profile.id, rows]);
  const handoverRows = useMemo(() => mine.filter(leaveNeedsHandover), [mine]);
  const totals = useMemo(() => leaveSummaryTotals(mine), [mine]);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person.employee_name])), [people]);
  const selectedHandover = handoverRows.find((row) => row.id === handoverId) ?? null;
  const preview = useMemo(() => {
    try {
      if (!draft.leaveStart || !draft.leaveEnd || !draft.workStartDate) return null;
      return `${countLeaveDays(draft.duration, draft.leaveStart, draft.leaveEnd, draft.workStartDate, draft.workStartIn)} days · ${leaveInformStatus(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }), draft.leaveStart, draft.leaveEnd)}`;
    } catch { return null; }
  }, [draft]);
  const tabOptions = [
    ...(canApply ? [{ value: "apply" as const, label: "Apply" }] : []),
    ...(canApply || handoverRows.length ? [{ value: "handover" as const, label: handoverRows.length ? `Handover (${handoverRows.length})` : "Handover" }] : []),
    { value: "history" as const, label: "Summary" },
    ...(canReview ? [{ value: "review" as const, label: "Review" }] : []),
  ];

  const run = async (action: () => Promise<void>, success: string) => {
    if (busy) return;
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
  const switchTab = (next: Tab) => { setTab(next); setError(""); setMessage(""); if (next !== "apply") void load(); };
  const fillHandover = (id: string) => { setHandoverId(id); setHandoverDone(""); setHandoverTo(""); setHandoverImage(null); setTab("handover"); };
  const datesReversed = Boolean(draft.leaveStart && draft.leaveEnd && draft.leaveEnd < draft.leaveStart);

  return <View style={{ gap: 12, marginTop: 20 }}>
    <Text variant="heading" weight="bold">Leave management</Text>
    <Text tone="muted" variant="small">Apply, complete handover, and follow HR's decision.</Text>
    {canApply !== null ? <SegmentedControl accessibilityLabel="Leave section" onChange={switchTab} options={tabOptions} value={tab} /> : null}
    {error ? <Banner tone="danger">{error}</Banner> : null}
    {message ? <Banner tone="success">{message}</Banner> : null}

    {tab === "apply" && canApply ? <Card>
      <Text variant="small">Name: {profile.employee_name}</Text>
      <Text variant="small">Branch: {branch?.name ?? "—"}</Text>
      <OptionPicker label="Type of leave" options={types} selected={draft.leaveType ? [draft.leaveType] : []} onChange={(value) => setDraft({ ...draft, leaveType: value[0] ?? "" })} />
      <OptionPicker label="Leave duration" options={durationOptions} selected={[draft.duration]} onChange={(value) => setDraft({ ...draft, duration: value[0] as LeaveHalf })} />
      <TextField label="Reason" maxLength={1000} multiline onChangeText={(value) => setDraft({ ...draft, reason: value })} value={draft.reason} />
      <DateField disabled={false} invalid={false} label="Leave start date" mode="date" onChange={(value) => setDraft({ ...draft, leaveStart: value })} value={draft.leaveStart} />
      <DateField disabled={false} invalid={datesReversed} label="Leave end date" mode="date" onChange={(value) => setDraft({ ...draft, leaveEnd: value })} value={draft.leaveEnd} />
      {datesReversed ? <Text tone="danger" variant="small">Leave end date cannot be before leave start date.</Text> : null}
      <DateField disabled={false} invalid={false} label="Work start date" mode="date" onChange={(value) => setDraft({ ...draft, workStartDate: value })} value={draft.workStartDate} />
      <OptionPicker label="Work start in" options={halfOptions} selected={[draft.workStartIn]} onChange={(value) => setDraft({ ...draft, workStartIn: value[0] as ReturnHalf })} />
      <Button label={tlImage ? `TL approval: ${tlImage.name}` : "Attach TL approval screenshot"} onPress={() => void choose("tl")} variant="secondary" />
      {preview ? <Text variant="small">Estimated leave: {preview}</Text> : null}
      {!types.length ? <Banner tone="info">No leave types are configured in Dropdown Master.</Banner> : null}
      <Button busy={busy} disabled={!types.length || !draft.leaveType || !draft.reason.trim() || !tlImage || !draft.leaveStart || !draft.leaveEnd || !draft.workStartDate || datesReversed} label="Submit leave" onPress={() => void run(async () => { if (!tlImage) throw new Error("TL approval image required"); const id = await submitLeave(draft, profile.tenant_id, profile.id, tlImage); setDraft(emptyDraft); setTlImage(null); fillHandover(id); }, "Leave submitted. Complete the handover for this leave.")} />
    </Card> : null}

    {tab === "handover" ? <View style={{ gap: 10 }}>
      <Text weight="semibold">Your handover pending leaves</Text>
      {handoverRows.length === 0 ? <Card><Text tone="muted">No handover pending.</Text></Card> : handoverRows.map((row) => <Card key={row.id}>
        <Text weight="semibold">{row.leave_type} · {row.duration}</Text>
        <Text tone="muted" variant="caption">{row.reference_code}</Text>
        <StatusBadge label={row.status} tone={statusTone(row.status)} />
        <Text variant="small">{formatLeaveDate(row.leave_start)} to {formatLeaveDate(row.leave_end)}</Text>
        {row.id === handoverId ? <View style={{ gap: 10 }}>
          <Text weight="semibold">Handover form</Text>
          <Text variant="small">Selected leave: {row.reference_code}</Text>
          <OptionPicker label="Handover done?" options={handoverDoneOptions} selected={handoverDone ? [handoverDone] : []} onChange={(value) => setHandoverDone(value[0] ?? "")} />
          <OptionPicker label="Handover given to" options={people.filter((person) => person.id !== profile.id).map((person) => ({ value: person.id, label: person.employee_name }))} selected={handoverTo ? [handoverTo] : []} onChange={(value) => setHandoverTo(value[0] ?? "")} />
          <Button label={handoverImage ? `Handover proof: ${handoverImage.name}` : "Attach handover approval screenshot"} onPress={() => void choose("handover")} variant="secondary" />
          <Button busy={busy} disabled={handoverDone !== "YES" || !handoverTo || !handoverImage} label="Submit handover" onPress={() => void run(async () => { if (!handoverImage) throw new Error("Handover image required"); await submitHandover(row.id, profile.tenant_id, profile.id, handoverTo, handoverImage); setHandoverId(null); setHandoverDone(""); setHandoverTo(""); setHandoverImage(null); setTab("history"); }, "Handover submitted.")} />
        </View> : <Button label="Fill handover" onPress={() => fillHandover(row.id)} variant="secondary" />}
      </Card>)}
      {handoverRows.length > 0 && !selectedHandover ? <Card><Text tone="muted" variant="small">Choose Fill handover on a leave to open its handover form.</Text></Card> : null}
    </View> : null}

    {tab === "history" ? <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {([["Total leaves", totals.total], ["Approved", totals.approved], ["Pending", totals.pending], ["Rejected", totals.rejected]] as const).map(([label, value]) => <View key={label} style={{ flexBasis: "46%", flexGrow: 1 }}><Card>
          <Text tone="muted" variant="caption">{label}</Text><Text variant="heading" weight="bold">{value}</Text><Text tone="muted" variant="caption">days</Text>
        </Card></View>)}
      </View>
      <Text weight="semibold">My leave history</Text>
      {mine.length === 0 ? <Card><Text tone="muted">No leave applications yet.</Text></Card> : mine.map((row) => <Card key={row.id}>
        <Text weight="semibold">{row.leave_type} · {row.duration}</Text><Text tone="muted" variant="caption">{row.reference_code}</Text><StatusBadge label={row.status} tone={statusTone(row.status)} />
        <Text variant="small">{formatLeaveDate(row.leave_start)} to {formatLeaveDate(row.leave_end)} · {row.total_leave_count} days · {row.inform_status}</Text>
        <Text tone="muted" variant="small">Return {formatLeaveDate(row.work_start_date)} {row.work_start_in} · Handover {row.handed_over_at ? `done${row.handover_to ? ` to ${peopleById.get(row.handover_to) ?? "colleague"}` : ""}` : row.status === "rejected" ? "not required" : "pending"}</Text>
        <Text variant="small">HR remark: {row.hr_remark ?? "—"}</Text>
        <Button label="View TL approval" onPress={() => void openImage(row.tl_approval_path)} variant="secondary" />
        {row.handover_approval_path ? <Button label="View handover proof" onPress={() => void openImage(row.handover_approval_path!)} variant="secondary" /> : null}
        {row.status === "pending" ? <Button label="Edit" onPress={() => { setEditId(row.id); setEditDates({ leaveStart: row.leave_start, leaveEnd: row.leave_end, workStartDate: row.work_start_date, workStartIn: row.work_start_in as ReturnHalf }); }} variant="secondary" /> : null}
        {leaveNeedsHandover(row) ? <Button label="Handover" onPress={() => fillHandover(row.id)} variant="secondary" /> : null}
        {editId === row.id && row.status === "pending" ? <View style={{ gap: 10 }}>
          <Text weight="semibold">Edit leave (pending only)</Text>
          <DateField disabled={false} invalid={false} label="Leave start date" mode="date" onChange={(value) => setEditDates({ ...editDates, leaveStart: value })} value={editDates.leaveStart} />
          <DateField disabled={false} invalid={editDates.leaveEnd < editDates.leaveStart} label="Leave end date" mode="date" onChange={(value) => setEditDates({ ...editDates, leaveEnd: value })} value={editDates.leaveEnd} />
          <DateField disabled={false} invalid={false} label="Work start date" mode="date" onChange={(value) => setEditDates({ ...editDates, workStartDate: value })} value={editDates.workStartDate} />
          <OptionPicker label="Work start in" options={halfOptions} selected={[editDates.workStartIn]} onChange={(value) => setEditDates({ ...editDates, workStartIn: value[0] as ReturnHalf })} />
          <Button busy={busy} disabled={editDates.leaveEnd < editDates.leaveStart} label="Save" onPress={() => void run(async () => { await editPendingLeave(row.id, editDates); setEditId(null); }, "Leave updated. Leave count and inform status recalculated.")} />
          <Button label="Close" onPress={() => setEditId(null)} variant="secondary" />
        </View> : null}
      </Card>)}
    </View> : null}

    {tab === "review" && canReview ? <View style={{ gap: 10 }}>
      {rows.filter((row) => row.status === "pending").map((row) => <Card key={row.id}><Text weight="semibold">{peopleById.get(row.applicant_id) ?? row.applicant_id} · {row.leave_type}</Text><Text tone="muted" variant="caption">{row.reference_code}</Text><Text variant="small">{formatLeaveDate(row.leave_start)} to {formatLeaveDate(row.leave_end)} · {row.total_leave_count} days · {row.inform_status}</Text><Text variant="small">{row.reason}</Text><Text tone="muted" variant="small">Handover: {row.handed_over_at ? peopleById.get(row.handover_to ?? "") ?? "Done" : "Pending"}</Text><Button label="View TL approval" onPress={() => void openImage(row.tl_approval_path)} variant="secondary" />{row.handover_approval_path ? <Button label="View handover proof" onPress={() => void openImage(row.handover_approval_path!)} variant="secondary" /> : null}{reviewId === row.id ? <><TextField label="HR remark" maxLength={1000} multiline onChangeText={setRemark} value={remark} /><Button busy={busy} disabled={row.applicant_id === profile.id} label="Approve and mark absent" onPress={() => void run(async () => { await reviewLeave(row.id, true, remark); setReviewId(null); setRemark(""); }, "Leave approved and Availability updated.")} /><Button busy={busy} disabled={row.applicant_id === profile.id || !remark.trim()} label="Reject" onPress={() => void run(async () => { await reviewLeave(row.id, false, remark); setReviewId(null); setRemark(""); }, "Leave rejected.")} variant="danger" /></> : <Button disabled={row.applicant_id === profile.id} label="Review this request" onPress={() => { setReviewId(row.id); setRemark(""); }} variant="secondary" />}</Card>)}
      {rows.every((row) => row.status !== "pending") ? <Card><Text tone="muted">No pending requests.</Text></Card> : null}
    </View> : null}
  </View>;
}
