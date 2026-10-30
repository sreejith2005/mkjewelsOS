// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import type { FmsSlaRule, FmsStageDefinition } from "@jewelos/core";
import type { FmsData } from "./api";
import { FmsDueDateSource, fmsDueSourceMode } from "./FmsDueDateSource";

afterEach(cleanup);
const introForm = "11111111-1111-4111-8111-111111111111";
const demoForm = "22222222-2222-4222-8222-222222222222";
const step = (key: string, order: number, patch: Partial<FmsStageDefinition> = {}): FmsStageDefinition => ({
  key, name: key === "intro" ? "Introduction" : key === "demo" ? "Demo" : "Follow-up 1", type: "form", order, required: true, completionRule: "any_doer", allowMultipleDoers: false,
  requiresUpload: false, requiresRemark: false, checklist: [], assigneeRules: [], requiresNextDoerHandoff: false, canMoveBackward: false, canReject: false, canRequestRevision: false,
  canEscalate: false, branchRules: [], parallelTargetStageKeys: [], joinRequiredStageKeys: [], sla: { dueDate: "", deadlineEnabled: true, timingMethod: "completion_date" }, ...patch,
});
// Only the fields the editor reads; the rest of FmsData is irrelevant here.
const data = { formFields: {
  [introForm]: [{ key: "status", label: "Interested", type: "radio" }, { key: "next_date", label: "Next Follow-up Date", type: "date" }, { key: "next_time", label: "Follow-up Time", type: "text" }],
  [demoForm]: [{ key: "demo_date", label: "Demo Date", type: "date" }, { key: "meet_at", label: "Next Meeting Date and Time", type: "datetime" }],
}, formSections: {} } as unknown as FmsData;

function Harness({ initial }: { initial: FmsSlaRule }) {
  const [sla, setSla] = useState<FmsSlaRule>(initial);
  const stages = [step("intro", 0, { formTemplateId: introForm, defaultNextStageKey: "f1" }), step("demo", 1, { formTemplateId: demoForm, defaultNextStageKey: "f1" }), step("f1", 2, { sla })];
  return <><FmsDueDateSource data={data} stage={stages[2]!} stageIndex={2} stages={stages} timing={(kind) => <p>timing:{kind}</p>} updateSla={(patch) => setSla((current) => ({ ...current, ...patch }))} />
    <output data-testid="sla">{JSON.stringify(sla)}</output></>;
}
const sla = () => JSON.parse(screen.getByTestId("sla").textContent ?? "{}") as FmsSlaRule;

it("suggests the one clearly named date question per route and never guesses between two", async () => {
  render(<Harness initial={{ dueDate: "", deadlineEnabled: true, timingMethod: "completion_date" }} />);
  expect(screen.getByText("timing:fixed")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: /From form answer/ }));
  expect(sla().formDue).toEqual({ sources: [{ stageKey: "intro", dateFieldKey: "next_date", timeFieldKey: "next_time" }], onMissing: "none" });
  expect((screen.getByRole("combobox", { name: "Due date question from Introduction" }) as HTMLSelectElement).value).toBe("next_date");
  expect((screen.getByRole("combobox", { name: "Due time question from Introduction" }) as HTMLSelectElement).value).toBe("next_time");
  // Demo's form has two date questions, so the author must choose.
  expect(screen.getByText("This form has several date questions. Choose the one that sets the due date.")).toBeTruthy();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "Due date question from Demo" }), "meet_at");
  expect(sla().formDue?.sources).toEqual([{ stageKey: "intro", dateFieldKey: "next_date", timeFieldKey: "next_time" }, { stageKey: "demo", dateFieldKey: "meet_at" }]);
  // A date-and-time question carries its own time.
  expect(screen.queryByRole("combobox", { name: "Due time question from Demo" })).toBeNull();
});

it("keeps an explicit configuration, offers the missing-answer policies and the fallback timing", async () => {
  render(<Harness initial={{ dueDate: "", deadlineEnabled: true, formDue: { sources: [{ stageKey: "demo", dateFieldKey: "demo_date" }], onMissing: "none" } }} />);
  expect((screen.getByRole("combobox", { name: "Due date question from Demo" }) as HTMLSelectElement).value).toBe("demo_date");
  expect(screen.queryByText("timing:fallback")).toBeNull();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "If the due date is missing" }), "fallback");
  expect(screen.getByText("timing:fallback")).toBeTruthy();
  await userEvent.selectOptions(screen.getByRole("combobox", { name: "If the due date is missing" }), "require");
  expect(sla().formDue?.onMissing).toBe("require");
  await userEvent.type(screen.getByLabelText("Default due time"), "15:30");
  expect(sla().formDue?.defaultTime).toBe("15:30");
  await userEvent.click(screen.getByRole("button", { name: /TAT \/ relative/ }));
  expect(sla().formDue).toBeUndefined(); expect(sla().timingMethod).toBe("tat_hours");
  expect(fmsDueSourceMode(sla())).toBe("tat");
});
