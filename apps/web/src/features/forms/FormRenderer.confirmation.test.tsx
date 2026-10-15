// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./api", () => ({ signedFormFileUrl: vi.fn(), uploadFormFile: vi.fn() }));
import { FormRenderer } from "./FormRenderer";
afterEach(cleanup);
describe("form submission confirmation cancellation", () => {
  it("keeps answers editable and does not claim success after a canceled confirmation", async () => {
    const submit = vi.fn().mockResolvedValue(false);
    const user = userEvent.setup();
    render(<FormRenderer definition={{ name: "Call", fields: [{ key: "client", label: "Client name", type: "text", sortOrder: 0, required: true }] }} onSubmit={submit} />);
    await user.type(screen.getByRole("textbox"), "Synthetic client");
    await user.click(screen.getByRole("button", { name: "Submit form" }));
    expect(screen.queryByText("Form submitted successfully.")).toBeNull();
    expect(screen.getByRole("textbox")).toHaveProperty("value", "Synthetic client");
    await user.click(screen.getByRole("button", { name: "Submit form" }));
    expect(submit).toHaveBeenCalledTimes(2);
  });
});
