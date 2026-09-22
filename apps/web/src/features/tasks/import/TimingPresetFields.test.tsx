// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimingPresetFields, taskImportTimingWindowsValid } from "./TimingPresetFields";

afterEach(cleanup);

describe("task import timing presets", () => {
  it("renders only the timing windows requested by the parser", () => {
    render(<TimingPresetFields disabled={false} onChange={vi.fn()} required={["opening", "closing"]} value={{}} />);
    expect(screen.getByLabelText("Opening start time")).toBeTruthy();
    expect(screen.getByLabelText("Opening due time")).toBeTruthy();
    expect(screen.getByLabelText("Closing start time")).toBeTruthy();
    expect(screen.queryByLabelText("Morning start time")).toBeNull();
  });

  it("updates one immutable timing window without discarding existing presets", () => {
    const onChange = vi.fn();
    render(<TimingPresetFields
      disabled={false}
      onChange={onChange}
      required={["opening"]}
      value={{ general: { startTime: "09:00", dueTime: "18:00" } }}
    />);
    fireEvent.change(screen.getByLabelText("Opening start time"), { target: { value: "08:00" } });
    expect(onChange).toHaveBeenCalledWith({
      general: { startTime: "09:00", dueTime: "18:00" },
      opening: { startTime: "08:00", dueTime: "" },
    });
  });

  it("marks incomplete and reversed windows invalid", () => {
    expect(taskImportTimingWindowsValid(["general"], { general: { startTime: "09:00", dueTime: "" } })).toBe(false);
    expect(taskImportTimingWindowsValid(["general"], { general: { startTime: "18:00", dueTime: "09:00" } })).toBe(false);
    expect(taskImportTimingWindowsValid(["general"], { general: { startTime: "09:00", dueTime: "18:00" } })).toBe(true);
    render(<TimingPresetFields disabled={false} onChange={vi.fn()} required={["general"]} value={{ general: { startTime: "18:00", dueTime: "09:00" } }} />);
    expect(screen.getByLabelText("General due time").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toMatch(/later than start/i);
  });
});
