// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormBuilder } from "./FormBuilder";

vi.mock("@/features/dropdowns/api", () => ({ createMasterList: vi.fn(), loadMasterOptions: async () => [], toFormMasterOptions: () => [] }));
vi.mock("./api", () => ({ formUsageImpact: vi.fn(), saveDraft: vi.fn(), savePublishedForm: vi.fn() }));

const options = { users: [], branches: [], departments: [], masters: [] };
afterEach(cleanup);

describe("Form Builder creation tools", () => {
  it("keeps the creation tools in one bar and adds a question where the author is working", async () => {
    const user = userEvent.setup();
    render(<FormBuilder dynamicOptions={options} onClose={() => {}} onSaved={async () => {}} />);
    const tools = screen.getByRole("navigation", { name: "Form building tools" });
    expect(within(tools).getByRole("button", { name: "Delete selected question" }).hasAttribute("disabled")).toBe(true);

    await user.click(within(tools).getByRole("button", { name: "Add question" }));
    await user.click(screen.getByRole("button", { name: "Text" }));
    // The new question opens for editing and the selection tools come alive.
    expect(screen.getAllByLabelText("Question")).toHaveLength(1);
    expect(within(tools).getByRole("button", { name: "Duplicate selected question" }).hasAttribute("disabled")).toBe(false);

    await user.click(within(tools).getByRole("button", { name: "Duplicate selected question" }));
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(2);
    await user.click(within(tools).getByRole("button", { name: "Delete selected question" }));
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(1);
  });

  it("adds a section right after the current one, without the old top panel", async () => {
    const user = userEvent.setup();
    render(<FormBuilder dynamicOptions={options} onClose={() => {}} onSaved={async () => {}} />);
    expect(screen.queryByText("Manage sections")).toBeNull();
    const tools = screen.getByRole("navigation", { name: "Form building tools" });
    await user.click(within(tools).getByRole("button", { name: "Add section" }));
    expect(screen.getByRole("region", { name: "Section 2: Section 2" })).toBeTruthy();
    expect((screen.getByLabelText("Section 1 title") as HTMLInputElement).value).toBe("Section 1");

    // Working in Section 1 again puts the next section between 1 and 2.
    await user.click(screen.getByLabelText("Section 1 title"));
    await user.click(within(tools).getByRole("button", { name: "Add section" }));
    expect((screen.getByLabelText("Section 2 title") as HTMLInputElement).value).toBe("Section 3");
    expect((screen.getByLabelText("Section 3 title") as HTMLInputElement).value).toBe("Section 2");
  });

  it("adds a heading and a divider from the tools", async () => {
    const user = userEvent.setup();
    render(<FormBuilder dynamicOptions={options} onClose={() => {}} onSaved={async () => {}} />);
    const tools = screen.getByRole("navigation", { name: "Form building tools" });
    await user.click(within(tools).getByRole("button", { name: "Add heading" }));
    await user.click(within(tools).getByRole("button", { name: "Add divider" }));
    expect(screen.getByRole("button", { name: "Edit Heading" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Divider" })).toBeTruthy();
  });
});
