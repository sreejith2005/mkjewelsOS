// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FormPhoneInput } from "./FormPhoneInput";
afterEach(cleanup);

const view = (value = "", onChange = vi.fn()) => { render(<FormPhoneInput inputProps={{ id: "mobile", "aria-label": "Mobile" }} label="Mobile" onChange={onChange} value={value} />); return onChange; };

it("saves an Indian number with its country code and flags a short one", () => {
  const onChange = view();
  fireEvent.change(screen.getByLabelText("Mobile"), { target: { value: "98765" } });
  expect(onChange).toHaveBeenLastCalledWith("+9198765");
  expect(screen.getByText(/10-digit mobile number for India/)).toBeTruthy();
  expect(screen.getByLabelText("Mobile").getAttribute("aria-invalid")).toBe("true");
});

it("a pasted international number picks its own country", () => {
  const onChange = view();
  fireEvent.change(screen.getByLabelText("Mobile"), { target: { value: "+44 7911 123456" } });
  expect(onChange).toHaveBeenLastCalledWith("+447911123456");
  expect((screen.getByLabelText("Country code for Mobile") as HTMLSelectElement).value).toBe("44");
  expect((screen.getByLabelText("Mobile") as HTMLInputElement).value).toBe("7911123456");
});

it("shows a legacy answer as stored, without guessing another country", () => {
  view("9876543210");
  expect((screen.getByLabelText("Country code for Mobile") as HTMLSelectElement).value).toBe("91");
  expect((screen.getByLabelText("Mobile") as HTMLInputElement).value).toBe("9876543210");
});

it("uses a phone keyboard", () => {
  view();
  const input = screen.getByLabelText("Mobile");
  expect(input.getAttribute("type")).toBe("tel");
  expect(input.getAttribute("inputmode")).toBe("tel");
});
