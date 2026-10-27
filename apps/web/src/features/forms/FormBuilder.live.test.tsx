// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormBuilder } from "./FormBuilder";
import type { FormBundle } from "./api";
vi.mock("@/features/dropdowns/api", () => ({ loadMasterOptions: vi.fn(async () => []), toFormMasterOptions: vi.fn(() => []) }));
afterEach(cleanup);
const bundle = { id: "a", name: "Enquiry", lifecycle: "draft", permissions: { roles: ["staff"] }, fields: [{ key: "name", label: "Name", type: "text", sortOrder: 0 }] } as unknown as FormBundle;
describe("live builder preview", () => {
  it("updates labels while retaining test answers and the mounted editor", () => {
    render(<FormBuilder bundle={bundle} dynamicOptions={{ users: [], branches: [], departments: [], masters: [] }} onClose={vi.fn()} onSaved={vi.fn(async () => {})} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview form" }));
    const preview = within(screen.getByRole("complementary", { name: "Live preview" }));
    fireEvent.change(preview.getByLabelText("Name"), { target: { value: "Test" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview form" }));
    expect(screen.queryByRole("complementary", { name: "Live preview" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit Name" }));
    fireEvent.change(screen.getByLabelText("Question"), { target: { value: "Client name" } });
    fireEvent.click(screen.getByRole("button", { name: "Preview form" }));
    expect((preview.getByLabelText("Client name") as HTMLInputElement).value).toBe("Test");
    expect(screen.getByLabelText("Form name")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Reset Preview" }));
    expect((preview.getByLabelText("Client name") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Preview form" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove Client name" }));
    expect(preview.queryByLabelText("Client name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add question to Section 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Text" }));
    fireEvent.click(screen.getByRole("button", { name: "Preview form" }));
    expect(preview.getByLabelText("Text")).toBeTruthy();
  });
});
