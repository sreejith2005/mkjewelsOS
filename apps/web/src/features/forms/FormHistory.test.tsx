// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormHistory } from "./FormHistory";
import { loadFormHistory, restoreFormCheckpoint, type FormCheckpoint } from "./historyApi";
vi.mock("./historyApi", () => ({ loadFormHistory: vi.fn(), loadFormProvenance: vi.fn(async () => ({})), restoreFormCheckpoint: vi.fn() }));
vi.mock("./FormRenderer", () => ({ FormRenderer: ({ definition }: { definition: { name: string } }) => <p>Snapshot: {definition.name}</p> }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const rows: FormCheckpoint[] = [
  { id: "latest", template_id: "t", family_id: "f", version: 2, sequence: 2, action: "published_edit", lifecycle: "published", actor_name: "Author", created_at: "2026-10-24T09:00:00Z", definition: { name: "Current definition", fields: [] }, change_note: null, previous_id: "old" },
  { id: "old", template_id: "t", family_id: "f", version: 2, sequence: 1, action: "published", lifecycle: "published", actor_name: "Author", created_at: "2026-10-23T09:00:00Z", definition: { name: "Historical definition", fields: [] }, change_note: "Previous release", previous_id: null },
];
describe("checkpoint history", () => {
  it("shows stable option values when labels stay the same", async () => {
    vi.mocked(loadFormHistory).mockResolvedValue(rows.map((row, index) => ({ ...row, definition: { name: "Choices", fields: [{ key: "answer", label: "Purchase", type: "radio", sortOrder: 0, options: [{ value: index ? "yes" : "purchased", label: "Yes" }] }] } })));
    render(<FormHistory templateId="t" name="Enquiry" dynamicOptions={{ users: [], branches: [], departments: [], masters: [] }} onClose={vi.fn()} onRestored={vi.fn(async () => {})} />);
    expect(await screen.findByText("Yes (value: yes) → Yes (value: purchased)")).toBeTruthy();
  });
  it("previews exact selected snapshots and restores by checkpoint with latest conflict token", async () => {
    vi.mocked(loadFormHistory).mockResolvedValue(rows);
    vi.mocked(restoreFormCheckpoint).mockResolvedValue("new-draft");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const restored = vi.fn(async () => {});
    render(<FormHistory templateId="t" name="Enquiry" dynamicOptions={{ users: [], branches: [], departments: [], masters: [] }} onClose={vi.fn()} onRestored={restored} />);
    await screen.findByText("Previous release");
    fireEvent.click(screen.getByText("Previous release"));
    fireEvent.click(screen.getByRole("button", { name: "View historical form" }));
    expect(screen.getByText("Snapshot: Historical definition")).toBeTruthy();
    expect(screen.queryByText("Snapshot: Current definition")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Restore as New Draft" }));
    expect(restoreFormCheckpoint).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Review checkpoint restoration" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirm restore as new draft" }));
    await waitFor(() => expect(restoreFormCheckpoint).toHaveBeenCalledWith("old", false, "latest"));
    expect(restored).toHaveBeenCalledWith("new-draft");
  });
  it("reports existing draft conflicts and does not announce a successful restore", async () => {
    vi.mocked(loadFormHistory).mockResolvedValue(rows);
    vi.mocked(restoreFormCheckpoint).mockRejectedValue(new Error("This form family already has a draft revision"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const restored = vi.fn(async () => {});
    render(<FormHistory templateId="t" name="Enquiry" dynamicOptions={{ users: [], branches: [], departments: [], masters: [] }} onClose={vi.fn()} onRestored={restored} />);
    await screen.findByText("Previous release");
    fireEvent.click(screen.getByRole("button", { name: "Restore as New Draft" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm restore as new draft" }));
    expect(await screen.findByText("This form family already has a draft revision")).toBeTruthy();
    expect(restored).not.toHaveBeenCalled();
  });
});
