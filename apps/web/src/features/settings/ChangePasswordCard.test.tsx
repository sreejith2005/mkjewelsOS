// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangePasswordCard } from "./ChangePasswordCard";

const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("ChangePasswordCard", () => {
  afterEach(cleanup);

  it("shows the steps to change a password", () => {
    render(<ChangePasswordCard onChange={vi.fn()} />);
    expect(screen.getByText(/Type your current password/)).toBeTruthy();
    expect(screen.getByText(/Ask your Super Admin to set a new one/)).toBeTruthy();
  });

  it("does not call the server when the new passwords do not match", async () => {
    const onChange = vi.fn();
    render(<ChangePasswordCard onChange={onChange} />);
    fill("Current password", "MkJ#26");
    fill("New password", "Gold#2026");
    fill("Confirm new password", "Gold#2027");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("The new passwords do not match.")).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("sends the current and new password, then clears the form", async () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    render(<ChangePasswordCard onChange={onChange} />);
    fill("Current password", "MkJ#26");
    fill("New password", "Gold#2026");
    fill("Confirm new password", "Gold#2026");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText(/Password changed/)).toBeTruthy();
    expect(onChange).toHaveBeenCalledWith("MkJ#26", "Gold#2026");
    expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("");
  });

  it("shows the server's reason when the current password is wrong", async () => {
    const onChange = vi.fn().mockRejectedValue(new Error("Your current password is incorrect."));
    render(<ChangePasswordCard onChange={onChange} />);
    fill("Current password", "wrong1");
    fill("New password", "Gold#2026");
    fill("Confirm new password", "Gold#2026");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    await waitFor(() => expect(screen.getByText("Your current password is incorrect.")).toBeTruthy());
  });
});
