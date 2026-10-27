// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FormRenderer } from "./FormRenderer";
import type { FormTemplateDefinition } from "@jewelos/core";
afterEach(cleanup);
describe("safe interactive preview", () => {
  it("clears answers made incompatible by edited conditions or choices", () => {
    const definition: FormTemplateDefinition = { name: "Test", fields: [{ key: "purchase", label: "Purchase", type: "select", sortOrder: 0, options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] }, { key: "budget", label: "Budget", type: "text", sortOrder: 1, condition: { fieldKey: "purchase", operator: "equals", value: "no" } }] };
    const { rerender } = render(<FormRenderer definition={definition} preview />);
    fireEvent.change(screen.getByLabelText("Purchase"), { target: { value: "no" } });
    fireEvent.change(screen.getByLabelText("Budget"), { target: { value: "Old test answer" } });
    const changed: FormTemplateDefinition = { ...definition, fields: [definition.fields[0]!, { ...definition.fields[1]!, condition: { fieldKey: "purchase", operator: "equals", value: "yes" } }] };
    rerender(<FormRenderer definition={changed} preview />);
    fireEvent.change(screen.getByLabelText("Purchase"), { target: { value: "yes" } });
    expect((screen.getByLabelText("Budget") as HTMLInputElement).value).toBe("");
    rerender(<FormRenderer definition={{ ...changed, fields: [{ ...changed.fields[0]!, options: [{ value: "no", label: "No" }] }, changed.fields[1]!] }} preview />);
    expect((screen.getByLabelText("Purchase") as HTMLSelectElement).value).toBe("");
  });
  it("runs real validation without invoking a submission or FMS callback", () => {
    const submit = vi.fn(async () => {});
    render(<FormRenderer definition={{ name: "Test", fields: [{ key: "name", label: "Name", type: "text", sortOrder: 0, required: true }] }} preview onSubmit={submit} />);
    fireEvent.click(screen.getByRole("button", { name: "Test validation" }));
    expect(screen.getByRole("alert").textContent).toContain("Name is required");
    fireEvent.change(screen.getByRole("textbox", { name: /Name/ }), { target: { value: "Test answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Test validation" }));
    expect(screen.getByText("Test validation passed. No data was submitted.")).toBeTruthy();
    expect(submit).not.toHaveBeenCalled();
  });
  it("never mounts an upload input in test mode even when a template ID is supplied", () => {
    const { container } = render(<FormRenderer definition={{ name: "Test", fields: [{ key: "proof", label: "Proof", type: "file", sortOrder: 0 }] }} templateId="stored-template" preview />);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.getByText("Test mode: file uploads are disabled. No file will be stored.")).toBeTruthy();
  });
});
