// @vitest-environment jsdom
// CRM question types in the shared form renderer (owner request 2026-11-03).
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormCrmServices, FormTemplateDefinition } from "@jewelos/core";
import { FormRenderer } from "./FormRenderer";
import { FormCrmServicesContext } from "./crmServicesContext";

vi.mock("./api", () => ({ uploadFormFile: vi.fn(), signedFormFileUrl: vi.fn() }));
afterEach(cleanup);

const definition: FormTemplateDefinition = { name: "Walk-in", fields: [
  { key: "mobile", label: "Mobile", type: "phone", sortOrder: 0, required: true },
  { key: "client_name", label: "Client name", type: "text", sortOrder: 1 },
  { key: "gender", label: "Gender", type: "select", sortOrder: 2, options: [{ value: "female", label: "FEMALE" }, { value: "male", label: "MALE" }] },
  { key: "salesperson", label: "Salesperson", type: "text", sortOrder: 3, required: true },
  { key: "companions", label: "Family / friends", type: "repeat", sortOrder: 4, validation: { repeat: { countLabel: "How many are with them?", min: 0, max: 5, fields: [
    { key: "name", label: "Name", type: "text", required: true }, { key: "relation", label: "Relation", type: "select", options: [{ value: "wife", label: "Wife" }] },
  ] } } },
  { key: "proof", label: "Google review proof", type: "crm_photo", sortOrder: 5, required: true },
] };

function services(overrides: Partial<FormCrmServices> = {}): FormCrmServices {
  return {
    choices: (fieldKey) => fieldKey === "salesperson" ? ["Priya", "Arun"] : null,
    lookup: vi.fn(async () => ({ details: { primary_name: "Asha", gender: "FEMALE" } })),
    upload: vi.fn(async (_key: string, file: File) => ({ path: `c1/t1/u_${file.name}`, clientId: "c1", fileName: file.name, mimeType: file.type })),
    remove: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe("CRM questions in a form CRM opens", () => {
  it("fills a registered client's details from any phone question, asks how many, shows row questions and uploads to CRM", async () => {
    const crm = services();
    const onSubmit = vi.fn(async () => true);
    render(<FormRenderer crm={crm} definition={definition} onSubmit={onSubmit} submitLabel="Submit complete visit" />);

    fireEvent.change(screen.getByLabelText(/^Mobile/), { target: { value: "9876543210" } });
    await waitFor(() => expect(crm.lookup).toHaveBeenCalledWith("client_phone", "9876543210"), { timeout: 2000 });
    await waitFor(() => expect((screen.getByLabelText(/^Client name/) as HTMLInputElement).value).toBe("Asha"));
    expect((screen.getByLabelText(/^Gender/) as HTMLSelectElement).value).toBe("female");
    expect(screen.getAllByText("Auto-filled from client history — editable")).toHaveLength(2);

    const salesperson = screen.getByLabelText(/^Salesperson/) as HTMLSelectElement;
    expect([...salesperson.options].map((option) => option.text)).toEqual(["Choose", "Priya", "Arun"]);
    fireEvent.change(salesperson, { target: { value: "Arun" } });

    fireEvent.change(screen.getByRole("combobox", { name: "How many are with them?" }), { target: { value: "2" } });
    expect(screen.getByText("Family / friends 2")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name 1"), { target: { value: "Ravi" } });
    fireEvent.change(screen.getByLabelText("Relation 1"), { target: { value: "wife" } });
    fireEvent.change(screen.getByLabelText("Name 2"), { target: { value: "Meera" } });

    const file = new File(["x"], "review.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByLabelText("Google review proof"), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText("review.jpg uploaded")).toBeTruthy());
    expect(crm.upload).toHaveBeenCalledWith("proof", file, { video: false });

    fireEvent.click(screen.getByRole("button", { name: "Submit complete visit" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      client_name: "Asha", gender: "female", salesperson: "Arun",
      companions: { kind: "repeat", count: "2", rows: [{ name: "Ravi", relation: "wife" }, { name: "Meera" }] },
      proof: { kind: "crm_files", files: [{ path: "c1/t1/u_review.jpg", clientId: "c1", fileName: "review.jpg", mimeType: "image/jpeg" }] },
    }));
  });

  it("checks each row and the required photo before submitting", async () => {
    const onSubmit = vi.fn(async () => true);
    render(<FormRenderer crm={services({ lookup: vi.fn(async () => null) })} definition={definition} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/^Mobile/), { target: { value: "9876543210" } });
    fireEvent.change(screen.getByLabelText(/^Salesperson/), { target: { value: "Priya" } });
    fireEvent.change(screen.getByRole("combobox", { name: "How many are with them?" }), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit form" }));
    expect((await screen.findAllByText(/Family \/ friends 1: Name is required/)).length).toBeGreaterThan(0);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses files CRM does not accept", async () => {
    render(<FormRenderer crm={services()} definition={definition} />);
    fireEvent.change(screen.getByLabelText("Google review proof"), { target: { files: [new File(["x"], "notes.pdf", { type: "application/pdf" })] } });
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(within(screen.getByRole("alert")).getByText(/JPEG, PNG, WebP, HEIC or HEIF/)).toBeTruthy();
  });

  it("fills from the phone number in any form through the app's CRM lookup, without setup, and never overwrites typed answers", async () => {
    const lookup = vi.fn(async () => ({ details: { primary_name: "Asha", city: "Kochi" } }));
    const plain: FormTemplateDefinition = { name: "Enquiry", fields: [
      { key: "customer_name", label: "Customer name", type: "text", sortOrder: 0 },
      { key: "contact", label: "Phone number", type: "phone", sortOrder: 1 },
      { key: "town", label: "City", type: "text", sortOrder: 2 },
    ] };
    render(<FormCrmServicesContext.Provider value={{ lookup }}><FormRenderer definition={plain} /></FormCrmServicesContext.Provider>);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Thrissur" } });
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "+91 98765 43210" } });
    await waitFor(() => expect((screen.getByLabelText(/^Customer name/) as HTMLInputElement).value).toBe("Asha"), { timeout: 2000 });
    expect(lookup).toHaveBeenCalledWith("client_phone", "+91 98765 43210");
    expect((screen.getByLabelText(/^City/) as HTMLInputElement).value).toBe("Thrissur");
  });

  it("does nothing extra for people without CRM access", async () => {
    const plain: FormTemplateDefinition = { name: "Enquiry", fields: [{ key: "contact", label: "Phone number", type: "phone", sortOrder: 0 }, { key: "customer_name", label: "Customer name", type: "text", sortOrder: 1 }] };
    render(<FormRenderer definition={plain} />);
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "9876543210" } });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((screen.getByLabelText("Customer name") as HTMLInputElement).value).toBe("");
  });

  it("says CRM questions work in CRM forms only when the form is opened elsewhere", () => {
    render(<FormRenderer definition={definition} />);
    expect(screen.getByText("This question works in CRM forms only.")).toBeTruthy();
    // Outside CRM the salesperson question is an ordinary text box.
    expect((screen.getByLabelText(/^Salesperson/) as HTMLInputElement).tagName).toBe("INPUT");
  });
});
