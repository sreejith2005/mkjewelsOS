// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { VoiceDeadline } from "@jewelos/core";
import type { UserProfile } from "@/types";
import type { TaskReferenceData } from "./api";
import type { VoiceTaskInterpretation } from "./voiceApi";

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));

// The recorder itself is exercised by hand; these tests cover what the composer
// does with an interpretation, which is where the assignment risk lives.
const { interpretationRef } = vi.hoisted(() => ({ interpretationRef: { current: null as VoiceTaskInterpretation | null } }));
vi.mock("./VoiceTaskCapture", () => ({
  VoiceTaskCapture: ({ onInterpreted }: { onInterpreted: (value: VoiceTaskInterpretation) => void }) => (
    <button onClick={() => interpretationRef.current && onInterpreted(interpretationRef.current)} type="button">Apply voice note</button>
  ),
}));

const { TaskComposer } = await import("./TaskComposer");

afterEach(() => {
  cleanup();
  toastSuccess.mockClear();
  interpretationRef.current = null;
});

const data = {
  branches: [{ id: "branch-1", name: "Bandra" }],
  categories: [{ id: "category-1", label: "Operations" }],
  priorities: [{ id: "priority-high", label: "High", value: "high" }, { id: "priority-low", label: "Low", value: "low" }],
  departments: [{ branch_id: "branch-1", id: "department-1", name: "Sales" }],
  designations: [],
  forms: [],
  templates: [],
  users: [
    { branch_id: "branch-1", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1", employee_code: "E-1", employee_name: "Ashwini", first_name: "Ashwini", id: "user-1", last_name: null, tenant_id: "tenant-1", user_role: "manager", working_status: "active" },
    { branch_id: "branch-1", buddy_id: null, secondary_buddy_id: null, reports_to_user_id: null, department_id: "department-1", employee_code: "E-2", employee_name: "Teammate", first_name: "Teammate", id: "doer-1", last_name: null, tenant_id: "tenant-1", user_role: "staff", working_status: "active" },
  ],
} as TaskReferenceData;

const profile = {
  branch_id: "branch-1",
  department_id: "department-1",
  designation_id: null,
  id: "user-1",
  tenant_id: "tenant-1",
  user_role: "manager",
} as UserProfile;

const tomorrow = new Date(Date.now() + 86_400_000).toISOString();

const resolvedDeadline: VoiceDeadline = {
  status: "resolved",
  dateExpression: "tomorrow",
  timeExpression: null,
  hasExplicitDate: true,
  hasExplicitTime: false,
  date: tomorrow.slice(0, 10),
  time: "19:00",
  timeSource: "default",
  range: null,
  plannedDatetime: tomorrow,
  timeZone: "Asia/Kolkata",
  note: "“tomorrow” → tomorrow, 7:00 PM (no time said, default 7:00 PM)",
};

const unresolvedDeadline = (overrides: Partial<VoiceDeadline>): VoiceDeadline => ({
  ...resolvedDeadline, date: null, time: null, timeSource: null, plannedDatetime: null, note: null, ...overrides,
});

const interpretation = (overrides: Partial<VoiceTaskInterpretation["draft"]> = {}, gaps: VoiceTaskInterpretation["gaps"] = []): VoiceTaskInterpretation => ({
  transcript: "Ask Teammate to count the stock by tomorrow",
  gaps,
  draft: {
    title: "Count the stock",
    description: "Front display only",
    assigneeId: "doer-1",
    assignmentReason: 'Matched "Teammate"',
    plannedDatetime: tomorrow,
    deadline: resolvedDeadline,
    priority: "low",
    taskType: "delegation",
    checklist: [],
    ...overrides,
  },
});

function renderComposer(overrides: Partial<Parameters<typeof TaskComposer>[0]> = {}) {
  const onSave = vi.fn().mockResolvedValue("task-1");
  render(<TaskComposer
    canUseVoice
    data={data}
    onClose={vi.fn()}
    onCreated={vi.fn()}
    onSave={onSave}
    onUploadAttachment={vi.fn()}
    profile={profile}
    {...overrides}
  />);
  return { onSave };
}

describe("TaskComposer voice capture", () => {
  it("is offered only to authors the database grants task management", () => {
    renderComposer({ canUseVoice: false });
    expect(screen.queryByRole("button", { name: "Apply voice note" })).toBeNull();
  });

  it("prefills every field the note supplied and assigns through the existing write path", async () => {
    interpretationRef.current = interpretation();
    const { onSave } = renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Apply voice note" }));

    expect((screen.getByPlaceholderText("Add Title") as HTMLInputElement).value).toBe("Count the stock");
    expect((screen.getByPlaceholderText("Add Description") as HTMLTextAreaElement).value).toBe("Front display only");
    expect(screen.getByTestId("task-selector-users").textContent).toContain("1 user");
    expect(screen.getByTestId("voice-assignment-reason").textContent).toContain('Matched "Teammate"');
    expect(screen.queryByTestId("voice-gap-alert")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Assign Task/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [payload, doers] = onSave.mock.calls[0] as [Record<string, unknown>, string[]];
    expect(payload.title).toBe("Count the stock");
    expect(payload.priority).toBe("low");
    expect(doers).toEqual(["doer-1"]);
  });

  it("raises a popup naming the missing user and still blocks the assignment", async () => {
    interpretationRef.current = interpretation({ assigneeId: null, assignmentReason: null }, ["assignee"]);
    const { onSave } = renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Apply voice note" }));

    const alert = screen.getByTestId("voice-gap-alert");
    expect(alert.textContent).toContain("User not selected.");

    fireEvent.click(screen.getByRole("button", { name: /Assign Task/i }));
    await waitFor(() => expect(screen.getByText("Select at least one user.")).toBeTruthy());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("opens the user selector when the author dismisses the popup", () => {
    interpretationRef.current = interpretation({ assigneeId: null, assignmentReason: null }, ["assignee"]);
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Apply voice note" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill them in" }));

    expect(screen.queryByTestId("voice-gap-alert")).toBeNull();
    expect(screen.getByTestId("task-panel-users")).toBeTruthy();
  });

  it("clears the outstanding warning once the author fills the gap by hand", () => {
    interpretationRef.current = interpretation({ assigneeId: null, assignmentReason: null }, ["assignee"]);
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Apply voice note" }));
    fireEvent.click(screen.getByRole("button", { name: "Fill them in" }));
    expect(screen.getByTestId("voice-gap-notice")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Teammate"));

    expect(screen.queryByTestId("voice-gap-notice")).toBeNull();
  });

  it("warns that no user is selected when the note resolved someone this author cannot pick", () => {
    interpretationRef.current = interpretation({ assigneeId: "outside-scope" }, []);
    const { onSave } = renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Apply voice note" }));

    expect(screen.getByTestId("voice-gap-alert").textContent).toContain("User not selected.");
    expect(screen.queryByTestId("voice-assignment-reason")).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("does not report a gap the author already filled by hand before recording", () => {
    interpretationRef.current = interpretation({ assigneeId: null, assignmentReason: null }, ["assignee"]);
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: /Users/i }));
    fireEvent.click(screen.getByLabelText("Teammate"));
    fireEvent.click(screen.getByRole("button", { name: "Apply voice note" }));

    expect(screen.queryByTestId("voice-gap-alert")).toBeNull();
    expect(screen.getByTestId("task-selector-users").textContent).toContain("1 user");
  });

  it("keeps a missing deadline out of the form rather than guessing one", () => {
    interpretationRef.current = interpretation({ plannedDatetime: null, deadline: unresolvedDeadline({ status: "missing", dateExpression: null, hasExplicitDate: false }) }, ["due"]);
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Apply voice note" }));

    expect(screen.getByTestId("voice-gap-alert").textContent).toContain("Due date and time not set.");
    expect(screen.getByRole("button", { name: /Due Date/i }).textContent).not.toMatch(/\d/);
  });

  it("shows how the spoken deadline was read before Assign", () => {
    interpretationRef.current = interpretation();
    renderComposer();

    fireEvent.click(screen.getByRole("button", { name: "Apply voice note" }));

    const note = screen.getByTestId("voice-deadline-note");
    expect(note.textContent).toContain("“tomorrow”");
    expect(note.className).not.toContain("text-danger");
  });

  it("replaces an earlier voice deadline when the next note names a deadline that needs a choice", async () => {
    interpretationRef.current = interpretation();
    const { onSave } = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: "Apply voice note" }));
    expect(screen.getByTestId("task-selector-due").textContent).toMatch(/\d/);

    interpretationRef.current = interpretation({
      plannedDatetime: null,
      deadline: unresolvedDeadline({
        status: "ambiguous",
        dateExpression: "next week",
        range: { start: "2026-09-28", end: "2026-10-04" },
        note: "“next week” covers Mon 28 Sep 2026 – Sun 4 Oct 2026. Choose the exact day.",
      }),
    }, ["due"]);
    fireEvent.click(screen.getByRole("button", { name: "Apply voice note" }));

    expect(screen.getByTestId("voice-gap-alert").textContent).toContain("Due date and time not set.");
    expect(screen.getByTestId("task-selector-due").textContent).not.toMatch(/\d/);
    const note = screen.getByTestId("voice-deadline-note");
    expect(note.textContent).toContain("Choose the exact day.");
    expect(note.className).toContain("text-danger");

    fireEvent.click(screen.getByRole("button", { name: /Assign Task/i }));
    await waitFor(() => expect(screen.getByText("Choose a due date and time.")).toBeTruthy());
    expect(onSave).not.toHaveBeenCalled();
  });
});
