import { describe, expect, it } from "vitest";
import { presentFmsWorkContext, type FmsWorkContext } from "./workPresentation";

const context: FmsWorkContext = { workflowName: "Jewellery enquiry", stageName: "Introduction Call", reference: "FMS-TEST",
  instructions: "Call the client", expectedResult: "Record response", dueAt: null, assignedNames: ["Employee B"],
  titleTemplate: "{initial.client_name} — {stage}", shortDescription: "", dueLabel: "Due", nextCursor: null,
  receivedFields: [{ sourceStageKey: "initial", submissionId: "submission", formTemplateId: "pinned", formName: "Enquiry", formVersion: 1,
    field: { key: "client_name", label: "Client name", type: "text", sortOrder: 0 }, value: "Synthetic client", userName: null }], journey: [] };

describe("FMS work presentation", () => {
  it("builds the configured task title from authorized fields", () => {
    expect(presentFmsWorkContext(context).title).toBe("Synthetic client — Introduction Call");
    expect(presentFmsWorkContext(context).answers).toEqual([{ label: "Client name", display: "Synthetic client", source: "Enquiry · v1" }]);
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
