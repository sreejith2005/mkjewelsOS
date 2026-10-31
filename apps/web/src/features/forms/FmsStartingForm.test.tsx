// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormTemplateDefinition } from "@jewelos/core";
import { FmsStartingForm } from "./FmsStartingForm";

const mocks = vi.hoisted(() => ({ confirmWork: vi.fn(), onSaved: vi.fn() }));
vi.mock("./api", () => ({ signedFormFileUrl: vi.fn(), uploadFormFile: vi.fn(), submitStandaloneFormAndStartFms: vi.fn() }));
vi.mock("@jewelos/data/fms/work", () => ({
  listFmsFormStarters: async () => [{ flowId: "flow-1", name: "Synthetic workflow", version: 1 }],
  recoverFmsStartingWork: async () => null,
  recoverFmsStartingFlow: async () => null,
  recoverLibrarySubmission: async () => null,
  beginNewLibrarySubmission: vi.fn(), beginNewFmsStartingFlow: vi.fn(),
  fmsStartConfirmationFromWork: () => ({ instanceId: "instance-1", referenceNumber: "FMS-1" }),
}));
vi.mock("@/features/fms/useFmsHandoffConfirmation", () => ({ useFmsHandoffConfirmation: () => ({ confirmWork: mocks.confirmWork, confirmation: null }) }));

const definition: FormTemplateDefinition = {
  name: "Synthetic assignment form",
  sections: [{ key: "one", title: "First section" }, { key: "two", title: "Second section" }, { key: "three", title: "Last section" }],
  fields: Array.from({ length: 9 }, (_, index) => ({ key: `answer_${index}`, label: `Answer ${index}`, type: "text", sectionKey: ["one", "two", "three"][Math.floor(index / 3)]!, sortOrder: index })),
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("FMS starting form submission boundary", () => {
  it.each([undefined, "starter-1"])("confirms once after all sections, with starter assignment %s", async starterAssignmentId => {
    mocks.confirmWork.mockResolvedValue({ instanceId: "instance-1" });
    mocks.onSaved.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<FmsStartingForm definition={definition} formId="form-1" {...(starterAssignmentId ? { starterAssignmentId } : {})} onSaved={mocks.onSaved} />);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(mocks.confirmWork).not.toHaveBeenCalled();
    await user.type(screen.getByRole("textbox", { name: /Answer 8/ }), "Finished");
    await user.click(screen.getByRole("button", { name: "Submit form" }));
    expect(mocks.confirmWork).toHaveBeenCalledExactlyOnceWith({
      kind: starterAssignmentId ? "starter_form" : "flow_form",
      ...(starterAssignmentId ? { starterAssignmentId } : { flowId: "flow-1" }),
      formTemplateId: "form-1", answers: { answer_8: "Finished" },
    });
    expect(mocks.onSaved).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Form submitted successfully/)).toBeTruthy();
  });
});
