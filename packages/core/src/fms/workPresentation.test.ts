import { describe, expect, it } from "vitest";
import { fmsOutcomeReplacesStage, fmsWorkTitle, presentFmsWorkContext, type FmsWorkContext } from "./workPresentation";

const context: FmsWorkContext = { workflowName: "Jewellery enquiry", stageName: "Introduction Call", reference: "FMS-TEST",
  instructions: "Call the client", expectedResult: "Record response", dueAt: null, assignedNames: ["Employee B"],
  titleTemplate: "{initial.client_name} — {stage}", shortDescription: "", dueLabel: "Due", nextCursor: null,
  receivedFields: [{ sourceStageKey: "initial", submissionId: "submission", formTemplateId: "pinned", formName: "Enquiry", formVersion: 1,
    field: { key: "client_name", label: "Client name", type: "text", sortOrder: 0 }, value: "Synthetic client", userName: null }], journey: [] };

describe("FMS work presentation", () => {
  it("uses the server-authorized record name consistently and keeps durable identity", () => {
    expect(presentFmsWorkContext({ ...context, recordName: "  Rahul\nShah  " }).title).toBe("Rahul Shah");
    expect(presentFmsWorkContext({ ...context, recordName: "Rahul Shah" }).reference).toBe("FMS-TEST");
  });
  it("uses resolved branch names and does not invent an unanswered attachment", () => {
    const branch = { ...context.receivedFields[0]!, field: { key: "branch", label: "Branch", type: "branch_dropdown" as const, sortOrder: 0 }, value: "00000000-0000-4000-8000-000000000001", valueLabel: "Bandra" };
    expect(presentFmsWorkContext({ ...context, receivedFields: [branch] }).answers[0]?.display).toBe("Bandra");
    const absentFile = { ...branch, field: { key: "file", label: "Attachment", type: "file" as const, sortOrder: 1 }, value: null, valueLabel: null };
    expect(presentFmsWorkContext({ ...context, receivedFields: [absentFile] }).answers[0]?.display).not.toBe("Attachment provided");
  });
  it("builds the configured task title from authorized fields", () => {
    expect(presentFmsWorkContext(context).title).toBe("Synthetic client — Introduction Call");
    expect(presentFmsWorkContext(context).answers).toEqual([{ label: "Client name", display: "Synthetic client", answered: true, source: "Enquiry · v1" }]);
  });
  it("keeps historical employee identifiers out of work summaries", () => {
    const value = presentFmsWorkContext({ ...context, receivedFields: [{ ...context.receivedFields[0]!,
      field: { key: "owner", label: "Previous employee", type: "user_dropdown", sortOrder: 0 }, value: "00000000-0000-4000-8000-000000000001" }] });
    expect(value.answers[0]?.display).toBe("Historical employee");
    expect(JSON.stringify(value)).not.toContain("00000000-0000");
  });
  it("uses a readable default and never renders unresolved template keys", () => {
    expect(presentFmsWorkContext({ ...context, titleTemplate: "{private_notes}" }).title).toBe("Jewellery enquiry — Introduction Call");
    expect(presentFmsWorkContext({ ...context, titleTemplate: "" }).title).toBe("Jewellery enquiry — Introduction Call");
  });
  it("uses an authorized received value as the configured reference", () => {
    const work = presentFmsWorkContext({ ...context, referenceKey: "initial.client_name", titleTemplate: "{reference} - {stage}" });
    expect(work.reference).toBe("Synthetic client");
    expect(work.title).toBe("Synthetic client - Introduction Call");
    expect(presentFmsWorkContext({ ...context, referenceKey: "hidden.secret" }).reference).toBe("FMS-TEST");
  });

});

it("distinguishes identical stage titles using the durable workflow reference", () => {
  expect(fmsWorkTitle("Instagram leads - Introduction call", "FMS-000041")).toBe("Instagram leads - Introduction call | FMS-000041");
  expect(fmsWorkTitle("Instagram leads - Introduction call", "FMS-000042")).not.toBe(fmsWorkTitle("Instagram leads - Introduction call", "FMS-000041"));
  expect(fmsWorkTitle("Call FMS-000041", "FMS-000041")).toBe("Call FMS-000041");
});

it("retains deferred requirements and approval controls", () => {
  expect(fmsOutcomeReplacesStage("form_saved_pending_completion")).toBe(false);
  expect(fmsOutcomeReplacesStage("awaiting_approval")).toBe(false);
  expect(fmsOutcomeReplacesStage("awaiting_other_doers")).toBe(false);
  expect(fmsOutcomeReplacesStage("successors_activated")).toBe(true);
});
