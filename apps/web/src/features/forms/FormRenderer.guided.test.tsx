// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { FormAnswers, FormFieldDefinition, FormTemplateDefinition } from "@jewelos/core";
import { FormRenderer } from "./FormRenderer";

afterEach(cleanup);

const text = (key: string, label: string, sectionKey: string, sortOrder: number, extra: Partial<FormFieldDefinition> = {}): FormFieldDefinition =>
  ({ key, label, type: "text", sectionKey, sortOrder, ...extra });

// Two sections, eight questions: long enough to be filled one step at a time.
const visitReport: FormTemplateDefinition = {
  name: "Store visit report",
  sections: [{ key: "customer", title: "Customer" }, { key: "visit", title: "Visit details" }],
  fields: [
    text("name", "Customer name", "customer", 0, { required: true }),
    { key: "phone", label: "Mobile number", type: "phone", sectionKey: "customer", sortOrder: 1, required: true },
    text("city", "City", "customer", 2),
    text("source", "How did they hear about us?", "customer", 3),
    { key: "items", label: "Items shown", type: "multiselect", sectionKey: "visit", sortOrder: 4, options: [{ value: "ring", label: "Rings" }, { value: "chain", label: "Chains" }] },
    { key: "budget", label: "Budget", type: "currency", sectionKey: "visit", sortOrder: 5 },
    { key: "visit_date", label: "Visit date", type: "date", sectionKey: "visit", sortOrder: 6 },
    text("notes", "Notes", "visit", 7),
  ],
};

describe("guided form filling", () => {
  it("fills a long form one step at a time with inline errors, progress and a final review", async () => {
    const user = userEvent.setup();
    const submitted: FormAnswers[] = [];
    render(<FormRenderer definition={visitReport} onSubmit={async (answers) => { submitted.push(answers); }} />);

    expect(screen.getByRole("status").textContent).toBe("Step 1");
    expect(screen.queryByText("Items shown")).toBeNull();
    expect(screen.getByRole("progressbar", { name: "Required questions answered" }).getAttribute("aria-valuenow")).toBe("0");

    await user.click(screen.getByRole("button", { name: "Next" }));
    const name = screen.getByRole("textbox", { name: /Customer name/ });
    expect(name.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("Customer name is required");
    expect(screen.getByRole("alert").textContent).toContain("1 more answer needs attention");
    expect(document.getElementById(name.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Customer name is required");

    await user.type(name, "Synthetic Customer");
    expect(name.getAttribute("aria-invalid")).toBeNull();
    const phone = screen.getByRole("textbox", { name: /Mobile number/ });
    expect(phone.getAttribute("type")).toBe("tel");
    expect(phone.getAttribute("inputmode")).toBe("tel");
    await user.type(phone, "9876543210");
    expect(screen.getByText("2 of 2 required answered")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByRole("status").textContent).toBe("Step 2");
    expect(screen.queryByRole("listbox")).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Chains" }));
    await user.type(screen.getByLabelText(/Visit date/), "2026-10-22");

    const review = screen.getByText("Check your answers before submitting").closest("details")!;
    expect(within(review).getByText("Synthetic Customer")).toBeTruthy();
    expect(within(review).getByText("Chains")).toBeTruthy();
    expect(within(review).getByText("22 Oct 2026")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Go back to step 1: Customer" }));
    expect(screen.getByRole("textbox", { name: /Customer name/ })).toHaveProperty("value", "Synthetic Customer");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Submit form" }));

    expect(submitted).toEqual([{ name: "Synthetic Customer", phone: "9876543210", items: ["chain"], visit_date: "2026-10-22" }]);
  }, 20000);

  it("keeps short forms on one page and marks required questions accessibly", () => {
    render(<FormRenderer definition={{ name: "Quick", fields: [text("client", "Client name", "section_1", 0, { required: true })] }} />);
    expect(screen.queryByRole("navigation", { name: "Form steps" })).toBeNull();
    expect(screen.getByRole("textbox", { name: /Client name/ }).getAttribute("aria-required")).toBe("true");
    expect(screen.getByRole("button", { name: "Submit form" })).toBeTruthy();
  });

  it("shows a currency cue and a decimal keypad for money", () => {
    render(<FormRenderer definition={{ name: "Money", fields: [{ key: "amount", label: "Amount", type: "currency", sortOrder: 0 }] }} />);
    const amount = screen.getByRole("spinbutton", { name: /Amount/ });
    expect(amount.getAttribute("inputmode")).toBe("decimal");
    expect(amount.parentElement?.textContent).toContain("₹");
  });
});
