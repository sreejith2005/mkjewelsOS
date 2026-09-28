// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { workUploadFormDefinition, type FormAnswers } from "@jewelos/core";
import { FormRenderer } from "./FormRenderer";

afterEach(cleanup);

describe("work and upload form on the web", () => {
  it("follows the closer route, returns to the actual previous step, and clears a changed branch", async () => {
    const user = userEvent.setup();
    const submitted: FormAnswers[] = [];
    render(<FormRenderer definition={workUploadFormDefinition} onSubmit={async (answers) => { submitted.push(answers); }} />);

    expect(screen.getByRole("status").textContent).toContain("Step 1 of 1");
    await user.type(screen.getByRole("textbox", { name: /REFERENCE NUMBER/ }), "REF 123");
    await user.selectOptions(screen.getByRole("combobox", { name: /WORK STAGE/ }), "closer");
    expect(screen.queryByText("INTERACTION MEETING")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByText("LEAD CLOSER")).toBeTruthy();
    await user.type(screen.getByRole("textbox", { name: /Billing Name/ }), "Test Client");
    await user.type(screen.getByRole("textbox", { name: /Billing Number/ }), "9876543210");
    await user.click(screen.getByText("ORDER CLOSE"));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.type(screen.getByRole("textbox", { name: /TAG NO/ }), "ABC123");
    await user.type(screen.getByRole("textbox", { name: /REMARK/ }), "Order completed");
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("LEAD CLOSER")).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "ENQUIRY CLOSE" }));
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByRole("textbox", { name: /TAG NO/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Submit form" }));
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toMatchObject({ reference_number: "REF 123", work_stage: "closer", closer_status: "enquiry_close" });
    expect(submitted[0]).not.toHaveProperty("tag_no");
    expect(submitted[0]).not.toHaveProperty("order_remark");
  }, 20000);

  it("shows appointment time only for online appointments", async () => {
    const user = userEvent.setup();
    render(<FormRenderer definition={workUploadFormDefinition} />);
    await user.type(screen.getByRole("textbox", { name: /REFERENCE NUMBER/ }), "REF 124");
    await user.selectOptions(screen.getByRole("combobox", { name: /WORK STAGE/ }), "introduction");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.selectOptions(screen.getByRole("combobox", { name: /CALL STATUS/ }), "interested");
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.queryByLabelText(/ONLINE VIDEO CALL APPOINTMENT IS SET FOR/)).toBeNull();
    await user.click(screen.getByRole("radio", { name: "ONLINE VIDEO CALL APPOINTMENT" }));
    expect(screen.getByLabelText(/ONLINE VIDEO CALL APPOINTMENT IS SET FOR/)).toBeTruthy();
    await user.click(screen.getByText("STORE VISIT"));
    expect(screen.queryByLabelText(/ONLINE VIDEO CALL APPOINTMENT IS SET FOR/)).toBeNull();
  }, 15000);
});
