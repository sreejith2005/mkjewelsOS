// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormFieldDefinition } from "@jewelos/core";
vi.mock("./api", () => ({ signedFormFileUrl: vi.fn(), uploadFormFile: vi.fn() }));
import { FormRenderer } from "./FormRenderer";
afterEach(cleanup);

const options = [{ value: "walk_in", label: "Walk-in" }, { value: "referral", label: "Referral" }];
const question = (type: FormFieldDefinition["type"], allowOther = true): FormFieldDefinition => ({
  key: "source", label: "Lead source", type, sortOrder: 0, required: true, options, ...(allowOther ? { validation: { allowOther: true } } : {}),
});
const renderForm = (field: FormFieldDefinition) => {
  const submit = vi.fn().mockResolvedValue(true);
  render(<FormRenderer definition={{ name: "Lead", fields: [field] }} onSubmit={submit} />);
  return submit;
};

describe("Other answers", () => {
  it("lets a dropdown answer be typed under Other", async () => {
    const user = userEvent.setup();
    const submit = renderForm(question("select"));
    await user.selectOptions(screen.getByRole("combobox"), "Other (type your answer)");
    await user.type(screen.getByRole("textbox", { name: "Lead source: your own answer" }), "Instagram ad");
    await user.click(screen.getByRole("button", { name: "Submit form" }));
    expect(submit).toHaveBeenCalledWith({ source: "Instagram ad" });
  });

  it("goes back to a listed answer and hides the typing box", async () => {
    const user = userEvent.setup();
    const submit = renderForm(question("select"));
    await user.selectOptions(screen.getByRole("combobox"), "Other (type your answer)");
    await user.selectOptions(screen.getByRole("combobox"), "Referral");
    expect(screen.queryByRole("textbox", { name: "Lead source: your own answer" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Submit form" }));
    expect(submit).toHaveBeenCalledWith({ source: "referral" });
  });

  it("asks for the typed answer when Other is picked and left empty", async () => {
    const user = userEvent.setup();
    const submit = renderForm(question("radio"));
    await user.click(screen.getByRole("radio", { name: "Other" }));
    await user.click(screen.getByRole("button", { name: "Submit form" }));
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getAllByText("Lead source is required").length).toBeGreaterThan(0);
    await user.type(screen.getByRole("textbox", { name: "Lead source: your own answer" }), "Friend");
    await user.click(screen.getByRole("button", { name: "Submit form" }));
    expect(submit).toHaveBeenCalledWith({ source: "Friend" });
  });

  it("adds a typed answer next to the ticked answers of a checkbox list", async () => {
    const user = userEvent.setup();
    const submit = renderForm(question("checkbox"));
    await user.click(screen.getByRole("checkbox", { name: "Walk-in" }));
    await user.click(screen.getByRole("checkbox", { name: "Other" }));
    await user.type(screen.getByRole("textbox", { name: "Lead source: your own answer" }), "Exhibition");
    await user.click(screen.getByRole("button", { name: "Submit form" }));
    expect(submit).toHaveBeenCalledWith({ source: ["walk_in", "Exhibition"] });
    await user.click(screen.getByRole("checkbox", { name: "Other" }));
    expect(screen.queryByRole("textbox", { name: "Lead source: your own answer" })).toBeNull();
  });

  it("shows a saved typed answer as Other when the form opens", () => {
    render(<FormRenderer definition={{ name: "Lead", fields: [question("radio")] }} initialAnswers={{ source: "Friend" }} onSubmit={vi.fn()} />);
    expect((screen.getByRole("radio", { name: "Other" }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("textbox", { name: "Lead source: your own answer" }) as HTMLInputElement).value).toBe("Friend");
  });

  it("offers no Other choice unless the question allows it", () => {
    render(<FormRenderer definition={{ name: "Lead", fields: [question("radio", false)] }} onSubmit={vi.fn()} />);
    expect(screen.queryByRole("radio", { name: "Other" })).toBeNull();
  });
});

it("lists employees, branches and departments A to Z", () => {
  render(<FormRenderer definition={{ name: "Assign", fields: [{ key: "next", label: "Next employee", type: "user_dropdown", sortOrder: 0 }] }}
    dynamicOptions={{ users: [{ id: "3", label: "zara" }, { id: "1", label: "Meera" }, { id: "2", label: "Aarav" }], branches: [], departments: [], masters: [] }} onSubmit={vi.fn()} />);
  const names = within(screen.getByRole("combobox")).getAllByRole("option").map((option) => option.textContent);
  expect(names).toEqual(["Choose an answer", "Aarav", "Meera", "zara"]);
});
